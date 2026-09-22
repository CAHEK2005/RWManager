export const HYSTERIA2_SCRIPT_ID = 'builtin-setup-hysteria2';
export const HYSTERIA2_RECONFIGURE_SCRIPT_ID =
  'builtin-reconfigure-hysteria2-domain';

const HYSTERIA2_DOMAIN_INPUT =
  '{{ hysteria_domain | Общий домен Hysteria2 (A-записи всех выбранных нод) }}';
const HYSTERIA2_NEW_DOMAIN_INPUT =
  '{{ hysteria_new_domain | Новый общий домен Hysteria2 (A-записи всех выбранных нод) }}';

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
CLUSTER_DOMAIN_MARKER="# BEGIN RWM HYSTERIA CLUSTER ACME: $HYSTERIA_DOMAIN"
CLUSTER_SITE_MARKER="# BEGIN RWM HYSTERIA CLUSTER ACME SITE: $HYSTERIA_DOMAIN"
CADDY_TMP=$(mktemp "$CADDY_DIR/Caddyfile.rwm.XXXXXX")
# Старые managed-маршруты сохраняем: они могут быть нужны прежнему сертификату
# при откате смены домена.
cp -p "$CADDY_FILE" "$CADDY_TMP"

if grep -qFx "SELF_STEAL_DOMAIN=$HYSTERIA_DOMAIN" "$CADDY_ENV"; then
  if grep -qF "$CLUSTER_DOMAIN_MARKER" "$CADDY_TMP"; then
    :
  elif ! grep -qF "$SAME_DOMAIN_MARKER" "$CADDY_TMP"; then
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
elif grep -qFx "$CLUSTER_SITE_MARKER" "$CADDY_TMP"; then
  :
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
  docker compose -f "$CADDY_COMPOSE" exec -T --interactive=false caddy \\
    caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile </dev/null \\
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
          && docker compose exec -T --interactive=false remnanode \\
            test -r /etc/hysteria2/fullchain.pem </dev/null \\
          && docker compose exec -T --interactive=false remnanode \\
            test -r /etc/hysteria2/privkey.pem </dev/null
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
  docker compose exec -T --interactive=false remnanode \\
    test -r /etc/hysteria2/fullchain.pem </dev/null
  docker compose exec -T --interactive=false remnanode \\
    test -r /etc/hysteria2/privkey.pem </dev/null
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
RENEW_STATUS=0
timeout --foreground --kill-after=30s 15m \\
  docker compose --progress plain \\
  -f /opt/certbot/docker-compose.hysteria2.yml \\
  run --rm -T certbot renew --quiet \\
  --cert-name "$HYSTERIA_DOMAIN" \\
  --no-random-sleep-on-renew </dev/null \\
  || RENEW_STATUS=$?
case "$RENEW_STATUS" in
  0) ;;
  124|137)
    echo "[ERROR] Certbot renew не завершился за 15 минут" >&2
    exit 1
    ;;
  *)
    echo "[ERROR] Certbot renew завершился с кодом $RENEW_STATUS" >&2
    exit "$RENEW_STATUS"
    ;;
esac
/opt/certbot/deploy-hysteria2-cert.sh`;

export const HYSTERIA2_SETUP_SCRIPT = `set -Eeuo pipefail
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

HYSTERIA_DOMAIN="${HYSTERIA2_DOMAIN_INPUT}"
CERTBOT_EMAIL="{{ certbot_email | Email для Let's Encrypt }}"

CERTBOT_DIR="/opt/certbot"
CERTBOT_ENV="$CERTBOT_DIR/hysteria2.env"
CERTBOT_COMPOSE="$CERTBOT_DIR/docker-compose.hysteria2.yml"
CERTBOT_HELPER="$CERTBOT_DIR/ensure-caddy-webroot.sh"
CERTBOT_DEPLOY="$CERTBOT_DIR/deploy-hysteria2-cert.sh"
CERTBOT_RENEW="$CERTBOT_DIR/renew-hysteria2.sh"
CERTBOT_RENEWAL_CONF="$CERTBOT_DIR/certs/renewal/$HYSTERIA_DOMAIN.conf"
CERTBOT_IMAGE="certbot/certbot:v5.7.0"
LINEAGE_MARKER_DIR="$CERTBOT_DIR/rwm-hysteria2-lineages"
LINEAGE_MARKER="$LINEAGE_MARKER_DIR/$HYSTERIA_DOMAIN"
HYSTERIA_REQUIRE_MANAGED_LINEAGE="\${HYSTERIA_REQUIRE_MANAGED_LINEAGE:-0}"
HYSTERIA_RECONFIGURE_MODE="\${HYSTERIA_RECONFIGURE_MODE:-0}"
HYSTERIA_PREVIOUS_DOMAIN_FOR_RECOVERY="\${HYSTERIA_PREVIOUS_DOMAIN_FOR_RECOVERY:-}"
HYSTERIA_CLUSTER_MANAGED="\${HYSTERIA_CLUSTER_MANAGED:-0}"
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
ROLLBACK_FAILED=0
ROLLBACK_HAD_CURRENT=0
ROLLBACK_CURRENT_TARGET=""
ROLLBACK_HYSTERIA_DOMAIN="$HYSTERIA_DOMAIN"
ROLLBACK_CERT_HASH=""
ROLLBACK_KEY_HASH=""

fail() {
  echo "[ERROR] $*" >&2
  exit 1
}

is_valid_hostname() {
  local value="$1"
  local label=""
  local labels=()

  [ "\${#value}" -ge 3 ] && [ "\${#value}" -le 253 ] || return 1
  [ "$value" = "\${value,,}" ] || return 1
  [[ "$value" != *..* && "$value" == *.* ]] || return 1
  IFS='.' read -r -a labels <<< "$value"
  for label in "\${labels[@]}"; do
    [ "\${#label}" -ge 1 ] && [ "\${#label}" -le 63 ] || return 1
    [[ "$label" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?$ ]] || return 1
  done
}

certificate_has_exact_dns_san() {
  local certificate="$1"
  local expected_domain="$2"
  local san_domains=""

  san_domains=$(
    openssl x509 -in "$certificate" -noout -ext subjectAltName 2>/dev/null \\
      | grep -oE 'DNS:[^,[:space:]]+' \\
      | sed 's/^DNS://' \\
      | sort -u
  ) || return 1
  [ "$san_domains" = "$expected_domain" ]
}

lineage_marker_is_valid() {
  local marker_mode=""

  [ -f "$LINEAGE_MARKER" ] && [ ! -L "$LINEAGE_MARKER" ] || return 1
  [ "$(stat -c '%u' "$LINEAGE_MARKER")" -eq 0 ] || return 1
  marker_mode=$(stat -c '%a' "$LINEAGE_MARKER") || return 1
  (( (8#$marker_mode & 8#022) == 0 )) || return 1
  [ "$(cat "$LINEAGE_MARKER")" = "$HYSTERIA_DOMAIN" ]
}

reserve_lineage_marker() {
  local marker_tmp=""

  if [ -e "$LINEAGE_MARKER_DIR" ]; then
    [ -d "$LINEAGE_MARKER_DIR" ] && [ ! -L "$LINEAGE_MARKER_DIR" ] \\
      || fail "$LINEAGE_MARKER_DIR имеет небезопасный тип"
    [ "$(stat -c '%u' "$LINEAGE_MARKER_DIR")" -eq 0 ] \\
      || fail "$LINEAGE_MARKER_DIR не принадлежит root"
  fi
  install -d -o root -g root -m 700 "$LINEAGE_MARKER_DIR"
  if [ -e "$LINEAGE_MARKER" ] || [ -L "$LINEAGE_MARKER" ]; then
    lineage_marker_is_valid \\
      || fail "Маркер Certbot lineage для $HYSTERIA_DOMAIN повреждён или небезопасен"
    return 0
  fi

  marker_tmp=$(mktemp "$LINEAGE_MARKER_DIR/.marker.XXXXXX")
  printf '%s\\n' "$HYSTERIA_DOMAIN" > "$marker_tmp"
  chown root:root "$marker_tmp"
  chmod 600 "$marker_tmp"
  mv -Tf "$marker_tmp" "$LINEAGE_MARKER"
}

run_certbot_bounded() {
  local timeout_value="$1"
  local operation="$2"
  local certbot_status=0
  shift 2

  timeout --foreground --kill-after=30s "$timeout_value" \\
    docker compose --progress plain \\
    -f "$STAGE_DIR/docker-compose.hysteria2.yml" \\
    run --rm -T certbot "$@" </dev/null \\
    || certbot_status=$?
  case "$certbot_status" in
    0) ;;
    124|137) fail "$operation не завершилась за $timeout_value" ;;
    *) fail "$operation завершилась с кодом $certbot_status" ;;
  esac
}

atomic_install() {
  local source_path="$1"
  local target_path="$2"
  local target_mode="$3"
  local target_dir=""
  local install_tmp=""

  target_dir=$(dirname "$target_path")
  install_tmp=$(mktemp "$target_dir/.rwm-install.XXXXXX")
  if ! install -o root -g root -m "$target_mode" "$source_path" "$install_tmp" \\
    || ! sync -f "$install_tmp" \\
    || ! mv -Tf "$install_tmp" "$target_path" \\
    || ! sync -f "$target_path"; then
    rm -f "$install_tmp"
    return 1
  fi
}

publish_runtime_configuration() {
  atomic_install "$STAGE_DIR/ensure-caddy-webroot.sh" "$CERTBOT_HELPER" 750 \\
    || fail "Не удалось атомарно установить Caddy helper"
  atomic_install "$STAGE_DIR/deploy-hysteria2-cert.sh" "$CERTBOT_DEPLOY" 750 \\
    || fail "Не удалось атомарно установить deploy helper"
  atomic_install "$STAGE_DIR/renew-hysteria2.sh" "$CERTBOT_RENEW" 750 \\
    || fail "Не удалось атомарно установить renewal helper"
  atomic_install "$STAGE_DIR/docker-compose.hysteria2.yml" "$CERTBOT_COMPOSE" 644 \\
    || fail "Не удалось атомарно установить Certbot compose"
  atomic_install "$STAGE_DIR/rwm-hysteria2-certbot.cron" "$CRON_FILE" 644 \\
    || fail "Не удалось атомарно установить cron"
  # env — commit point для cron: он видит целиком старое либо целиком новое состояние.
  atomic_install "$STAGE_DIR/hysteria2.env" "$CERTBOT_ENV" 600 \\
    || fail "Не удалось атомарно установить Hysteria2 env"
}

verify_remnanode_certificate_mount() {
  local expected_domain="$1"
  local expected_source="$2"
  local expected_real_source=""
  local remnanode_cid=""
  local cert_file=""
  local host_hash=""
  local container_hash=""

  expected_real_source=$(readlink -f "$expected_source") || return 1
  [ -d "$expected_real_source" ] || return 1
  remnanode_cid=$(cd "$REMNANODE_DIR" \\
    && timeout --foreground --kill-after=5s 20s \\
      docker compose ps -q remnanode) \\
    || return 1
  [ -n "$remnanode_cid" ] || return 1

  timeout --foreground --kill-after=5s 20s \\
    docker inspect "$remnanode_cid" | jq -e \\
    --arg source "$expected_source" \\
    --arg realSource "$expected_real_source" '
      .[0].State.Running == true
      and (
        [.[0].Mounts[]? | select(
          .Destination == "/etc/hysteria2"
          and (.Source == $source or .Source == $realSource)
          and .RW == false
        )] | length
      ) == 1
    ' >/dev/null || return 1

  for cert_file in fullchain.pem privkey.pem; do
    host_hash=$(sha256sum "$expected_source/$cert_file" | awk '{ print $1 }') \\
      || return 1
    container_hash=$(
      (
        cd "$REMNANODE_DIR" \\
          && timeout --foreground --kill-after=5s 20s \\
            docker compose exec -T --interactive=false remnanode \\
            cat "/etc/hysteria2/$cert_file" </dev/null
      ) | sha256sum | awk '{ print $1 }'
    ) || return 1
    [ -n "$host_hash" ] && [ "$host_hash" = "$container_hash" ] || return 1
  done

  openssl x509 -in "$expected_source/fullchain.pem" \\
    -checkhost "$expected_domain" -noout >/dev/null 2>&1
}

verify_remnanode_certificate_mount_with_retry() {
  local expected_domain="$1"
  local expected_source="$2"
  local attempt=0

  for attempt in 1 2 3 4 5 6 7 8 9 10; do
    if verify_remnanode_certificate_mount "$expected_domain" "$expected_source"; then
      return 0
    fi
    sleep 1
  done
  return 1
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
  local target_path="$1"
  local backup_name="$2"
  local target_dir=""
  local restore_tmp=""

  if [ -f "$STAGE_DIR/backup-$backup_name.exists" ]; then
    target_dir=$(dirname "$target_path")
    restore_tmp=$(mktemp "$target_dir/.rwm-restore.XXXXXX") || return 1
    if ! cp -p "$STAGE_DIR/backup-$backup_name" "$restore_tmp" \\
      || ! mv -Tf "$restore_tmp" "$target_path"; then
      rm -f "$restore_tmp"
      return 1
    fi
  else
    rm -f "$target_path"
  fi
}

rollback_transaction() {
  echo "[ROLLBACK] Возвращаем предыдущую рабочую конфигурацию Hysteria2"
  ROLLBACK_FAILED=0

  restore_file "$CERTBOT_ENV" certbot-env || ROLLBACK_FAILED=1
  restore_file "$CERTBOT_COMPOSE" certbot-compose || ROLLBACK_FAILED=1
  restore_file "$CERTBOT_HELPER" caddy-helper || ROLLBACK_FAILED=1
  restore_file "$CERTBOT_DEPLOY" deploy-script || ROLLBACK_FAILED=1
  restore_file "$CERTBOT_RENEW" renew-script || ROLLBACK_FAILED=1
  restore_file "$CRON_FILE" cron || ROLLBACK_FAILED=1
  restore_file "$REMNANODE_OVERRIDE" remnanode-override || ROLLBACK_FAILED=1
  restore_file "$RESTART_MARKER" restart-marker || ROLLBACK_FAILED=1
  if [ -f "$STAGE_DIR/backup-certbot-renewal-conf.exists" ]; then
    restore_file "$CERTBOT_RENEWAL_CONF" certbot-renewal-conf \\
      || ROLLBACK_FAILED=1
  fi

  if [ -f "$STAGE_DIR/deploy-dir.exists" ]; then
    install -d -m 700 "$CERT_DEPLOY_DIR" || ROLLBACK_FAILED=1
    if [ -L "$STAGE_DIR/deploy-dir.before/current" ]; then
      OLD_CURRENT_TARGET=$(readlink "$STAGE_DIR/deploy-dir.before/current") \\
        || ROLLBACK_FAILED=1
      OLD_CURRENT_TMP="$CERT_DEPLOY_DIR/.current.rollback.$$"
      rm -f "$OLD_CURRENT_TMP" || ROLLBACK_FAILED=1
      if ! ln -s "$OLD_CURRENT_TARGET" "$OLD_CURRENT_TMP" \\
        || ! mv -Tf "$OLD_CURRENT_TMP" "$CERT_DEPLOY_DIR/current"; then
        rm -f "$OLD_CURRENT_TMP"
        ROLLBACK_FAILED=1
      fi
    elif [ ! -e "$STAGE_DIR/deploy-dir.before/current" ]; then
      rm -f "$CERT_DEPLOY_DIR/current" || ROLLBACK_FAILED=1
    fi
  else
    rm -rf "$CERT_DEPLOY_DIR" || ROLLBACK_FAILED=1
  fi

  if [ "$ROLLBACK_HAD_CURRENT" -eq 1 ]; then
    [ -L "$CERT_MOUNT_SOURCE" ] \\
      && [ "$(readlink "$CERT_MOUNT_SOURCE")" = "$ROLLBACK_CURRENT_TARGET" ] \\
      && [ "$(sha256sum "$CERT_MOUNT_SOURCE/fullchain.pem" | awk '{ print $1 }')" = "$ROLLBACK_CERT_HASH" ] \\
      && [ "$(sha256sum "$CERT_MOUNT_SOURCE/privkey.pem" | awk '{ print $1 }')" = "$ROLLBACK_KEY_HASH" ] \\
      && openssl x509 -in "$CERT_MOUNT_SOURCE/fullchain.pem" \\
        -checkhost "$ROLLBACK_HYSTERIA_DOMAIN" -noout >/dev/null 2>&1 \\
      || ROLLBACK_FAILED=1
  fi

  if [ "$CADDY_RESTORE_NEEDED" -eq 1 ] \\
    && [ -f "$STAGE_DIR/backup-caddyfile.exists" ]; then
    if ! cat "$STAGE_DIR/backup-caddyfile" > "$CADDY_FILE" \\
      || ! docker compose -f "$CADDY_COMPOSE" up -d --force-recreate caddy \\
        >/dev/null 2>&1; then
      ROLLBACK_FAILED=1
    fi
  fi

  if [ "$REMNANODE_RESTORE_NEEDED" -eq 1 ]; then
    if ! (cd "$REMNANODE_DIR" && docker compose up -d --force-recreate remnanode) \\
      >/dev/null 2>&1; then
      echo "[ROLLBACK ERROR] Не удалось пересоздать remnanode со старой конфигурацией" >&2
      ROLLBACK_FAILED=1
    elif [ "$ROLLBACK_HAD_CURRENT" -eq 1 ] \\
      && ! verify_remnanode_certificate_mount_with_retry \\
        "$ROLLBACK_HYSTERIA_DOMAIN" "$CERT_MOUNT_SOURCE"; then
      echo "[ROLLBACK ERROR] remnanode не подтверждён на старом сертификате" >&2
      ROLLBACK_FAILED=1
    fi
  fi

  if [ "$ROLLBACK_FAILED" -ne 0 ]; then
    touch "$RESTART_MARKER" 2>/dev/null || true
    echo "[ROLLBACK ERROR] Автоматический откат неполон; требуется ручная проверка" >&2
    return 1
  fi
  echo "[ROLLBACK] Предыдущая конфигурация подтверждена"
}

on_exit() {
  EXIT_CODE=$?
  trap - EXIT
  set +e
  if [ -n "$STAGE_DIR" ] \\
    && [ -f "$STAGE_DIR/docker-compose.hysteria2.yml" ]; then
    timeout --foreground --kill-after=5s 30s \\
      docker compose --progress plain \\
      -f "$STAGE_DIR/docker-compose.hysteria2.yml" \\
      down --remove-orphans --timeout 10 >/dev/null 2>&1 || true
  fi
  if [ "$EXIT_CODE" -ne 0 ] && [ "$TRANSACTION_ACTIVE" -eq 1 ]; then
    rollback_transaction || EXIT_CODE=1
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
is_valid_hostname "$HYSTERIA_DOMAIN" \\
  || fail "Домен Hysteria2 некорректен"
case "$HYSTERIA_REQUIRE_MANAGED_LINEAGE" in
  0|1) ;;
  *) fail "HYSTERIA_REQUIRE_MANAGED_LINEAGE должен быть 0 или 1" ;;
esac
case "$HYSTERIA_RECONFIGURE_MODE" in
  0|1) ;;
  *) fail "HYSTERIA_RECONFIGURE_MODE должен быть 0 или 1" ;;
esac
case "$HYSTERIA_CLUSTER_MANAGED" in
  0|1) ;;
  *) fail "HYSTERIA_CLUSTER_MANAGED должен быть 0 или 1" ;;
esac
if [ "$HYSTERIA_RECONFIGURE_MODE" -eq 1 ]; then
  is_valid_hostname "$HYSTERIA_PREVIOUS_DOMAIN_FOR_RECOVERY" \\
    || fail "Не задан корректный предыдущий домен для восстановления"
fi

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
  || ! command -v openssl >/dev/null 2>&1 \\
  || ! command -v timeout >/dev/null 2>&1 \\
  || ! command -v sync >/dev/null 2>&1; then
  command -v apt-get >/dev/null 2>&1 \\
    || fail "Для установки cron, jq, util-linux, openssl и coreutils необходим apt-get"
  echo "Установка cron, jq, util-linux, openssl и coreutils..."
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y \\
    cron jq util-linux openssl coreutils
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
CERT_LIVE_DIR="$CERTBOT_DIR/certs/live/$HYSTERIA_DOMAIN"
RENEWAL_CONF="$CERTBOT_DIR/certs/renewal/$HYSTERIA_DOMAIN.conf"

if [ -e "$RENEWAL_CONF" ] \\
  || [ -e "$CERT_LIVE_DIR" ] \\
  || [ -L "$CERT_LIVE_DIR" ]; then
  [ -f "$RENEWAL_CONF" ] \\
    && [ -s "$CERT_LIVE_DIR/fullchain.pem" ] \\
    && [ -s "$CERT_LIVE_DIR/privkey.pem" ] \\
    || fail "Состояние Certbot lineage для $HYSTERIA_DOMAIN неполное"
  certificate_has_exact_dns_san "$CERT_LIVE_DIR/fullchain.pem" "$HYSTERIA_DOMAIN" \\
    || fail "Certbot lineage содержит не только домен $HYSTERIA_DOMAIN; безопасное переиспользование невозможно"
  if [ "$HYSTERIA_REQUIRE_MANAGED_LINEAGE" -eq 1 ]; then
    lineage_marker_is_valid \\
      || fail "Существующий Certbot lineage для $HYSTERIA_DOMAIN не принадлежит RWManager"
  fi
fi
reserve_lineage_marker

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
if [ -L "$CERT_MOUNT_SOURCE" ] \\
  && [ -s "$CERT_MOUNT_SOURCE/fullchain.pem" ] \\
  && [ -s "$CERT_MOUNT_SOURCE/privkey.pem" ]; then
  ROLLBACK_HAD_CURRENT=1
  ROLLBACK_CURRENT_TARGET=$(readlink "$CERT_MOUNT_SOURCE")
  ROLLBACK_CERT_HASH=$(sha256sum "$CERT_MOUNT_SOURCE/fullchain.pem" | awk '{ print $1 }')
  ROLLBACK_KEY_HASH=$(sha256sum "$CERT_MOUNT_SOURCE/privkey.pem" | awk '{ print $1 }')
  if [ "$HYSTERIA_RECONFIGURE_MODE" -eq 1 ] \\
    && is_valid_hostname "$HYSTERIA_PREVIOUS_DOMAIN_FOR_RECOVERY"; then
    ROLLBACK_HYSTERIA_DOMAIN="$HYSTERIA_PREVIOUS_DOMAIN_FOR_RECOVERY"
  elif [ -f "$STAGE_DIR/backup-certbot-env.exists" ]; then
    PREVIOUS_ENV_DOMAIN=$(
      sed -n 's/^HYSTERIA_DOMAIN=//p' "$STAGE_DIR/backup-certbot-env" \\
        | tr -d '\\r'
    )
    if is_valid_hostname "$PREVIOUS_ENV_DOMAIN"; then
      ROLLBACK_HYSTERIA_DOMAIN="$PREVIOUS_ENV_DOMAIN"
    fi
  fi
fi

{
  printf 'HYSTERIA_DOMAIN=%s\\n' "$HYSTERIA_DOMAIN"
  if [ "$HYSTERIA_RECONFIGURE_MODE" -eq 1 ] \\
    && [ "$HYSTERIA_PREVIOUS_DOMAIN_FOR_RECOVERY" != "$HYSTERIA_DOMAIN" ]; then
    printf 'HYSTERIA_PREVIOUS_DOMAIN=%s\\n' "$HYSTERIA_PREVIOUS_DOMAIN_FOR_RECOVERY"
  fi
} > "$STAGE_DIR/hysteria2.env"
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

if [ "$HYSTERIA_CLUSTER_MANAGED" -eq 1 ]; then
  cat > "$STAGE_DIR/rwm-hysteria2-certbot.cron" <<'CRON_EOF'
# Managed by RWManager backend: cluster renewal is coordinated centrally.
CRON_EOF
else
  cat > "$STAGE_DIR/rwm-hysteria2-certbot.cron" <<'CRON_EOF'
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

17 3,15 * * * root /opt/certbot/renew-hysteria2.sh >> /opt/certbot/renew.log 2>&1
CRON_EOF
fi

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
run_certbot_bounded 10m "Получение сертификата Let's Encrypt" \\
  certonly \\
  --webroot \\
  --webroot-path /var/www/certbot \\
  --preferred-challenges http \\
  --cert-name "$HYSTERIA_DOMAIN" \\
  -d "$HYSTERIA_DOMAIN" \\
  --non-interactive \\
  --agree-tos \\
  --no-eff-email \\
  --email "$CERTBOT_EMAIL"

[ -s "$CERT_LIVE_DIR/fullchain.pem" ] || fail "fullchain.pem не создан"
[ -s "$CERT_LIVE_DIR/privkey.pem" ] || fail "privkey.pem не создан"
[ -f "$RENEWAL_CONF" ] || fail "Certbot не создал renewal-конфигурацию"
openssl x509 -in "$CERT_LIVE_DIR/fullchain.pem" \\
  -checkhost "$HYSTERIA_DOMAIN" -noout \\
  || fail "Полученный сертификат не содержит домен $HYSTERIA_DOMAIN"
certificate_has_exact_dns_san "$CERT_LIVE_DIR/fullchain.pem" "$HYSTERIA_DOMAIN" \\
  || fail "Полученный сертификат содержит неожиданный набор SAN"

renewal_uses_expected_webroot() {
  grep -Eq \\
    '^[[:space:]]*authenticator[[:space:]]*=[[:space:]]*webroot[[:space:]]*$' \\
    "$RENEWAL_CONF" \\
    && awk -F= -v domain="$HYSTERIA_DOMAIN" '
      {
        key = $1
        value = $2
        gsub(/^[[:space:]]+|[[:space:]]+$/, "", key)
        gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
        if (key == domain && value == "/var/www/certbot") found = 1
      }
      END { exit !found }
    ' "$RENEWAL_CONF"
}

RENEWAL_TESTED=0
if ! renewal_uses_expected_webroot; then
  echo "Перевод существующего Certbot-lineage на webroot..."
  run_certbot_bounded 10m "Перенастройка Certbot lineage" \\
    reconfigure \\
    --cert-name "$HYSTERIA_DOMAIN" \\
    --authenticator webroot \\
    --webroot-path /var/www/certbot \\
    --non-interactive
  RENEWAL_TESTED=1
fi

renewal_uses_expected_webroot \\
  || fail "В Certbot renewal не сохранён правильный webroot"

if [ "$RENEWAL_TESTED" -eq 0 ]; then
  echo "Проверка будущего продления через Let's Encrypt staging (лимит 5 минут)..."
  DRY_RUN_STATUS=0
  timeout --foreground --kill-after=30s 5m \\
    docker compose --progress plain \\
    -f "$STAGE_DIR/docker-compose.hysteria2.yml" \\
    run --rm -T certbot renew \\
    --dry-run \\
    --cert-name "$HYSTERIA_DOMAIN" \\
    --no-directory-hooks \\
    --no-random-sleep-on-renew </dev/null \\
    || DRY_RUN_STATUS=$?
  case "$DRY_RUN_STATUS" in
    0)
      echo "Staging-проверка продления успешно завершена."
      ;;
    124|137)
      fail "Staging-проверка Certbot не завершилась за 5 минут"
      ;;
    *)
      fail "Staging-проверка Certbot завершилась с кодом $DRY_RUN_STATUS"
      ;;
  esac
fi

if [ "$HYSTERIA_RECONFIGURE_MODE" -eq 1 ]; then
  echo "Публикация новой renewal-конфигурации перед переключением сертификата..."
  publish_runtime_configuration
fi

CERT_CHANGED=0
if ! cmp -s "$CERT_LIVE_DIR/fullchain.pem" "$CERT_MOUNT_SOURCE/fullchain.pem" \\
  || ! cmp -s "$CERT_LIVE_DIR/privkey.pem" "$CERT_MOUNT_SOURCE/privkey.pem"; then
  CERT_CHANGED=1
fi
RESTART_REMNANODE=0 HYSTERIA_ENV_FILE="$STAGE_DIR/hysteria2.env" \\
  "$STAGE_DIR/deploy-hysteria2-cert.sh"
if [ "$CERT_CHANGED" -eq 1 ]; then
  REMNANODE_RESTORE_NEEDED=1
fi
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

# Любая поздняя ошибка должна пересоздать и заново проверить прежний container state.
REMNANODE_RESTORE_NEEDED=1
verify_remnanode_certificate_mount_with_retry \\
  "$HYSTERIA_DOMAIN" "$CERT_MOUNT_SOURCE" \\
  || fail "Контейнер remnanode использует не тот сертификат или небезопасный mount"
if [ "$REMNANODE_RECREATED" -eq 1 ]; then
  rm -f "$RESTART_MARKER"
fi

echo "[5/5] Установка автоматического обновления..."
if [ "$HYSTERIA_RECONFIGURE_MODE" -eq 0 ]; then
  publish_runtime_configuration
else
  echo "Renewal-конфигурация уже опубликована атомарно."
fi

if ! (systemctl enable --now cron 2>/dev/null || service cron start 2>/dev/null); then
  fail "Не удалось запустить планировщик cron"
fi

CADDY_RESTORE_NEEDED=0
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
if [ "$HYSTERIA_CLUSTER_MANAGED" -eq 1 ]; then
  echo "Сертификат и продление управляются централизованно RWManager для всех DNS-нод домена."
else
  echo "Важно: домен должен иметь A-запись только на эту ноду без AAAA-записи, так как используется локальный HTTP-01."
fi
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

const HYSTERIA2_RECONFIGURE_SETUP_SCRIPT = HYSTERIA2_SETUP_SCRIPT.replace(
  `HYSTERIA_DOMAIN="${HYSTERIA2_DOMAIN_INPUT}"`,
  'HYSTERIA_DOMAIN="$REQUESTED_HYSTERIA_DOMAIN"',
);

export const HYSTERIA2_RECONFIGURE_SCRIPT = `set -Eeuo pipefail
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

MANAGED_ENV="/opt/certbot/hysteria2.env"
MANAGED_COMPOSE="/opt/certbot/docker-compose.hysteria2.yml"
MANAGED_HELPER="/opt/certbot/ensure-caddy-webroot.sh"
MANAGED_DEPLOY="/opt/certbot/deploy-hysteria2-cert.sh"
MANAGED_RENEW="/opt/certbot/renew-hysteria2.sh"
CURRENT_CERT_DIR="/opt/hysteria2-certs/current"
LINEAGE_MARKER_DIR="/opt/certbot/rwm-hysteria2-lineages"
REQUESTED_HYSTERIA_DOMAIN="${HYSTERIA2_NEW_DOMAIN_INPUT}"

reconfigure_fail() {
  echo "[ERROR] $*" >&2
  exit 1
}

is_valid_hostname() {
  local value="$1"
  local label=""
  local labels=()

  [ "\${#value}" -ge 3 ] && [ "\${#value}" -le 253 ] || return 1
  [ "$value" = "\${value,,}" ] || return 1
  [[ "$value" != *..* && "$value" == *.* ]] || return 1
  IFS='.' read -r -a labels <<< "$value"
  for label in "\${labels[@]}"; do
    [ "\${#label}" -ge 1 ] && [ "\${#label}" -le 63 ] || return 1
    [[ "$label" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?$ ]] || return 1
  done
}

certificate_has_exact_dns_san() {
  local certificate="$1"
  local expected_domain="$2"
  local san_domains=""

  san_domains=$(
    openssl x509 -in "$certificate" -noout -ext subjectAltName 2>/dev/null \\
      | grep -oE 'DNS:[^,[:space:]]+' \\
      | sed 's/^DNS://' \\
      | sort -u
  ) || return 1
  [ "$san_domains" = "$expected_domain" ]
}

renewal_uses_expected_webroot_for() {
  local renewal_file="$1"
  local expected_domain="$2"

  grep -Eq \\
    '^[[:space:]]*authenticator[[:space:]]*=[[:space:]]*webroot[[:space:]]*$' \\
    "$renewal_file" \\
    && awk -F= -v domain="$expected_domain" '
      {
        key = $1
        value = $2
        gsub(/^[[:space:]]+|[[:space:]]+$/, "", key)
        gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
        if (key == domain && value == "/var/www/certbot") found = 1
      }
      END { exit !found }
    ' "$renewal_file"
}

lineage_marker_is_valid_for() {
  local domain="$1"
  local marker="$LINEAGE_MARKER_DIR/$domain"
  local marker_mode=""

  [ -f "$marker" ] && [ ! -L "$marker" ] || return 1
  [ "$(stat -c '%u' "$marker")" -eq 0 ] || return 1
  marker_mode=$(stat -c '%a' "$marker") || return 1
  (( (8#$marker_mode & 8#022) == 0 )) || return 1
  [ "$(cat "$marker")" = "$domain" ]
}

reserve_lineage_marker_for() {
  local domain="$1"
  local marker="$LINEAGE_MARKER_DIR/$domain"
  local marker_tmp=""

  if [ -e "$LINEAGE_MARKER_DIR" ]; then
    [ -d "$LINEAGE_MARKER_DIR" ] && [ ! -L "$LINEAGE_MARKER_DIR" ] \\
      || reconfigure_fail "$LINEAGE_MARKER_DIR имеет небезопасный тип"
    [ "$(stat -c '%u' "$LINEAGE_MARKER_DIR")" -eq 0 ] \\
      || reconfigure_fail "$LINEAGE_MARKER_DIR не принадлежит root"
  fi
  install -d -o root -g root -m 700 "$LINEAGE_MARKER_DIR"
  if [ -e "$marker" ] || [ -L "$marker" ]; then
    lineage_marker_is_valid_for "$domain" \\
      || reconfigure_fail "Маркер Certbot lineage для $domain повреждён или небезопасен"
    return 0
  fi

  marker_tmp=$(mktemp "$LINEAGE_MARKER_DIR/.marker.XXXXXX")
  printf '%s\\n' "$domain" > "$marker_tmp"
  chown root:root "$marker_tmp"
  chmod 600 "$marker_tmp"
  mv -Tf "$marker_tmp" "$marker"
}

[ "$(id -u)" -eq 0 ] \\
  || reconfigure_fail "Скрипт нужно запускать от root или через sudo"
command -v openssl >/dev/null 2>&1 \\
  || reconfigure_fail "openssl не установлен"

for managed_file in \\
  "$MANAGED_ENV" \\
  "$MANAGED_COMPOSE" \\
  "$MANAGED_HELPER" \\
  "$MANAGED_DEPLOY" \\
  "$MANAGED_RENEW"; do
  [ -f "$managed_file" ] \\
    || reconfigure_fail "$managed_file не найден. Сначала выполните «Настройка Hysteria2»"
  [ "$(stat -c '%u' "$managed_file")" -eq 0 ] \\
    || reconfigure_fail "$managed_file не принадлежит root"
done

grep -qF '# Managed by RWManager: Hysteria2 certificate' "$MANAGED_COMPOSE" \\
  || reconfigure_fail "$MANAGED_COMPOSE не является конфигурацией RWManager"
[ "$(grep -c '^HYSTERIA_DOMAIN=' "$MANAGED_ENV" || true)" -eq 1 ] \\
  || reconfigure_fail "В $MANAGED_ENV отсутствует однозначный текущий домен"
[ "$(grep -c '^HYSTERIA_PREVIOUS_DOMAIN=' "$MANAGED_ENV" || true)" -le 1 ] \\
  || reconfigure_fail "В $MANAGED_ENV неоднозначно задан предыдущий домен"

CURRENT_HYSTERIA_DOMAIN=$(
  sed -n 's/^HYSTERIA_DOMAIN=//p' "$MANAGED_ENV" | tr -d '\\r'
)
PREVIOUS_HYSTERIA_DOMAIN=$(
  sed -n 's/^HYSTERIA_PREVIOUS_DOMAIN=//p' "$MANAGED_ENV" | tr -d '\\r'
)
is_valid_hostname "$CURRENT_HYSTERIA_DOMAIN" \\
  || reconfigure_fail "Текущий домен в $MANAGED_ENV некорректен"
if [ -n "$PREVIOUS_HYSTERIA_DOMAIN" ]; then
  is_valid_hostname "$PREVIOUS_HYSTERIA_DOMAIN" \\
    || reconfigure_fail "Предыдущий домен в $MANAGED_ENV некорректен"
fi
is_valid_hostname "$REQUESTED_HYSTERIA_DOMAIN" \\
  || reconfigure_fail "Новый домен Hysteria2 некорректен"

CURRENT_RENEWAL_CONF="/opt/certbot/certs/renewal/$CURRENT_HYSTERIA_DOMAIN.conf"
CURRENT_LIVE_DIR="/opt/certbot/certs/live/$CURRENT_HYSTERIA_DOMAIN"
[ -f "$CURRENT_RENEWAL_CONF" ] \\
  && [ -s "$CURRENT_LIVE_DIR/fullchain.pem" ] \\
  && [ -s "$CURRENT_LIVE_DIR/privkey.pem" ] \\
  || reconfigure_fail "Certbot lineage текущего домена неполное"
renewal_uses_expected_webroot_for \\
  "$CURRENT_RENEWAL_CONF" "$CURRENT_HYSTERIA_DOMAIN" \\
  || reconfigure_fail "Текущий Certbot lineage не использует ожидаемый webroot RWManager"
certificate_has_exact_dns_san \\
  "$CURRENT_LIVE_DIR/fullchain.pem" "$CURRENT_HYSTERIA_DOMAIN" \\
  || reconfigure_fail "Текущий Certbot lineage содержит неожиданный набор SAN"
reserve_lineage_marker_for "$CURRENT_HYSTERIA_DOMAIN"

[ -L "$CURRENT_CERT_DIR" ] \\
  || reconfigure_fail "$CURRENT_CERT_DIR не является активной ссылкой сертификата"
[ -s "$CURRENT_CERT_DIR/fullchain.pem" ] \\
  || reconfigure_fail "Текущий fullchain.pem не найден"
[ -s "$CURRENT_CERT_DIR/privkey.pem" ] \\
  || reconfigure_fail "Текущий privkey.pem не найден"
openssl x509 -in "$CURRENT_CERT_DIR/fullchain.pem" -checkend 0 -noout \\
  || reconfigure_fail "Текущий сертификат просрочен или повреждён"
if certificate_has_exact_dns_san \\
  "$CURRENT_CERT_DIR/fullchain.pem" "$CURRENT_HYSTERIA_DOMAIN"; then
  ACTIVE_CERT_DOMAIN="$CURRENT_HYSTERIA_DOMAIN"
elif [ "$REQUESTED_HYSTERIA_DOMAIN" != "$CURRENT_HYSTERIA_DOMAIN" ] \\
  && lineage_marker_is_valid_for "$REQUESTED_HYSTERIA_DOMAIN" \\
  && certificate_has_exact_dns_san \\
    "$CURRENT_CERT_DIR/fullchain.pem" "$REQUESTED_HYSTERIA_DOMAIN"; then
  ACTIVE_CERT_DOMAIN="$REQUESTED_HYSTERIA_DOMAIN"
  echo "Обнаружено прерванное переключение на $REQUESTED_HYSTERIA_DOMAIN; продолжаем восстановление."
elif [ -n "$PREVIOUS_HYSTERIA_DOMAIN" ] \\
  && lineage_marker_is_valid_for "$PREVIOUS_HYSTERIA_DOMAIN" \\
  && certificate_has_exact_dns_san \\
    "$CURRENT_CERT_DIR/fullchain.pem" "$PREVIOUS_HYSTERIA_DOMAIN"; then
  ACTIVE_CERT_DOMAIN="$PREVIOUS_HYSTERIA_DOMAIN"
  echo "Обнаружено незавершённое переключение с $PREVIOUS_HYSTERIA_DOMAIN; продолжаем восстановление."
else
  reconfigure_fail "Активный сертификат не соответствует ни текущему, ни запрошенному домену"
fi

if [ "$REQUESTED_HYSTERIA_DOMAIN" = "$CURRENT_HYSTERIA_DOMAIN" ]; then
  echo "Домен уже установлен: $CURRENT_HYSTERIA_DOMAIN"
  echo "Будет выполнена идемпотентная проверка сертификата и renewal."
else
  NEW_RENEWAL_CONF="/opt/certbot/certs/renewal/$REQUESTED_HYSTERIA_DOMAIN.conf"
  NEW_LIVE_DIR="/opt/certbot/certs/live/$REQUESTED_HYSTERIA_DOMAIN"
  if [ -e "$NEW_RENEWAL_CONF" ] \\
    || [ -e "$NEW_LIVE_DIR" ] \\
    || [ -L "$NEW_LIVE_DIR" ]; then
    [ -f "$NEW_RENEWAL_CONF" ] \\
      && [ -s "$NEW_LIVE_DIR/fullchain.pem" ] \\
      && [ -s "$NEW_LIVE_DIR/privkey.pem" ] \\
      || reconfigure_fail "Состояние существующего Certbot lineage для нового домена неполное"
    lineage_marker_is_valid_for "$REQUESTED_HYSTERIA_DOMAIN" \\
      || reconfigure_fail "Существующий Certbot lineage нового домена не принадлежит RWManager"
    renewal_uses_expected_webroot_for \\
      "$NEW_RENEWAL_CONF" "$REQUESTED_HYSTERIA_DOMAIN" \\
      || reconfigure_fail "Certbot lineage нового домена не управляется ожидаемым webroot RWManager"
    certificate_has_exact_dns_san \\
      "$NEW_LIVE_DIR/fullchain.pem" "$REQUESTED_HYSTERIA_DOMAIN" \\
      || reconfigure_fail "Существующий Certbot lineage содержит неожиданный набор SAN"
    echo "Найден совместимый Certbot lineage нового домена; он будет проверен и переиспользован."
  fi
  echo "Смена домена Hysteria2: $CURRENT_HYSTERIA_DOMAIN -> $REQUESTED_HYSTERIA_DOMAIN"
fi

HYSTERIA_REQUIRE_MANAGED_LINEAGE=1
HYSTERIA_RECONFIGURE_MODE=1
HYSTERIA_PREVIOUS_DOMAIN_FOR_RECOVERY="$ACTIVE_CERT_DOMAIN"
${HYSTERIA2_RECONFIGURE_SETUP_SCRIPT}

if [ "$CURRENT_HYSTERIA_DOMAIN" = "$HYSTERIA_DOMAIN" ]; then
  echo "=== Hysteria2: текущий домен и сертификат проверены ==="
else
  echo "=== Hysteria2: домен успешно изменён ==="
  echo "Старый домен: $CURRENT_HYSTERIA_DOMAIN"
  echo "Новый домен:  $HYSTERIA_DOMAIN"
  echo "[INFO] Старый Certbot lineage и ACME-маршрут сохранены как резерв для отката."
  echo "[IMPORTANT] Обновите домен/SNI соответствующих hosts и клиентов в Remnawave."
fi`;
