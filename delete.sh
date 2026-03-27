#!/usr/bin/env bash
set -euo pipefail

trap 'echo -e "\033[1;31m[ERROR]\033[0m Ошибка в строке $LINENO"; exit 1' ERR

log()  { echo -e "\033[1;32m[INFO]\033[0m $1"; }
warn() { echo -e "\033[1;33m[WARN]\033[0m $1"; }
die()  { echo -e "\033[1;31m[ERROR]\033[0m $1"; exit 1; }

read -r -p "Вы уверены, что хотите удалить RW Profile Manager? (y/n): " answer
case "$answer" in
  y|Y) echo "Начинаю удаление..." ;;
  *)   echo "Удаление отменено"; exit 1 ;;
esac

[[ $EUID -eq 0 ]] || die "Запускать только от root"

PROJECT_DIR="/opt/rw-manager"

log "Удаление RW Profile Manager..."

if [[ ! -d "$PROJECT_DIR" ]]; then
    warn "Директория $PROJECT_DIR не найдена — удалять нечего"
    exit 0
fi

cd "$PROJECT_DIR"

if command -v docker &>/dev/null && docker compose version &>/dev/null; then
    if [[ -f docker-compose.yml ]]; then
        log "Останавливаем контейнеры..."
        docker compose down --volumes --remove-orphans || warn "Ошибка при docker compose down"
    fi
fi

log "Удаляем образы rw-manager..."
docker images --format '{{.Repository}} {{.ID}}' \
    | grep -E 'rw-manager|rw-profile' \
    | awk '{print $2}' \
    | xargs -r docker rmi -f || true

log "Удаляем $PROJECT_DIR..."
rm -rf "$PROJECT_DIR"

log "✔ RW Profile Manager полностью удалён"
