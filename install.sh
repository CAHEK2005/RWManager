#!/usr/bin/env bash
set -euo pipefail

BRANCH="main"
PROJECT_DIR="/opt/rwm-manager"
REPO_URL="https://github.com/CAHEK2005/3dp-manager-remna.git"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
log()   { echo -e "${GREEN}[INFO]${NC}  $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }
step()  { echo -e "\n${CYAN}▶ $1${NC}"; }

echo ""
echo "==================================================="
echo "          RWManager — установка"
echo "==================================================="
echo ""

# ─── Проверки ────────────────────────────────────────────────────────────────

[[ $EUID -eq 0 ]] || error "Запускать только от root"

. /etc/os-release
[[ "$ID" == "ubuntu" || "$ID" == "debian" ]] \
    || error "Поддерживаются только Ubuntu и Debian (текущая ОС: $ID)"

# ─── Swap ─────────────────────────────────────────────────────────────────────

if [[ "$(free -m | awk '/Mem:/{print $2}')" -lt 2000 ]] \
   && [[ "$(free -m | awk '/Swap:/{print $2}')" -eq 0 ]]; then
    step "Мало RAM и нет Swap — создаём 2 GB"
    fallocate -l 2G /swapfile 2>/dev/null || dd if=/dev/zero of=/swapfile bs=1M count=2048
    chmod 600 /swapfile
    mkswap /swapfile && swapon /swapfile
    echo '/swapfile none swap sw 0 0' >> /etc/fstab
    log "Swap создан"
fi

# ─── Зависимости ──────────────────────────────────────────────────────────────

step "Проверка зависимостей"
apt-get update -qq
for pkg in curl git jq openssl; do
    command -v "$pkg" &>/dev/null || apt-get install -y -qq "$pkg"
done

# ─── Docker ───────────────────────────────────────────────────────────────────

if command -v docker &>/dev/null; then
    log "Docker уже установлен: $(docker --version)"
else
    step "Установка Docker"
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL "https://download.docker.com/linux/${ID}/gpg" \
        -o /etc/apt/keyrings/docker.asc
    chmod a+r /etc/apt/keyrings/docker.asc
    CODENAME="${UBUNTU_CODENAME:-$VERSION_CODENAME}"
    cat > /etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/${ID}
Suites: ${CODENAME}
Components: stable
Signed-By: /etc/apt/keyrings/docker.asc
EOF
    apt-get update -qq
    apt-get install -y docker-ce docker-ce-cli containerd.io \
        docker-buildx-plugin docker-compose-plugin
    systemctl enable --now docker
fi

docker compose version &>/dev/null || error "docker compose v2 не найден"

# ─── Репозиторий ──────────────────────────────────────────────────────────────

step "Получение исходников"
if [[ -d "$PROJECT_DIR/.git" ]]; then
    log "Репозиторий уже существует — обновляем"
    cd "$PROJECT_DIR"
    git fetch origin
    git checkout "$BRANCH"
    git pull origin "$BRANCH"
else
    git clone --branch "$BRANCH" "$REPO_URL" "$PROJECT_DIR"
    cd "$PROJECT_DIR"
fi

# ─── Сеть и порт ──────────────────────────────────────────────────────────────

UI_HOST=$(hostname -I | awk '{print $1}')
log "IP сервера: $UI_HOST"

get_free_port() {
    local min=${1:-3000} max=${2:-6999}
    while :; do
        local p
        p=$(shuf -i "${min}-${max}" -n 1)
        ss -ltun | awk '{print $4}' | grep -q ":${p}\$" || { echo "$p"; return; }
    done
}
FINAL_PORT=$(get_free_port)
log "Выбран порт: $FINAL_PORT"

# ─── Генерация секретов ───────────────────────────────────────────────────────

step "Генерация секретов"
DB_PASS=$(openssl rand -hex 16)
JWT=$(openssl rand -hex 32)
ADMIN_USER=$(openssl rand -base64 8 | tr -dc 'a-zA-Z0-9' | head -c10)
ADMIN_PASS=$(openssl rand -base64 12)
ENC_KEY=$(openssl rand -hex 32)
log "Секреты сгенерированы"

# ─── .env ─────────────────────────────────────────────────────────────────────

step "Создание .env"
cat > .env <<EOF
# PostgreSQL
POSTGRES_USER=rwm
POSTGRES_PASSWORD=${DB_PASS}
POSTGRES_DB=rwmanager

# JWT — подпись токенов
JWT_SECRET=${JWT}

# Начальный администратор (только при первом запуске)
ADMIN_LOGIN=${ADMIN_USER}
ADMIN_PASSWORD=${ADMIN_PASS}

# Шифрование хранилища секретов (32 байта hex)
SECRET_ENCRYPTION_KEY=${ENC_KEY}

# CORS — разрешённый origin фронтенда
CORS_ORIGIN=http://${UI_HOST}:${FINAL_PORT}

# Внешний порт фронтенда
PORT=${FINAL_PORT}
EOF
chmod 600 .env
log ".env создан"

# ─── Сборка и запуск ──────────────────────────────────────────────────────────

step "Сборка и запуск контейнеров"
docker compose down --remove-orphans 2>/dev/null || true
docker compose up --build -d --remove-orphans
docker image prune -f

# ─── UFW ──────────────────────────────────────────────────────────────────────

if LC_ALL=C ufw status 2>/dev/null | grep -q "Status: active"; then
    step "Настройка UFW"
    ufw allow "${FINAL_PORT}/tcp"
    log "Открыт порт ${FINAL_PORT}/tcp"
fi

# ─── Итог ─────────────────────────────────────────────────────────────────────

echo ""
echo "==================================================="
echo -e "${GREEN}✔ Установка завершена!${NC}"
echo ""
echo -e "   Адрес:  http://${UI_HOST}:${FINAL_PORT}"
echo -e "   Логин:  ${ADMIN_USER}"
echo -e "   Пароль: ${ADMIN_PASS}"
echo ""
echo "   Немедленно смените пароль в настройках!"
echo "==================================================="
echo ""
