#!/usr/bin/env bash
set -euo pipefail

trap 'echo -e "\033[1;31m[ERROR]\033[0m Ошибка в строке $LINENO"; exit 1' ERR

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
log()   { echo -e "${GREEN}[INFO]${NC}  $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }
step()  { echo -e "\n${CYAN}▶ $1${NC}"; }

BRANCH="main"
PROJECT_DIR="/opt/rwm-manager"

[[ $EUID -eq 0 ]]       || error "Запускать только от root"
[[ -d "$PROJECT_DIR" ]] || error "RWManager не установлен ($PROJECT_DIR не найден)"

command -v docker &>/dev/null                || error "Docker не установлен"
docker compose version &>/dev/null 2>&1      || error "docker compose v2 недоступен"

cd "$PROJECT_DIR"

echo ""
echo "==================================================="
echo "          RWManager — обновление"
echo "==================================================="
echo ""

# ─── Миграция: создать .env из старых источников ─────────────────────────────
#
# Старые версии хранили секреты в hardcoded docker-compose.yml + server/.env.
# Новая версия читает их из корневого .env.
# Если .env ещё нет — собираем значения из старых источников.

step "Проверка конфигурации"

if [[ ! -f .env ]]; then
    warn "Корневой .env не найден — выполняем миграцию"

    # Попытка извлечь значения из старого docker-compose.yml (hardcoded формат)
    _dc_val() {
        grep -oP "(?<=${1}: )[^\s]+" docker-compose.yml 2>/dev/null | head -1 || true
    }
    # Попытка извлечь из server/.env
    _srv_val() {
        grep -oP "(?<=${1}=).+" server/.env 2>/dev/null | head -1 || true
    }

    DB_USER=$(_dc_val "POSTGRES_USER");   [[ -z "$DB_USER"   ]] && DB_USER=$(_srv_val "DB_USERNAME")
    DB_PASS=$(_dc_val "POSTGRES_PASSWORD"); [[ -z "$DB_PASS"  ]] && DB_PASS=$(_srv_val "DB_PASSWORD")
    DB_NAME=$(_dc_val "POSTGRES_DB");     [[ -z "$DB_NAME"   ]] && DB_NAME=$(_srv_val "DB_NAME")
    JWT=$(_dc_val "JWT_SECRET");          [[ -z "$JWT"       ]] && JWT=$(_srv_val "JWT_SECRET")
    ADMIN_U=$(_dc_val "ADMIN_LOGIN");     [[ -z "$ADMIN_U"   ]] && ADMIN_U=$(_srv_val "ADMIN_LOGIN")
    ADMIN_P=$(_dc_val "ADMIN_PASSWORD");  [[ -z "$ADMIN_P"   ]] && ADMIN_P=$(_srv_val "ADMIN_PASSWORD")
    ENC_KEY=$(_dc_val "SECRET_ENCRYPTION_KEY"); [[ -z "$ENC_KEY" ]] && ENC_KEY=$(_srv_val "SECRET_ENCRYPTION_KEY")

    # Определить порт из docker-compose.yml: строка вида "- 4321:80"
    PORT_MAPPED=$(grep -oP '(?<=- ")[0-9]+(?=:80")' docker-compose.yml 2>/dev/null \
        || grep -oP '(?<=- )[0-9]+(?=:80)' docker-compose.yml 2>/dev/null \
        || echo "")
    [[ -z "$PORT_MAPPED" ]] && PORT_MAPPED="80"

    # IP сервера
    UI_HOST=$(hostname -I | awk '{print $1}')

    # Заполнить недостающие значения новыми случайными
    [[ -z "$DB_USER"  ]] && DB_USER="rwm"
    [[ -z "$DB_PASS"  ]] && DB_PASS=$(openssl rand -hex 16)
    [[ -z "$DB_NAME"  ]] && DB_NAME="rwmanager"
    [[ -z "$JWT"      ]] && JWT=$(openssl rand -hex 32)
    [[ -z "$ADMIN_U"  ]] && ADMIN_U="admin"
    [[ -z "$ADMIN_P"  ]] && ADMIN_P=$(openssl rand -base64 12)
    [[ -z "$ENC_KEY"  ]] && ENC_KEY=$(openssl rand -hex 32)

    cat > .env <<EOF
# PostgreSQL
POSTGRES_USER=${DB_USER}
POSTGRES_PASSWORD=${DB_PASS}
POSTGRES_DB=${DB_NAME}

# JWT — подпись токенов
JWT_SECRET=${JWT}

# Начальный администратор (только при первом запуске)
ADMIN_LOGIN=${ADMIN_U}
ADMIN_PASSWORD=${ADMIN_P}

# Шифрование хранилища секретов (32 байта hex)
SECRET_ENCRYPTION_KEY=${ENC_KEY}

# CORS — разрешённый origin фронтенда
CORS_ORIGIN=http://${UI_HOST}:${PORT_MAPPED}

# Внешний порт фронтенда
PORT=${PORT_MAPPED}
EOF
    chmod 600 .env
    log "Создан .env из существующей конфигурации"
fi

# Добавить отсутствующие переменные в существующий .env
_ensure_env() {
    local key="$1" val="$2"
    grep -q "^${key}=" .env 2>/dev/null && return
    echo "" >> .env
    echo "# Добавлено при обновлении $(date +%Y-%m-%d)" >> .env
    echo "${key}=${val}" >> .env
    log "Добавлена переменная ${key} в .env"
}

UI_HOST=$(hostname -I | awk '{print $1}')
PORT_CURRENT=$(grep -oP '(?<=^PORT=).+' .env 2>/dev/null | head -1 || echo "80")

_ensure_env "SECRET_ENCRYPTION_KEY" "$(openssl rand -hex 32)"
_ensure_env "CORS_ORIGIN"           "http://${UI_HOST}:${PORT_CURRENT}"

# ─── docker-compose.override.yml: сохранить нестандартный путь volume ────────
#
# Старые установки монтировали volume в /var/lib/postgresql/18/docker.
# Новый docker-compose.yml использует стандартный /var/lib/postgresql/data.
# Если путь отличается — фиксируем в override чтобы не потерять данные.

CURRENT_VOL_PATH=$(grep -oP 'pg_data:\K[^\s]+' docker-compose.yml 2>/dev/null | head -1 || echo "")
STANDARD_VOL_PATH="/var/lib/postgresql/data"

if [[ -n "$CURRENT_VOL_PATH" && "$CURRENT_VOL_PATH" != "$STANDARD_VOL_PATH" ]]; then
    if [[ ! -f docker-compose.override.yml ]]; then
        cat > docker-compose.override.yml <<EOF
# Создано автоматически при обновлении — сохраняет нестандартный путь volume.
# Не удаляйте этот файл: без него PostgreSQL не найдёт существующие данные.
services:
  postgres:
    volumes:
      - pg_data:${CURRENT_VOL_PATH}
EOF
        log "Создан docker-compose.override.yml (volume path: ${CURRENT_VOL_PATH})"
    fi
fi

# ─── Git pull ─────────────────────────────────────────────────────────────────

step "Получение обновлений из репозитория (ветка: ${BRANCH})"

# Спрятать любые незакоммиченные изменения (кроме .env и override)
if ! git diff --quiet; then
    git stash push -m "pre-update auto-stash $(date +%Y%m%d-%H%M%S)" \
        -- $(git diff --name-only | grep -v '^\.env' | grep -v '^docker-compose.override.yml' || true)
    warn "Локальные изменения сохранены через git stash"
fi

git fetch origin
git checkout "$BRANCH"
git pull origin "$BRANCH"

# ─── Сборка и перезапуск ──────────────────────────────────────────────────────

step "Пересборка и перезапуск контейнеров"
docker compose down --remove-orphans
docker compose up --build -d --remove-orphans
docker image prune -f

echo ""
echo "==================================================="
echo -e "${GREEN}✔ RWManager успешно обновлён${NC}"
echo "==================================================="
echo ""
