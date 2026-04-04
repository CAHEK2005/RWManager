#!/usr/bin/env bash
set -euo pipefail

trap 'echo -e "\033[1;31m[ERROR]\033[0m Ошибка в строке $LINENO"; exit 1' ERR

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
log()   { echo -e "${GREEN}[INFO]${NC}  $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }
step()  { echo -e "\n${CYAN}▶ $1${NC}"; }

PROJECT_DIR="/opt/rwm-manager"

# ─── Проверки ─────────────────────────────────────────────────────────────────

[[ $EUID -eq 0 ]] || error "Запускать только от root"

echo ""
echo "==================================================="
echo -e "          ${RED}RWManager — удаление${NC}"
echo "==================================================="
echo ""
echo -e "${YELLOW}Это действие необратимо. Будут удалены:${NC}"
echo "  • контейнеры и Docker-образы"
echo "  • данные PostgreSQL (volume pg_data)"
echo "  • директория ${PROJECT_DIR}"
echo "  • правила UFW для порта приложения"
echo ""

read -r -p "Вы уверены? Введите «да» для подтверждения: " answer
[[ "$answer" == "да" ]] || { echo "Удаление отменено"; exit 0; }

# ─── Остановка контейнеров ────────────────────────────────────────────────────

step "Остановка и удаление контейнеров"
if [[ -d "$PROJECT_DIR" ]]; then
    cd "$PROJECT_DIR"
    if command -v docker &>/dev/null && docker compose version &>/dev/null 2>&1; then
        if [[ -f docker-compose.yml ]]; then
            docker compose down --volumes --remove-orphans 2>/dev/null \
                || warn "Не удалось выполнить docker compose down"
        fi
    fi
else
    warn "Директория $PROJECT_DIR не найдена"
fi

# ─── Docker образы ────────────────────────────────────────────────────────────

step "Удаление Docker-образов RWManager"
if command -v docker &>/dev/null; then
    docker images --format '{{.Repository}}:{{.Tag}} {{.ID}}' \
        | grep -E '^rwm-manager' \
        | awk '{print $2}' \
        | xargs -r docker rmi -f \
        && log "Образы удалены" \
        || warn "Образы уже удалены или не найдены"
fi

# ─── UFW ──────────────────────────────────────────────────────────────────────

step "Очистка правил UFW"
if LC_ALL=C ufw status 2>/dev/null | grep -q "Status: active"; then
    # Определить порт из .env или docker-compose.yml перед удалением директории
    APP_PORT=""
    if [[ -f "$PROJECT_DIR/.env" ]]; then
        APP_PORT=$(grep -oP '(?<=^PORT=)[0-9]+' "$PROJECT_DIR/.env" 2>/dev/null | head -1 || true)
    fi
    if [[ -z "$APP_PORT" && -f "$PROJECT_DIR/docker-compose.yml" ]]; then
        APP_PORT=$(grep -oP '(?<=- ")[0-9]+(?=:80")' "$PROJECT_DIR/docker-compose.yml" 2>/dev/null \
            || grep -oP '(?<=- )[0-9]+(?=:80)' "$PROJECT_DIR/docker-compose.yml" 2>/dev/null \
            || echo "")
    fi
    if [[ -n "$APP_PORT" && "$APP_PORT" != "80" ]]; then
        ufw delete allow "${APP_PORT}/tcp" 2>/dev/null \
            && log "Удалено правило UFW для порта ${APP_PORT}/tcp" \
            || warn "Правило UFW для порта ${APP_PORT} не найдено"
    fi
fi

# ─── Удаление директории ──────────────────────────────────────────────────────

step "Удаление файлов"
rm -rf "$PROJECT_DIR"
log "Директория ${PROJECT_DIR} удалена"

echo ""
echo "==================================================="
echo -e "${GREEN}✔ RWManager полностью удалён${NC}"
echo "==================================================="
echo ""
