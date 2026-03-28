#!/usr/bin/env bash
set -euo pipefail

trap 'echo -e "\033[1;31m[ERROR]\033[0m Ошибка в строке $LINENO"; exit 1' ERR

log()  { echo -e "\033[1;32m[INFO]\033[0m $1"; }
warn() { echo -e "\033[1;33m[WARN]\033[0m $1"; }
die()  { echo -e "\033[1;31m[ERROR]\033[0m $1"; exit 1; }

[[ $EUID -eq 0 ]] || die "Запускать только от root"

PROJECT_DIR="/opt/rw-manager"

log "Обновление RW Profile Manager..."

[[ -d "$PROJECT_DIR" ]] || die "RW Profile Manager не установлен ($PROJECT_DIR не найден)"

cd "$PROJECT_DIR"

command -v docker >/dev/null 2>&1 || die "Docker не установлен"
docker compose version >/dev/null 2>&1 || die "docker compose v2 недоступен"

log "Получение последних изменений из репозитория..."
git pull origin main

log "Остановка контейнеров..."
docker compose down --remove-orphans

log "Пересборка и перезапуск контейнеров..."
docker compose up --build -d

log "Очистка старых образов..."
docker image prune -f

log "RW Profile Manager успешно обновлён ✅"
