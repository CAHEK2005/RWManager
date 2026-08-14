export const HYSTERIA2_SCRIPT_ID = 'builtin-setup-hysteria2';

export const HYSTERIA2_CADDY_HELPER_SCRIPT = `#!/usr/bin/env bash
set -Eeuo pipefail
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

ENV_FILE="\${HYSTERIA_ENV_FILE:-/opt/certbot/hysteria2.env}"
. "$ENV_FILE"

CADDY_DIR="/opt/caddy"
CADDY_COMPOSE="$CADDY_DIR/docker-compose.yml"
CADDY_FILE="$CADDY_DIR/Caddyfile"
CADDY_ENV="$CADDY_DIR/.env"
CADDY_WEBROOT="$CADDY_DIR/html"
CADDY_BACKUP=""
CADDY_TMP=""
ROLLBACK_NEEDED=0

fail() {
  echo "[ERROR] $*" >&2
  exit 1
}

restore_caddy() {
  if [ -n "$CADDY_BACKUP" ] && [ -f "$CADDY_BACKUP" ]; then
    echo "[ROLLBACK] Восстанавливаем исходный Caddyfile"
    ROLLBACK_NEEDED=0
    cat "$CADDY_BACKUP" > "$CADDY_FILE"
    docker compose -f "$CADDY_COMPOSE" up -d --force-recreate caddy \\
      >/dev/null 2>&1 || true
  fi
}

on_exit() {
  EXIT_CODE=$?
  trap - EXIT
  [ -z "$CADDY_TMP" ] || rm -f "$CADDY_TMP"
  if [ "$ROLLBACK_NEEDED" -eq 1 ]; then
    restore_caddy
  fi
  exit "$EXIT_CODE"
}
trap on_exit EXIT

[ -n "$HYSTERIA_DOMAIN" ] || fail "HYSTERIA_DOMAIN не задан"
[ -f "$CADDY_COMPOSE" ] || fail "$CADDY_COMPOSE не найден"
[ -f "$CADDY_FILE" ] || fail "$CADDY_FILE не найден"
[ -f "$CADDY_ENV" ] || fail "$CADDY_ENV не найден"
docker compose -f "$CADDY_COMPOSE" config --services | grep -qx caddy \\
  || fail "В $CADDY_COMPOSE не найден сервис caddy"
docker compose -f "$CADDY_COMPOSE" ps --status running --services | grep -qx caddy \\
  || fail "Caddy не запущен"

install -d -m 755 "$CADDY_WEBROOT/.well-known/acme-challenge"

SAME_DOMAIN_MARKER="# BEGIN RWM HYSTERIA ACME (selfsteal domain)"
DOMAIN_MARKER="# BEGIN RWM HYSTERIA ACME: $HYSTERIA_DOMAIN"
CADDY_TMP=$(mktemp "$CADDY_DIR/Caddyfile.rwm.XXXXXX")
# Старые managed-маршруты сохраняем: они могут быть нужны прежнему сертификату
# при откате смены домена.
cp -p "$CADDY_FILE" "$CADDY_TMP"

if grep -qFx "SELF_STEAL_DOMAIN=$HYSTERIA_DOMAIN" "$CADDY_ENV"; then
  if ! grep -qF "$SAME_DOMAIN_MARKER" "$CADDY_TMP"; then
    PATCHED_CADDY=$(mktemp "$CADDY_DIR/Caddyfile.rwm.XXXXXX")
    if ! awk '
      BEGIN { replaced = 0 }
      {
        line = $0
        gsub(/^[[:space:]]+|[[:space:]]+$/, "", line)
        if (!replaced && line == "redir https://{$SELF_STEAL_DOMAIN}{uri} permanent") {
          print "\t# BEGIN RWM HYSTERIA ACME (selfsteal domain)"
          print "\t@rwm_hysteria_acme path /.well-known/acme-challenge/*"
          print "\thandle @rwm_hysteria_acme {"
          print "\t\troot * /var/www/html"
          print "\t\tfile_server"
          print "\t}"
          print "\thandle {"
          print "\t\tredir https://{$SELF_STEAL_DOMAIN}{uri} permanent"
          print "\t}"
          print "\t# END RWM HYSTERIA ACME (selfsteal domain)"
          replaced = 1
        } else {
          print $0
        }
      }
      END { if (!replaced) exit 42 }
    ' "$CADDY_TMP" > "$PATCHED_CADDY"; then
      rm -f "$PATCHED_CADDY"
      fail "Не удалось найти стандартный redirect-блок selfsteal в Caddyfile"
    fi
    mv "$PATCHED_CADDY" "$CADDY_TMP"
  fi
elif ! grep -qFx "$DOMAIN_MARKER" "$CADDY_TMP"; then
  cat >> "$CADDY_TMP" <<CADDY_ACME_EOF

$DOMAIN_MARKER
http://$HYSTERIA_DOMAIN {
\tbind 0.0.0.0
\thandle /.well-known/acme-challenge/* {
\t\troot * /var/www/html
\t\tfile_server
\t}
\thandle {
\t\trespond 404
\t}
}
# END RWM HYSTERIA ACME: $HYSTERIA_DOMAIN
CADDY_ACME_EOF
fi

if ! cmp -s "$CADDY_TMP" "$CADDY_FILE"; then
  CADDY_BACKUP="$CADDY_FILE.rwm-backup.$(date +%s).$$"
  cp -p "$CADDY_FILE" "$CADDY_BACKUP"
  ROLLBACK_NEEDED=1

  # Caddyfile bind-mounted как файл: сохраняем inode, записывая поверх файла.
  cat "$CADDY_TMP" > "$CADDY_FILE"
  docker compose -f "$CADDY_COMPOSE" exec -T caddy \\
    caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile \\
    || fail "Новая конфигурация Caddy не прошла проверку"
  docker compose -f "$CADDY_COMPOSE" restart caddy \\
    || fail "Caddy не перезапустился с новой конфигурацией"
fi

PROBE_NAME="rwm-hysteria-probe-$$"
PROBE_BODY="rwm-hysteria-ok-$$"
printf '%s' "$PROBE_BODY" > "$CADDY_WEBROOT/.well-known/acme-challenge/$PROBE_NAME"
PROBE_RESPONSE=$(curl -fsS \\
  --retry 10 \\
  --retry-connrefused \\
  --retry-delay 1 \\
  --max-time 20 \\
  --resolve "$HYSTERIA_DOMAIN:80:127.0.0.1" \\
  "http://$HYSTERIA_DOMAIN/.well-known/acme-challenge/$PROBE_NAME" || true)
rm -f "$CADDY_WEBROOT/.well-known/acme-challenge/$PROBE_NAME"

[ "$PROBE_RESPONSE" = "$PROBE_BODY" ] \\
  || fail "Caddy не отдаёт HTTP-01 файлы для $HYSTERIA_DOMAIN"

ROLLBACK_NEEDED=0
rm -f "$CADDY_BACKUP" "$CADDY_TMP"
CADDY_TMP=""
trap - EXIT
echo "Caddy готов обслуживать HTTP-01 для $HYSTERIA_DOMAIN"`;

export const HYSTERIA2_DEPLOY_SCRIPT = `#!/usr/bin/env bash
set -Eeuo pipefail
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

ENV_FILE="\${HYSTERIA_ENV_FILE:-/opt/certbot/hysteria2.env}"
RESTART_REMNANODE="\${RESTART_REMNANODE:-1}"
PRUNE_GENERATIONS="\${PRUNE_GENERATIONS:-0}"
. "$ENV_FILE"

CERT_SOURCE="\${HYSTERIA_CERT_SOURCE:-/opt/certbot/certs/live/$HYSTERIA_DOMAIN}"
DEPLOY_DIR="\${HYSTERIA_DEPLOY_DIR:-/opt/hysteria2-certs}"
GENERATIONS_DIR="$DEPLOY_DIR/generations"
CURRENT_LINK="$DEPLOY_DIR/current"
RESTART_MARKER="\${HYSTERIA_RESTART_MARKER:-/opt/certbot/.hysteria2-restart-required}"
REMNANODE_DIR="\${HYSTERIA_REMNANODE_DIR:-/opt/remnanode}"
NEW_GENERATION=""
CURRENT_LINK_TMP=""
RESTART_COMPLETED=0
PUBLICATION_COMPLETE=0
HAD_PREVIOUS_CURRENT=0
PREVIOUS_CURRENT_TARGET=""

case "$PRUNE_GENERATIONS" in
  0|1) ;;
  *)
    echo "[ERROR] PRUNE_GENERATIONS должен быть 0 или 1" >&2
    exit 1
    ;;
esac

cleanup() {
  EXIT_CODE=$?
  trap - EXIT
  set +e
  [ -z "$CURRENT_LINK_TMP" ] || rm -f "$CURRENT_LINK_TMP"

  if [ "$EXIT_CODE" -ne 0 ] \\
    && [ "$PUBLICATION_COMPLETE" -eq 1 ] \\
    && [ "$RESTART_REMNANODE" -eq 1 ]; then
    echo "[ROLLBACK] Возвращаем предыдущее поколение сертификата" >&2
    ROLLBACK_LINK_OK=0
    if [ "$HAD_PREVIOUS_CURRENT" -eq 1 ]; then
      ROLLBACK_LINK_TMP="$DEPLOY_DIR/.current.rollback.$$"
      rm -f "$ROLLBACK_LINK_TMP"
      if ln -s "$PREVIOUS_CURRENT_TARGET" "$ROLLBACK_LINK_TMP" \\
        && mv -Tf "$ROLLBACK_LINK_TMP" "$CURRENT_LINK"; then
        ROLLBACK_LINK_OK=1
      fi
      rm -f "$ROLLBACK_LINK_TMP"
    elif rm -f "$CURRENT_LINK"; then
      ROLLBACK_LINK_OK=1
    fi

    if [ "$ROLLBACK_LINK_OK" -eq 1 ] && [ "$HAD_PREVIOUS_CURRENT" -eq 1 ]; then
      if (
        cd "$REMNANODE_DIR" \\
          && docker compose up -d --force-recreate remnanode \\
          && docker compose exec -T remnanode test -r /etc/hysteria2/fullchain.pem \\
          && docker compose exec -T remnanode test -r /etc/hysteria2/privkey.pem
      ); then
        echo "[ROLLBACK] remnanode снова использует предыдущее поколение" >&2
      else
        echo "[ROLLBACK ERROR] Не удалось восстановить рабочий remnanode; повторите запуск" >&2
      fi
    elif [ "$ROLLBACK_LINK_OK" -ne 1 ]; then
      echo "[ROLLBACK ERROR] Не удалось восстановить ссылку $CURRENT_LINK" >&2
    fi
    touch "$RESTART_MARKER"
  fi

  if [ -n "$NEW_GENERATION" ] && [ -d "$NEW_GENERATION" ]; then
    NEW_GENERATION_REAL=$(readlink -f "$NEW_GENERATION" 2>/dev/null || true)
    CURRENT_GENERATION_REAL=$(readlink -f "$CURRENT_LINK" 2>/dev/null || true)
    if [ ! -L "$CURRENT_LINK" ] \\
      || { [ -n "$CURRENT_GENERATION_REAL" ] \\
        && [ "$NEW_GENERATION_REAL" != "$CURRENT_GENERATION_REAL" ]; }; then
      case "$NEW_GENERATION" in
        "$GENERATIONS_DIR"/.rwm-generation.*) rm -rf -- "$NEW_GENERATION" ;;
      esac
    fi
  fi
  exit "$EXIT_CODE"
}
trap cleanup EXIT

prune_generations() {
  local current_generation_real=""
  local keep_generation_real=""
  local generation_entry=""
  local generation_name=""
  local generation_path=""
  local generation_real=""

  current_generation_real=$(readlink -f "$CURRENT_LINK" 2>/dev/null || true)
  [ -n "$current_generation_real" ] || return 0

  # Keep the newest non-current managed generation for rollback.
  while IFS= read -r -d '' generation_entry; do
    generation_name="\${generation_entry#* }"
    generation_path="$GENERATIONS_DIR/$generation_name"
    [ -d "$generation_path" ] || continue
    [ ! -L "$generation_path" ] || continue
    generation_real=$(readlink -f "$generation_path" 2>/dev/null || true)
    [ -n "$generation_real" ] || continue
    [ "$generation_real" != "$current_generation_real" ] || continue
    keep_generation_real="$generation_real"
    break
  done < <(
    find "$GENERATIONS_DIR" -mindepth 1 -maxdepth 1 -type d \\
      -name '.rwm-generation.*' -printf '%T@ %f\\0' \\
      | sort -z -nr
  )

  for generation_path in "$GENERATIONS_DIR"/.rwm-generation.*; do
    [ -d "$generation_path" ] || continue
    [ ! -L "$generation_path" ] || continue
    generation_real=$(readlink -f "$generation_path" 2>/dev/null || true)
    [ -n "$generation_real" ] || continue
    [ "$generation_real" != "$current_generation_real" ] || continue
    if [ -n "$keep_generation_real" ] \\
      && [ "$generation_real" = "$keep_generation_real" ]; then
      continue
    fi
    rm -rf -- "$generation_path" \\
      || echo "[WARN] Не удалось удалить старое поколение $generation_path" >&2
  done
}

[ -s "$CERT_SOURCE/fullchain.pem" ] || {
  echo "[ERROR] $CERT_SOURCE/fullchain.pem не найден" >&2
  exit 1
}
[ -s "$CERT_SOURCE/privkey.pem" ] || {
  echo "[ERROR] $CERT_SOURCE/privkey.pem не найден" >&2
  exit 1
}

openssl x509 -in "$CERT_SOURCE/fullchain.pem" -checkend 0 -noout
CERT_PUBLIC_KEY=$(
  openssl x509 -in "$CERT_SOURCE/fullchain.pem" -pubkey -noout \\
    | openssl pkey -pubin -outform DER 2>/dev/null \\
    | sha256sum \\
    | awk '{ print $1 }'
)
KEY_PUBLIC_KEY=$(
  openssl pkey -in "$CERT_SOURCE/privkey.pem" -pubout -outform DER 2>/dev/null \\
    | sha256sum \\
    | awk '{ print $1 }'
)
[ -n "$CERT_PUBLIC_KEY" ] && [ "$CERT_PUBLIC_KEY" = "$KEY_PUBLIC_KEY" ] || {
  echo "[ERROR] Сертификат и закрытый ключ не образуют пару" >&2
  exit 1
}

install -d -m 700 "$DEPLOY_DIR" "$GENERATIONS_DIR"
[ ! -e "$CURRENT_LINK" ] || [ -L "$CURRENT_LINK" ] || {
  echo "[ERROR] $CURRENT_LINK существует и не является символьной ссылкой" >&2
  exit 1
}
CHANGED=0
if [ -L "$CURRENT_LINK" ]; then
  HAD_PREVIOUS_CURRENT=1
  PREVIOUS_CURRENT_TARGET=$(readlink "$CURRENT_LINK")
fi

if [ ! -s "$CURRENT_LINK/fullchain.pem" ] \\
  || [ ! -s "$CURRENT_LINK/privkey.pem" ] \\
  || ! cmp -s "$CERT_SOURCE/fullchain.pem" "$CURRENT_LINK/fullchain.pem" \\
  || ! cmp -s "$CERT_SOURCE/privkey.pem" "$CURRENT_LINK/privkey.pem"; then
  NEW_GENERATION=$(mktemp -d "$GENERATIONS_DIR/.rwm-generation.XXXXXX")
  install -o root -g root -m 0644 \\
    "$CERT_SOURCE/fullchain.pem" "$NEW_GENERATION/fullchain.pem"
  install -o root -g root -m 0600 \\
    "$CERT_SOURCE/privkey.pem" "$NEW_GENERATION/privkey.pem"
  cmp -s "$CERT_SOURCE/fullchain.pem" "$NEW_GENERATION/fullchain.pem"
  cmp -s "$CERT_SOURCE/privkey.pem" "$NEW_GENERATION/privkey.pem"

  # Маркер создаётся до атомарной публикации: любой поздний сбой потребует retry.
  touch "$RESTART_MARKER"
  GENERATION_NAME=$(basename "$NEW_GENERATION")
  CURRENT_LINK_TMP="$DEPLOY_DIR/.current.$$"
  rm -f "$CURRENT_LINK_TMP"
  ln -s "generations/$GENERATION_NAME" "$CURRENT_LINK_TMP"
  mv -Tf "$CURRENT_LINK_TMP" "$CURRENT_LINK"
  PUBLICATION_COMPLETE=1
  NEW_GENERATION=""
  CURRENT_LINK_TMP=""
  CHANGED=1
fi

if [ "$RESTART_REMNANODE" -eq 1 ] && [ -f "$RESTART_MARKER" ]; then
  cd "$REMNANODE_DIR"
  docker compose up -d --force-recreate remnanode
  docker compose exec -T remnanode test -r /etc/hysteria2/fullchain.pem
  docker compose exec -T remnanode test -r /etc/hysteria2/privkey.pem
  rm -f "$RESTART_MARKER"
  RESTART_COMPLETED=1
fi

if [ "$RESTART_COMPLETED" -eq 1 ] || [ "$PRUNE_GENERATIONS" -eq 1 ]; then
  [ ! -f "$RESTART_MARKER" ] || {
    echo "[ERROR] Нельзя удалять старые сертификаты до успешного перезапуска remnanode" >&2
    exit 1
  }
  prune_generations
fi

trap - EXIT
echo "deploy_changed=$CHANGED"`;

export const HYSTERIA2_RENEW_SCRIPT = `#!/usr/bin/env bash
set -Eeuo pipefail
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

. /opt/certbot/hysteria2.env

exec 9>/run/lock/rwm-hysteria2.lock
flock -n 9 || exit 0

/opt/certbot/ensure-caddy-webroot.sh
docker compose -f /opt/certbot/docker-compose.hysteria2.yml \\
  run --rm certbot renew --quiet --cert-name "$HYSTERIA_DOMAIN"
/opt/certbot/deploy-hysteria2-cert.sh`;

export const HYSTERIA2_SETUP_SCRIPT = `set -Eeuo pipefail
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

HYSTERIA_DOMAIN="{{ hysteria_domain | Домен Hysteria2 (только A-запись на эту ноду) }}"
CERTBOT_EMAIL="{{ certbot_email | Email для Let's Encrypt }}"

CERTBOT_DIR="/opt/certbot"
CERTBOT_ENV="$CERTBOT_DIR/hysteria2.env"
CERTBOT_COMPOSE="$CERTBOT_DIR/docker-compose.hysteria2.yml"
CERTBOT_HELPER="$CERTBOT_DIR/ensure-caddy-webroot.sh"
CERTBOT_DEPLOY="$CERTBOT_DIR/deploy-hysteria2-cert.sh"
CERTBOT_RENEW="$CERTBOT_DIR/renew-hysteria2.sh"
CERTBOT_RENEWAL_CONF="$CERTBOT_DIR/certs/renewal/$HYSTERIA_DOMAIN.conf"
CERTBOT_IMAGE="certbot/certbot:v5.7.0"
CERT_DEPLOY_DIR="/opt/hysteria2-certs"
CERT_MOUNT_SOURCE="$CERT_DEPLOY_DIR/current"
RESTART_MARKER="$CERTBOT_DIR/.hysteria2-restart-required"
CADDY_DIR="/opt/caddy"
CADDY_COMPOSE="$CADDY_DIR/docker-compose.yml"
CADDY_FILE="$CADDY_DIR/Caddyfile"
CADDY_ENV="$CADDY_DIR/.env"
CADDY_WEBROOT="$CADDY_DIR/html"
REMNANODE_DIR="/opt/remnanode"
REMNANODE_COMPOSE="$REMNANODE_DIR/docker-compose.yml"
REMNANODE_OVERRIDE="$REMNANODE_DIR/docker-compose.override.yml"
OVERRIDE_MARKER="# Managed by RWManager: Hysteria2 certificates"
CRON_FILE="/etc/cron.d/rwm-hysteria2-certbot"
SETUP_LOCK_DIR="/run/lock/rwm-hysteria2-setup.lock"
STAGE_DIR=""
TRANSACTION_ACTIVE=0
CADDY_RESTORE_NEEDED=0
REMNANODE_RESTORE_NEEDED=0

fail() {
  echo "[ERROR] $*" >&2
  exit 1
}

backup_file() {
  SOURCE_PATH="$1"
  BACKUP_NAME="$2"
  if [ -e "$SOURCE_PATH" ]; then
    cp -p "$SOURCE_PATH" "$STAGE_DIR/backup-$BACKUP_NAME"
    : > "$STAGE_DIR/backup-$BACKUP_NAME.exists"
  fi
}

restore_file() {
  TARGET_PATH="$1"
  BACKUP_NAME="$2"
  if [ -f "$STAGE_DIR/backup-$BACKUP_NAME.exists" ]; then
    cp -p "$STAGE_DIR/backup-$BACKUP_NAME" "$TARGET_PATH"
  else
    rm -f "$TARGET_PATH"
  fi
}

rollback_transaction() {
  echo "[ROLLBACK] Возвращаем предыдущую рабочую конфигурацию Hysteria2"

  restore_file "$CERTBOT_ENV" certbot-env
  restore_file "$CERTBOT_COMPOSE" certbot-compose
  restore_file "$CERTBOT_HELPER" caddy-helper
  restore_file "$CERTBOT_DEPLOY" deploy-script
  restore_file "$CERTBOT_RENEW" renew-script
  restore_file "$CRON_FILE" cron
  restore_file "$REMNANODE_OVERRIDE" remnanode-override
  restore_file "$RESTART_MARKER" restart-marker
  if [ -f "$STAGE_DIR/backup-certbot-renewal-conf.exists" ]; then
    cp -p "$STAGE_DIR/backup-certbot-renewal-conf" "$CERTBOT_RENEWAL_CONF"
  fi

  if [ -f "$STAGE_DIR/deploy-dir.exists" ]; then
    install -d -m 700 "$CERT_DEPLOY_DIR"
    if [ -L "$STAGE_DIR/deploy-dir.before/current" ]; then
      OLD_CURRENT_TARGET=$(readlink "$STAGE_DIR/deploy-dir.before/current")
      OLD_CURRENT_TMP="$CERT_DEPLOY_DIR/.current.rollback.$$"
      rm -f "$OLD_CURRENT_TMP"
      ln -s "$OLD_CURRENT_TARGET" "$OLD_CURRENT_TMP"
      mv -Tf "$OLD_CURRENT_TMP" "$CERT_DEPLOY_DIR/current"
    elif [ ! -e "$STAGE_DIR/deploy-dir.before/current" ]; then
      rm -f "$CERT_DEPLOY_DIR/current"
    fi
  else
    rm -rf "$CERT_DEPLOY_DIR"
  fi

  if [ "$CADDY_RESTORE_NEEDED" -eq 1 ] \\
    && [ -f "$STAGE_DIR/backup-caddyfile.exists" ]; then
    cat "$STAGE_DIR/backup-caddyfile" > "$CADDY_FILE"
    docker compose -f "$CADDY_COMPOSE" up -d --force-recreate caddy \\
      >/dev/null 2>&1 || true
  fi

  if [ "$REMNANODE_RESTORE_NEEDED" -eq 1 ]; then
    if ! (cd "$REMNANODE_DIR" && docker compose up -d --force-recreate remnanode) \\
      >/dev/null 2>&1; then
      echo "[ROLLBACK ERROR] Не удалось пересоздать remnanode со старой конфигурацией" >&2
      touch "$RESTART_MARKER"
    fi
  fi
}

on_exit() {
  EXIT_CODE=$?
  trap - EXIT
  set +e
  if [ "$EXIT_CODE" -ne 0 ] && [ "$TRANSACTION_ACTIVE" -eq 1 ]; then
    rollback_transaction
  fi
  if [ -n "$STAGE_DIR" ] && [ -d "$STAGE_DIR" ]; then
    rm -rf "$STAGE_DIR"
  fi
  rm -f "$SETUP_LOCK_DIR/pid"
  rmdir "$SETUP_LOCK_DIR" >/dev/null 2>&1 || true
  exit "$EXIT_CODE"
}

[ "$(id -u)" -eq 0 ] || fail "Скрипт нужно запускать от root или через sudo"
command -v docker >/dev/null 2>&1 || fail "Docker не установлен"
command -v curl >/dev/null 2>&1 || fail "curl не установлен"
docker compose version >/dev/null 2>&1 || fail "Docker Compose plugin не установлен"
[ -f /etc/debian_version ] \\
  || fail "Автоматическая установка поддерживает только Debian и Ubuntu"

install -d -m 755 /run/lock
if ! mkdir "$SETUP_LOCK_DIR" 2>/dev/null; then
  LOCK_PID=$(cat "$SETUP_LOCK_DIR/pid" 2>/dev/null || true)
  if [[ "$LOCK_PID" =~ ^[0-9]+$ ]] && kill -0 "$LOCK_PID" 2>/dev/null; then
    fail "Другой процесс настройки Hysteria2 уже запущен (PID $LOCK_PID)"
  fi
  echo "Удаляем оставшийся после прерванного запуска setup-lock..."
  rm -f "$SETUP_LOCK_DIR/pid"
  rmdir "$SETUP_LOCK_DIR" 2>/dev/null \\
    || fail "Не удалось безопасно удалить $SETUP_LOCK_DIR"
  mkdir "$SETUP_LOCK_DIR" \\
    || fail "Другой процесс настройки Hysteria2 уже запущен"
fi
trap on_exit EXIT
printf '%s\\n' "$$" > "$SETUP_LOCK_DIR/pid"

if ! command -v cron >/dev/null 2>&1 \\
  || ! command -v jq >/dev/null 2>&1 \\
  || ! command -v flock >/dev/null 2>&1 \\
  || ! command -v openssl >/dev/null 2>&1; then
  command -v apt-get >/dev/null 2>&1 \\
    || fail "Для установки cron, jq, util-linux и openssl необходим apt-get"
  echo "Установка cron, jq, util-linux и openssl..."
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y cron jq util-linux openssl
fi

exec 9>/run/lock/rwm-hysteria2.lock
flock -n 9 \\
  || fail "Другой процесс настройки или обновления Hysteria2 уже запущен"

[ -f "$CADDY_COMPOSE" ] \\
  || fail "$CADDY_COMPOSE не найден. Сначала установите selfsteal с --caddy"
[ -f "$CADDY_FILE" ] || fail "$CADDY_FILE не найден"
[ -f "$CADDY_ENV" ] || fail "$CADDY_ENV не найден"
[ -f "$REMNANODE_COMPOSE" ] || fail "$REMNANODE_COMPOSE не найден"

docker compose -f "$CADDY_COMPOSE" config --services | grep -qx caddy \\
  || fail "В $CADDY_COMPOSE не найден сервис caddy"
docker compose -f "$CADDY_COMPOSE" ps --status running --services | grep -qx caddy \\
  || fail "Caddy не запущен"
docker compose -f "$REMNANODE_COMPOSE" config --services | grep -qx remnanode \\
  || fail "В $REMNANODE_COMPOSE не найден сервис remnanode"

echo "[1/5] Подготовка транзакции и Certbot..."
install -d -m 755 \\
  "$CERTBOT_DIR/certs" \\
  "$CERTBOT_DIR/work" \\
  "$CERTBOT_DIR/logs" \\
  "$CADDY_WEBROOT/.well-known/acme-challenge"
STAGE_DIR=$(mktemp -d "$CERTBOT_DIR/.hysteria2-stage.XXXXXX")

backup_file "$CERTBOT_ENV" certbot-env
backup_file "$CERTBOT_COMPOSE" certbot-compose
backup_file "$CERTBOT_HELPER" caddy-helper
backup_file "$CERTBOT_DEPLOY" deploy-script
backup_file "$CERTBOT_RENEW" renew-script
backup_file "$CRON_FILE" cron
backup_file "$REMNANODE_OVERRIDE" remnanode-override
backup_file "$RESTART_MARKER" restart-marker
backup_file "$CADDY_FILE" caddyfile
if [ -f "$CERTBOT_RENEWAL_CONF" ]; then
  backup_file "$CERTBOT_RENEWAL_CONF" certbot-renewal-conf
fi
if [ -d "$CERT_DEPLOY_DIR" ]; then
  cp -a "$CERT_DEPLOY_DIR" "$STAGE_DIR/deploy-dir.before"
  : > "$STAGE_DIR/deploy-dir.exists"
fi

printf 'HYSTERIA_DOMAIN=%s\\n' "$HYSTERIA_DOMAIN" > "$STAGE_DIR/hysteria2.env"
chmod 600 "$STAGE_DIR/hysteria2.env"

cat > "$STAGE_DIR/ensure-caddy-webroot.sh" <<'CADDY_HELPER_EOF'
${HYSTERIA2_CADDY_HELPER_SCRIPT}
CADDY_HELPER_EOF
chmod 750 "$STAGE_DIR/ensure-caddy-webroot.sh"

cat > "$STAGE_DIR/deploy-hysteria2-cert.sh" <<'DEPLOY_SCRIPT_EOF'
${HYSTERIA2_DEPLOY_SCRIPT}
DEPLOY_SCRIPT_EOF
chmod 750 "$STAGE_DIR/deploy-hysteria2-cert.sh"

cat > "$STAGE_DIR/renew-hysteria2.sh" <<'RENEW_SCRIPT_EOF'
${HYSTERIA2_RENEW_SCRIPT}
RENEW_SCRIPT_EOF
chmod 750 "$STAGE_DIR/renew-hysteria2.sh"

cat > "$STAGE_DIR/docker-compose.hysteria2.yml" <<CERTBOT_COMPOSE_EOF
# Managed by RWManager: Hysteria2 certificate
services:
  certbot:
    image: $CERTBOT_IMAGE
    volumes:
      - '$CERTBOT_DIR/certs:/etc/letsencrypt'
      - '$CERTBOT_DIR/work:/var/lib/letsencrypt'
      - '$CERTBOT_DIR/logs:/var/log/letsencrypt'
      - '$CADDY_WEBROOT:/var/www/certbot'
CERTBOT_COMPOSE_EOF

docker compose -f "$STAGE_DIR/docker-compose.hysteria2.yml" config --quiet \\
  || fail "Сгенерирован некорректный Certbot compose"

cat > "$STAGE_DIR/rwm-hysteria2-certbot.cron" <<'CRON_EOF'
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

17 3,15 * * * root /opt/certbot/renew-hysteria2.sh >> /opt/certbot/renew.log 2>&1
CRON_EOF

cat > "$STAGE_DIR/remnanode.override.candidate.yml" <<REMNANODE_OVERRIDE_EOF
$OVERRIDE_MARKER
services:
  remnanode:
    volumes:
      - '/opt/hysteria2-certs/current:/etc/hysteria2:ro'
REMNANODE_OVERRIDE_EOF

TRANSACTION_ACTIVE=1
CADDY_RESTORE_NEEDED=1

echo "[2/5] Настройка и проверка HTTP-01 маршрута в Caddy..."
HYSTERIA_ENV_FILE="$STAGE_DIR/hysteria2.env" \\
  "$STAGE_DIR/ensure-caddy-webroot.sh"

echo "[3/5] Получение сертификата Let's Encrypt..."
docker compose -f "$STAGE_DIR/docker-compose.hysteria2.yml" \\
  run --rm certbot certonly \\
  --webroot \\
  --webroot-path /var/www/certbot \\
  --preferred-challenges http \\
  --cert-name "$HYSTERIA_DOMAIN" \\
  -d "$HYSTERIA_DOMAIN" \\
  --non-interactive \\
  --agree-tos \\
  --no-eff-email \\
  --email "$CERTBOT_EMAIL"

CERT_LIVE_DIR="$CERTBOT_DIR/certs/live/$HYSTERIA_DOMAIN"
RENEWAL_CONF="$CERTBOT_DIR/certs/renewal/$HYSTERIA_DOMAIN.conf"
[ -s "$CERT_LIVE_DIR/fullchain.pem" ] || fail "fullchain.pem не создан"
[ -s "$CERT_LIVE_DIR/privkey.pem" ] || fail "privkey.pem не создан"
[ -f "$RENEWAL_CONF" ] || fail "Certbot не создал renewal-конфигурацию"

renewal_uses_expected_webroot() {
  grep -Eq \\
    '^[[:space:]]*authenticator[[:space:]]*=[[:space:]]*webroot[[:space:]]*$' \\
    "$RENEWAL_CONF" \\
    && grep -Eq \\
      '=[[:space:]]*/var/www/certbot[[:space:]]*$' \\
      "$RENEWAL_CONF"
}

RENEWAL_TESTED=0
if ! renewal_uses_expected_webroot; then
  echo "Перевод существующего Certbot-lineage на webroot..."
  docker compose -f "$STAGE_DIR/docker-compose.hysteria2.yml" \\
    run --rm certbot reconfigure \\
    --cert-name "$HYSTERIA_DOMAIN" \\
    --authenticator webroot \\
    --webroot-path /var/www/certbot \\
    --non-interactive
  RENEWAL_TESTED=1
fi

renewal_uses_expected_webroot \\
  || fail "В Certbot renewal не сохранён правильный webroot"

if [ "$RENEWAL_TESTED" -eq 0 ]; then
  echo "Проверка будущего продления через Let's Encrypt staging..."
  docker compose -f "$STAGE_DIR/docker-compose.hysteria2.yml" \\
    run --rm certbot renew \\
    --dry-run \\
    --cert-name "$HYSTERIA_DOMAIN" \\
    --no-directory-hooks
fi

# Сертификат получен и renewal проверен через staging: ACME-маршрут уже нужен постоянно.
CADDY_RESTORE_NEEDED=0

CERT_CHANGED=0
if ! cmp -s "$CERT_LIVE_DIR/fullchain.pem" "$CERT_MOUNT_SOURCE/fullchain.pem" \\
  || ! cmp -s "$CERT_LIVE_DIR/privkey.pem" "$CERT_MOUNT_SOURCE/privkey.pem"; then
  CERT_CHANGED=1
fi
RESTART_REMNANODE=0 HYSTERIA_ENV_FILE="$STAGE_DIR/hysteria2.env" \\
  "$STAGE_DIR/deploy-hysteria2-cert.sh"
CERT_MOUNT_REAL=$(readlink -f "$CERT_MOUNT_SOURCE")
[ -d "$CERT_MOUNT_REAL" ] || fail "Активное поколение сертификата не опубликовано"

echo "[4/5] Безопасное подключение сертификата к Remnawave Node..."
COMPOSE_CHANGED=0
if [ -f "$REMNANODE_OVERRIDE" ] \\
  && grep -qF "$OVERRIDE_MARKER" "$REMNANODE_OVERRIDE" \\
  && ! cmp -s "$STAGE_DIR/remnanode.override.candidate.yml" "$REMNANODE_OVERRIDE"; then
  cat "$STAGE_DIR/remnanode.override.candidate.yml" > "$REMNANODE_OVERRIDE"
  COMPOSE_CHANGED=1
fi

CURRENT_COMPOSE_JSON=$(cd "$REMNANODE_DIR" && docker compose config --format json) \\
  || fail "Не удалось прочитать итоговую конфигурацию Remnawave Node"
HYSTERIA_MOUNT_COUNT=$(printf '%s' "$CURRENT_COMPOSE_JSON" | jq -r '
  [.services.remnanode.volumes[]? | select(.target == "/etc/hysteria2")] | length
')

if [ "$HYSTERIA_MOUNT_COUNT" -eq 0 ]; then
  if [ ! -e "$REMNANODE_OVERRIDE" ]; then
    cp -p "$STAGE_DIR/remnanode.override.candidate.yml" "$REMNANODE_OVERRIDE"
    COMPOSE_CHANGED=1
  elif ! grep -qF "$OVERRIDE_MARKER" "$REMNANODE_OVERRIDE"; then
    fail "$REMNANODE_OVERRIDE уже существует и не управляется RWManager. Добавьте read-only mount /opt/hysteria2-certs/current -> /etc/hysteria2 вручную"
  else
    fail "Управляемый override не добавил mount /etc/hysteria2"
  fi
fi

FINAL_COMPOSE_JSON=$(cd "$REMNANODE_DIR" && docker compose config --format json) \\
  || fail "Итоговая конфигурация Remnawave Node некорректна"
if ! printf '%s' "$FINAL_COMPOSE_JSON" | jq -e --arg source "$CERT_MOUNT_SOURCE" '
  [.services.remnanode.volumes[]? | select(.target == "/etc/hysteria2")] as $mounts
  | ($mounts | length) == 1
    and $mounts[0].type == "bind"
    and $mounts[0].source == $source
    and $mounts[0].read_only == true
' >/dev/null; then
  fail "Target /etc/hysteria2 занят другим или небезопасным mount"
fi

LIVE_MOUNT_OK=0
REMNANODE_CID=$(cd "$REMNANODE_DIR" && docker compose ps -q remnanode)
if [ -n "$REMNANODE_CID" ] \\
  && docker inspect "$REMNANODE_CID" | jq -e \\
    --arg source "$CERT_MOUNT_SOURCE" \\
    --arg realSource "$CERT_MOUNT_REAL" '
    [.[0].Mounts[]? | select(
      .Destination == "/etc/hysteria2"
      and (.Source == $source or .Source == $realSource)
      and .RW == false
    )] | length == 1
  ' >/dev/null; then
  LIVE_MOUNT_OK=1
fi

PENDING_RESTART=0
[ ! -f "$RESTART_MARKER" ] || PENDING_RESTART=1
REMNANODE_RECREATED=0
if [ "$COMPOSE_CHANGED" -eq 1 ] \\
  || [ "$CERT_CHANGED" -eq 1 ] \\
  || [ "$LIVE_MOUNT_OK" -eq 0 ] \\
  || [ "$PENDING_RESTART" -eq 1 ]; then
  REMNANODE_RESTORE_NEEDED=1
  (cd "$REMNANODE_DIR" && docker compose up -d --force-recreate remnanode) \\
    || fail "Не удалось пересоздать контейнер remnanode"
  REMNANODE_RECREATED=1
fi

(
  cd "$REMNANODE_DIR"
  docker compose exec -T remnanode test -r /etc/hysteria2/fullchain.pem
  docker compose exec -T remnanode test -r /etc/hysteria2/privkey.pem
) || fail "Контейнер remnanode не видит сертификат или закрытый ключ"
if [ "$REMNANODE_RECREATED" -eq 1 ]; then
  rm -f "$RESTART_MARKER"
fi

echo "[5/5] Установка автоматического обновления..."
install -o root -g root -m 600 "$STAGE_DIR/hysteria2.env" "$CERTBOT_ENV"
install -o root -g root -m 750 "$STAGE_DIR/ensure-caddy-webroot.sh" "$CERTBOT_HELPER"
install -o root -g root -m 750 "$STAGE_DIR/deploy-hysteria2-cert.sh" "$CERTBOT_DEPLOY"
install -o root -g root -m 750 "$STAGE_DIR/renew-hysteria2.sh" "$CERTBOT_RENEW"
install -o root -g root -m 644 "$STAGE_DIR/docker-compose.hysteria2.yml" "$CERTBOT_COMPOSE"
install -o root -g root -m 644 "$STAGE_DIR/rwm-hysteria2-certbot.cron" "$CRON_FILE"

if ! (systemctl enable --now cron 2>/dev/null || service cron start 2>/dev/null); then
  fail "Не удалось запустить планировщик cron"
fi

TRANSACTION_ACTIVE=0

# Cleanup is deliberately post-commit: rollback may still need every old
# generation until all configuration and cron changes have succeeded.
if ! PRUNE_GENERATIONS=1 RESTART_REMNANODE=0 \\
  HYSTERIA_ENV_FILE="$CERTBOT_ENV" \\
  "$CERTBOT_DEPLOY"; then
  echo "[WARN] Настройка завершена, но старые поколения сертификатов не очищены" >&2
fi

echo ""
echo "=== Hysteria2: подготовка ноды завершена ==="
echo "certificateFile: /etc/hysteria2/fullchain.pem"
echo "keyFile:         /etc/hysteria2/privkey.pem"
echo "TCP-порты selfsteal/Caddy не меняются; Hysteria2 может использовать отдельный UDP/443."
echo "Важно: домен должен иметь A-запись на эту ноду без AAAA-записи, так как selfsteal Caddy слушает IPv4."
echo "[INFO] Пути выше существуют внутри remnanode. Если ваша версия Remnawave читает TLS-файлы на панели, сертификат нужно также безопасно доставить и смонтировать в контейнер панели."

UDP_443_LISTENERS=""
if command -v ss >/dev/null 2>&1; then
  UDP_443_LISTENERS=$(ss -H -lun 'sport = :443' 2>/dev/null || true)
fi
if [ -n "$UDP_443_LISTENERS" ]; then
  echo "[WARN] UDP/443 уже занят. Убедитесь, что его слушает ожидаемый процесс."
else
  echo "UDP/443 сейчас свободен. Откройте 443/udp в системном и облачном firewall перед включением inbound."
fi`;
