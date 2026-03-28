#!/usr/bin/env bash
set -euo pipefail

#################################
# КОНФИГУРАЦИЯ
#################################
PROJECT_DIR="/opt/rwm-manager"
REPO_URL="https://github.com/CAHEK2005/3dp-manager-remna.git"

# Цвета
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()   { echo -e "${GREEN}[INFO]${NC} $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

#################################
# БАННЕР
#################################
echo "==================================================="
echo "        RWManager — installer            "
echo "==================================================="
echo ""

#################################
# ПРОВЕРКИ
#################################
if [[ $EUID -ne 0 ]]; then
    error "Скрипт должен быть запущен от root"
fi

. /etc/os-release
if [[ "$ID" != "ubuntu" && "$ID" != "debian" ]]; then
    error "Поддерживаются только Ubuntu и Debian (текущая ОС: $ID)"
fi

if [ "$(free -m | awk '/Mem:/{print $2}')" -lt 2000 ]; then
    if [ "$(free -m | awk '/Swap:/{print $2}')" -eq 0 ]; then
        log "Мало RAM и нет Swap. Создаём swap 2GB..."
        fallocate -l 2G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048
        chmod 600 /swapfile
        mkswap /swapfile
        swapon /swapfile
        echo '/swapfile none swap sw 0 0' >> /etc/fstab
        log "Swap создан."
    fi
fi

#################################
# ЗАВИСИМОСТИ
#################################
log "Проверка зависимостей..."
apt-get update -qq
for pkg in curl git jq openssl; do
    command -v "$pkg" &>/dev/null || apt-get install -y "$pkg"
done

#################################
# DOCKER
#################################
if command -v docker &>/dev/null; then
    log "Docker уже установлен."
else
    log "Устанавливаем Docker..."
    install -m 0755 -d /etc/apt/keyrings
    if [[ "$ID" == "ubuntu" ]]; then
        curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
    else
        curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
    fi
    chmod a+r /etc/apt/keyrings/docker.asc
    CODENAME=${UBUNTU_CODENAME:-$VERSION_CODENAME}
    tee /etc/apt/sources.list.d/docker.sources > /dev/null <<EOF
Types: deb
URIs: https://download.docker.com/linux/$ID
Suites: $CODENAME
Components: stable
Signed-By: /etc/apt/keyrings/docker.asc
EOF
    apt-get update -qq
    apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
    systemctl enable --now docker
fi

docker compose version &>/dev/null || error "docker compose v2 не найден"

#################################
# КЛОНИРОВАНИЕ / ОБНОВЛЕНИЕ РЕПОЗИТОРИЯ
#################################
if [[ -d "$PROJECT_DIR/.git" ]]; then
    log "Репозиторий уже существует, обновляем..."
    cd "$PROJECT_DIR"
    git pull origin main
else
    log "Клонируем репозиторий в $PROJECT_DIR..."
    git clone "$REPO_URL" "$PROJECT_DIR"
    cd "$PROJECT_DIR"
fi

#################################
# ОПРЕДЕЛЕНИЕ IP
#################################
UI_HOST=$(hostname -I | awk '{print $1}')
log "Используется IP: $UI_HOST"

get_random_port() {
    local MIN=${1:-3000} MAX=${2:-6999}
    while :; do
        PORT=$(shuf -i "$MIN-$MAX" -n 1)
        ss -ltun | awk '{print $4}' | grep -q ":$PORT\$" || { echo "$PORT"; return; }
    done
}
FINAL_PORT=$(get_random_port)

#################################
# ГЕНЕРАЦИЯ СЕКРЕТОВ
#################################
DB_PASS=$(openssl rand -base64 12)
JWT_SECRET=$(openssl rand -base64 32)
ADMIN_USER=$(openssl rand -base64 8 | tr -dc 'a-zA-Z0-9' | cut -c1-10)
ADMIN_PASS=$(openssl rand -base64 12)
log "Секретные ключи сгенерированы."

#################################
# ГЕНЕРАЦИЯ server/.env
#################################
cat > server/.env <<EOF
DB_HOST=postgres
DB_PORT=5432
DB_USERNAME=admin
DB_PASSWORD=${DB_PASS}
DB_NAME=rw_manager
JWT_SECRET=${JWT_SECRET}
ADMIN_LOGIN=${ADMIN_USER}
ADMIN_PASSWORD=${ADMIN_PASS}
EOF

#################################
# ГЕНЕРАЦИЯ docker-compose.yml
#################################
cat > client/nginx-client.conf <<EOF
server {
    listen 80;
    server_name localhost;
    root /usr/share/nginx/html;
    index index.html;
    client_max_body_size 50M;

    location / { try_files \$uri \$uri/ /index.html; }
    location /api/ {
        proxy_pass http://backend:3000/api/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$http_host;
        proxy_cache_bypass \$http_upgrade;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    }
}
EOF

cat > docker-compose.yml <<EOF
name: rwm-manager
services:
  postgres:
    image: postgres:18-alpine
    container_name: rwm-postgres
    restart: always
    environment:
      POSTGRES_USER: admin
      POSTGRES_PASSWORD: ${DB_PASS}
      POSTGRES_DB: rw_manager
    volumes:
      - pg_data:/var/lib/postgresql/18/docker
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U admin -d rw_manager"]
      interval: 5s
      timeout: 5s
      retries: 5
    networks:
      - app-network

  backend:
    build: ./server
    container_name: rwm-backend
    restart: always
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      DB_HOST: postgres
      DB_PORT: 5432
      DB_USERNAME: admin
      DB_PASSWORD: ${DB_PASS}
      DB_NAME: rw_manager
      JWT_SECRET: ${JWT_SECRET}
      ADMIN_LOGIN: ${ADMIN_USER}
      ADMIN_PASSWORD: ${ADMIN_PASS}
      PORT: 3000
    networks:
      - app-network

  frontend:
    build: ./client
    container_name: rwm-frontend
    restart: always
    depends_on:
      - backend
    ports:
      - "${FINAL_PORT}:80"
    volumes:
      - ./client/nginx-client.conf:/etc/nginx/conf.d/default.conf:ro
    networks:
      - app-network

volumes:
  pg_data:

networks:
  app-network:
    driver: bridge
EOF

#################################
# ЗАПУСК
#################################
log "Сборка и запуск контейнеров..."
docker compose down --remove-orphans || true
docker rm -f rwm-postgres rwm-backend rwm-frontend 2>/dev/null || true
docker compose up --build -d --remove-orphans
docker image prune -f

#################################
# UFW
#################################
if LC_ALL=C ufw status 2>/dev/null | grep -q "Status: active"; then
    log "Настраиваем UFW..."
    ufw allow "${FINAL_PORT}/tcp"
    ufw allow 10000:60000/tcp
    ufw allow 10000:60000/udp
fi

#################################
# ИТОГ
#################################
echo ""
echo "==================================================="
echo -e "${GREEN}✔ Установка завершена!${NC}"
echo -e "${GREEN}   Адрес: http://${UI_HOST}:${FINAL_PORT}${NC}"
echo -e "${GREEN}   Логин:  ${ADMIN_USER}${NC}"
echo -e "${GREEN}   Пароль: ${ADMIN_PASS}${NC}"
echo ""
echo "Немедленно смените пароль в настройках!"
echo "==================================================="
