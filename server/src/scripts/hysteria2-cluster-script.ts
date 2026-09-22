import { isIP } from 'node:net';

export type Hysteria2ClusterCaddyRole = 'coordinator' | 'follower';

export interface Hysteria2ClusterCaddyPrepareOptions {
  domain: string;
  role: Hysteria2ClusterCaddyRole;
  /** Required for a follower. Must be a literal IPv4 or IPv6 address. */
  coordinatorAddress?: string;
}

export interface Hysteria2ClusterProbeOptions {
  domain: string;
  /** Every literal A and AAAA address currently advertised for the domain. */
  addresses: string[];
}

export interface Hysteria2ClusterCertificateDeployOptions {
  domain: string;
  fullchainBase64: string;
  privateKeyBase64: string;
}

const MAX_CERTIFICATE_BYTES = 256 * 1024;
const MAX_PRIVATE_KEY_BYTES = 128 * 1024;
const MAX_CLUSTER_ADDRESSES = 4096;

function assertHostname(value: string): string {
  if (
    value.length < 3 ||
    value.length > 253 ||
    value !== value.trim() ||
    value !== value.toLowerCase() ||
    !value.includes('.') ||
    !value
      .split('.')
      .every(
        (label) =>
          label.length >= 1 &&
          label.length <= 63 &&
          /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label),
      )
  ) {
    throw new Error(
      'Некорректный домен Hysteria2: ожидается ASCII/Punycode hostname в нижнем регистре.',
    );
  }
  return value;
}

function assertLiteralIp(value: string, fieldName: string): string {
  if (value !== value.trim() || isIP(value) === 0) {
    throw new Error(`${fieldName} должен быть literal IPv4 или IPv6 адресом.`);
  }
  return value;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function decodeStrictBase64(
  value: string,
  fieldName: string,
  maxBytes: number,
): Buffer {
  if (
    !value ||
    value.length > Math.ceil((maxBytes * 4) / 3) + 8 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      value,
    )
  ) {
    throw new Error(`${fieldName} содержит некорректный base64.`);
  }

  const decoded = Buffer.from(value, 'base64');
  if (!decoded.length || decoded.length > maxBytes) {
    throw new Error(`${fieldName} имеет недопустимый размер.`);
  }
  if (decoded.toString('base64') !== value) {
    throw new Error(`${fieldName} содержит неканонический base64.`);
  }
  return decoded;
}

function caddyCoordinatorInnerBlock(domain: string): string {
  return `\t# BEGIN RWM HYSTERIA CLUSTER ACME: ${domain}
\t@rwm_hysteria_acme {
\t\tmethod GET HEAD
\t\tpath /.well-known/acme-challenge/*
\t}
\thandle @rwm_hysteria_acme {
\t\troot * /var/www/html
\t\theader Cache-Control "no-store"
\t\tfile_server
\t}
\thandle {
\t\tredir https://{$SELF_STEAL_DOMAIN}{uri} permanent
\t}
\t# END RWM HYSTERIA CLUSTER ACME: ${domain}`;
}

function caddyFollowerInnerBlock(
  domain: string,
  coordinatorUpstream: string,
): string {
  return `\t# BEGIN RWM HYSTERIA CLUSTER ACME: ${domain}
\t@rwm_hysteria_acme_loop {
\t\tmethod GET HEAD
\t\tpath /.well-known/acme-challenge/*
\t\theader X-RWM-ACME-Hop *
\t}
\thandle @rwm_hysteria_acme_loop {
\t\trespond 508
\t}
\t@rwm_hysteria_acme {
\t\tmethod GET HEAD
\t\tpath /.well-known/acme-challenge/*
\t}
\thandle @rwm_hysteria_acme {
\t\treverse_proxy ${coordinatorUpstream} {
\t\t\theader_up Host ${domain}
\t\t\theader_up X-RWM-ACME-Hop "1"
\t\t\ttransport http {
\t\t\t\tdial_timeout 3s
\t\t\t\tresponse_header_timeout 5s
\t\t\t}
\t\t}
\t}
\thandle {
\t\tredir https://{$SELF_STEAL_DOMAIN}{uri} permanent
\t}
\t# END RWM HYSTERIA CLUSTER ACME: ${domain}`;
}

function caddyStandaloneSite(domain: string, innerBlock: string): string {
  const routeBlock = innerBlock
    .replace(
      /\n\thandle \{\n\t\tredir https:\/\/\{\$SELF_STEAL_DOMAIN\}\{uri\} permanent\n\t\}/,
      '',
    )
    .split('\n')
    .filter(
      (line) =>
        !line.includes('BEGIN RWM HYSTERIA CLUSTER ACME') &&
        !line.includes('END RWM HYSTERIA CLUSTER ACME'),
    )
    .join('\n');

  // The final catch-all for a dedicated HTTP site is a 404 rather than the
  // selfsteal redirect used by an in-place block.
  return `# BEGIN RWM HYSTERIA CLUSTER ACME SITE: ${domain}
http://${domain} {
\tbind 0.0.0.0
${routeBlock}
\thandle {
\t\trespond 404
\t}
}
# END RWM HYSTERIA CLUSTER ACME SITE: ${domain}`;
}

function encodeText(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64');
}

function caddyUpstreamFor(address: string): string {
  return isIP(address) === 6 ? `[${address}]:80` : `${address}:80`;
}

/**
 * Builds the phase-one script used on every DNS node before an ACME order.
 * The coordinator serves its local webroot; followers proxy exactly one hop
 * to a literal coordinator address. The Caddyfile update is transactional and
 * preserves the bind-mounted file inode.
 */
export function buildHysteria2ClusterCaddyPrepareScript(
  options: Hysteria2ClusterCaddyPrepareOptions,
): string {
  const domain = assertHostname(options.domain);
  if (options.role !== 'coordinator' && options.role !== 'follower') {
    throw new Error('Некорректная роль Hysteria2 cluster Caddy.');
  }

  let coordinatorAddress = '';
  if (options.role === 'follower') {
    coordinatorAddress = assertLiteralIp(
      options.coordinatorAddress ?? '',
      'Адрес coordinator',
    );
  } else if (options.coordinatorAddress) {
    assertLiteralIp(options.coordinatorAddress, 'Адрес coordinator');
  }

  const innerBlock =
    options.role === 'coordinator'
      ? caddyCoordinatorInnerBlock(domain)
      : caddyFollowerInnerBlock(domain, caddyUpstreamFor(coordinatorAddress));
  const standaloneSite = caddyStandaloneSite(domain, innerBlock);

  return `#!/usr/bin/env bash
set -Eeuo pipefail
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

DOMAIN=${shellQuote(domain)}
ROLE=${shellQuote(options.role)}
COORDINATOR_ADDRESS=${shellQuote(coordinatorAddress)}
INNER_FRAGMENT_B64=${shellQuote(encodeText(innerBlock))}
SITE_FRAGMENT_B64=${shellQuote(encodeText(standaloneSite))}
CADDY_DIR="/opt/caddy"
CADDY_COMPOSE="$CADDY_DIR/docker-compose.yml"
CADDY_FILE="$CADDY_DIR/Caddyfile"
CADDY_ENV="$CADDY_DIR/.env"
CADDY_WEBROOT="$CADDY_DIR/html"
BACKUP=""
CANDIDATE=""
INNER_FRAGMENT=""
SITE_FRAGMENT=""
CHANGED=0
COMMITTED=0

fail() {
  echo "[ERROR] $*" >&2
  exit 1
}

restore_caddy() {
  [ "$CHANGED" -eq 1 ] || return 0
  [ -n "$BACKUP" ] && [ -f "$BACKUP" ] || return 1
  cat "$BACKUP" > "$CADDY_FILE" || return 1
  docker compose -f "$CADDY_COMPOSE" up -d --force-recreate caddy >/dev/null 2>&1
}

cleanup() {
  local status=$?
  trap - EXIT
  if [ "$status" -ne 0 ] && [ "$COMMITTED" -eq 0 ]; then
    echo "[ROLLBACK] Восстанавливаем предыдущую конфигурацию Caddy" >&2
    restore_caddy || echo "[ROLLBACK ERROR] Не удалось восстановить Caddy" >&2
  fi
  [ -z "$BACKUP" ] || rm -f -- "$BACKUP"
  [ -z "$CANDIDATE" ] || rm -f -- "$CANDIDATE"
  [ -z "$INNER_FRAGMENT" ] || rm -f -- "$INNER_FRAGMENT"
  [ -z "$SITE_FRAGMENT" ] || rm -f -- "$SITE_FRAGMENT"
  exit "$status"
}
trap cleanup EXIT

[ "$(id -u)" -eq 0 ] || fail "Скрипт нужно запускать от root или через sudo"
command -v docker >/dev/null 2>&1 || fail "Docker не установлен"
command -v base64 >/dev/null 2>&1 || fail "base64 не установлен"
docker compose version >/dev/null 2>&1 || fail "Docker Compose plugin не установлен"
[ -f "$CADDY_COMPOSE" ] && [ ! -L "$CADDY_COMPOSE" ] || fail "$CADDY_COMPOSE не найден или небезопасен"
[ -f "$CADDY_FILE" ] && [ ! -L "$CADDY_FILE" ] || fail "$CADDY_FILE не найден или небезопасен"
[ -f "$CADDY_ENV" ] && [ ! -L "$CADDY_ENV" ] || fail "$CADDY_ENV не найден или небезопасен"
docker compose -f "$CADDY_COMPOSE" config --services | grep -qx caddy || fail "В compose не найден сервис caddy"
docker compose -f "$CADDY_COMPOSE" ps --status running --services | grep -qx caddy || fail "Caddy не запущен"

install -d -o root -g root -m 755 "$CADDY_WEBROOT/.well-known/acme-challenge"
BACKUP=$(mktemp "$CADDY_DIR/Caddyfile.rwm-cluster-backup.XXXXXX")
CANDIDATE=$(mktemp "$CADDY_DIR/Caddyfile.rwm-cluster-candidate.XXXXXX")
INNER_FRAGMENT=$(mktemp "$CADDY_DIR/.rwm-cluster-inner.XXXXXX")
SITE_FRAGMENT=$(mktemp "$CADDY_DIR/.rwm-cluster-site.XXXXXX")
cp -p "$CADDY_FILE" "$BACKUP"
printf '%s' "$INNER_FRAGMENT_B64" | base64 -d > "$INNER_FRAGMENT" || fail "Не удалось декодировать Caddy fragment"
printf '%s' "$SITE_FRAGMENT_B64" | base64 -d > "$SITE_FRAGMENT" || fail "Не удалось декодировать Caddy site"

if grep -qFx "SELF_STEAL_DOMAIN=$DOMAIN" "$CADDY_ENV"; then
  awk -v fragment="$INNER_FRAGMENT" -v domain="$DOMAIN" '
    function trimmed(value) {
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
      return value
    }
    function emit_fragment(line) {
      while ((getline line < fragment) > 0) print line
      close(fragment)
    }
    BEGIN {
      old_begin = "# BEGIN RWM HYSTERIA ACME (selfsteal domain)"
      old_end = "# END RWM HYSTERIA ACME (selfsteal domain)"
      new_begin = "# BEGIN RWM HYSTERIA CLUSTER ACME: " domain
      new_end = "# END RWM HYSTERIA CLUSTER ACME: " domain
      skipping = 0
      replaced = 0
    }
    {
      clean = trimmed($0)
      if (!skipping && (clean == old_begin || clean == new_begin)) {
        if (replaced) exit 44
        emit_fragment()
        replaced = 1
        skipping = clean == old_begin ? 1 : 2
        next
      }
      if (skipping == 1) {
        if (clean == old_end) skipping = 0
        next
      }
      if (skipping == 2) {
        if (clean == new_end) skipping = 0
        next
      }
      if (clean == "redir https://{$SELF_STEAL_DOMAIN}{uri} permanent") {
        if (replaced) exit 45
        emit_fragment()
        replaced = 1
        next
      }
      print $0
    }
    END {
      if (skipping || replaced != 1) exit 42
    }
  ' "$CADDY_FILE" > "$CANDIDATE" || fail "Не удалось однозначно обновить selfsteal route"
else
  awk -v domain="$DOMAIN" '
    function trimmed(value) {
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
      return value
    }
    BEGIN {
      old_begin = "# BEGIN RWM HYSTERIA ACME: " domain
      old_end = "# END RWM HYSTERIA ACME: " domain
      new_begin = "# BEGIN RWM HYSTERIA CLUSTER ACME SITE: " domain
      new_end = "# END RWM HYSTERIA CLUSTER ACME SITE: " domain
      skipping = 0
      pending_blank_count = 0
    }
    function discard_pending_blanks() {
      delete pending_blanks
      pending_blank_count = 0
    }
    function flush_pending_blanks(index) {
      for (index = 1; index <= pending_blank_count; index++) {
        print pending_blanks[index]
      }
      discard_pending_blanks()
    }
    {
      clean = trimmed($0)
      if (!skipping && clean == old_begin) {
        discard_pending_blanks()
        skipping = 1
        next
      }
      if (!skipping && clean == new_begin) {
        discard_pending_blanks()
        skipping = 2
        next
      }
      if (skipping == 1) { if (clean == old_end) skipping = 0; next }
      if (skipping == 2) { if (clean == new_end) skipping = 0; next }
      if (clean == "") {
        pending_blanks[++pending_blank_count] = $0
        next
      }
      flush_pending_blanks()
      print $0
    }
    END { if (skipping) exit 42 }
  ' "$CADDY_FILE" > "$CANDIDATE" || fail "Повреждён существующий managed Caddy block"
  printf '\n' >> "$CANDIDATE"
  cat "$SITE_FRAGMENT" >> "$CANDIDATE"
  printf '\n' >> "$CANDIDATE"
fi

if ! cmp -s "$CANDIDATE" "$CADDY_FILE"; then
  cat "$CANDIDATE" > "$CADDY_FILE"
  CHANGED=1
  docker compose -f "$CADDY_COMPOSE" exec -T --interactive=false caddy \\
    caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile </dev/null \\
    || fail "Новая конфигурация Caddy не прошла проверку"
  docker compose -f "$CADDY_COMPOSE" restart caddy \\
    || fail "Caddy не перезапустился с cluster route"
fi

for attempt in 1 2 3 4 5 6 7 8 9 10; do
  if docker compose -f "$CADDY_COMPOSE" ps --status running --services | grep -qx caddy; then
    COMMITTED=1
    break
  fi
  sleep 1
done
[ "$COMMITTED" -eq 1 ] || fail "Caddy не перешёл в состояние running"

echo "Hysteria2 cluster Caddy role подготовлена: $ROLE ($DOMAIN)"
if [ "$ROLE" = follower ]; then
  echo "HTTP-01 coordinator: $COORDINATOR_ADDRESS"
fi`;
}

/** Builds the barrier probe run after every node has its Caddy role installed. */
export function buildHysteria2ClusterProbeScript(
  options: Hysteria2ClusterProbeOptions,
): string {
  const domain = assertHostname(options.domain);
  if (
    !Array.isArray(options.addresses) ||
    options.addresses.length === 0 ||
    options.addresses.length > MAX_CLUSTER_ADDRESSES
  ) {
    throw new Error(
      'Список DNS адресов Hysteria2 cluster пуст или слишком велик.',
    );
  }
  const addresses = [
    ...new Set(
      options.addresses.map((address) => assertLiteralIp(address, 'DNS адрес')),
    ),
  ];
  const addressArray = addresses.map(shellQuote).join(' ');

  return `#!/usr/bin/env bash
set -Eeuo pipefail
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

DOMAIN=${shellQuote(domain)}
ADDRESSES=(${addressArray})
WEBROOT="/opt/caddy/html"
PROBE_FILE=""

fail() {
  echo "[ERROR] $*" >&2
  exit 1
}

cleanup() {
  local status=$?
  trap - EXIT
  [ -z "$PROBE_FILE" ] || rm -f -- "$PROBE_FILE"
  exit "$status"
}
trap cleanup EXIT

[ "$(id -u)" -eq 0 ] || fail "Скрипт нужно запускать от root или через sudo"
command -v curl >/dev/null 2>&1 || fail "curl не установлен"
command -v openssl >/dev/null 2>&1 || fail "openssl не установлен"
[ -d "$WEBROOT/.well-known/acme-challenge" ] || fail "Caddy webroot не подготовлен"

PROBE_NAME="rwm-cluster-$(openssl rand -hex 16)"
PROBE_BODY="rwm-cluster-ok-$(openssl rand -hex 24)"
PROBE_FILE="$WEBROOT/.well-known/acme-challenge/$PROBE_NAME"
umask 022
printf '%s' "$PROBE_BODY" > "$PROBE_FILE"
chmod 644 "$PROBE_FILE"

for address in "${'${ADDRESSES[@]}'}"; do
  resolve_address="$address"
  case "$address" in
    *:*) resolve_address="[$address]" ;;
  esac
  response=""
  curl_status=0
  response=$(curl --noproxy '*' -fsS \\
    --retry 3 \\
    --retry-connrefused \\
    --retry-delay 1 \\
    --connect-timeout 5 \\
    --max-time 15 \\
    --resolve "$DOMAIN:80:$resolve_address" \\
    "http://$DOMAIN/.well-known/acme-challenge/$PROBE_NAME") \\
    || curl_status=$?
  [ "$curl_status" -eq 0 ] \\
    || fail "DNS endpoint $address недоступен для HTTP-01 (curl $curl_status)"
  [ "$response" = "$PROBE_BODY" ] \\
    || fail "DNS endpoint $address вернул неверный HTTP-01 ответ"
  echo "[OK] HTTP-01 через $address"
done

echo "Все DNS endpoints отдают единый HTTP-01 challenge: ${addresses.length}"`;
}

/**
 * Builds the follower-side certificate publication transaction. It validates
 * the leaf certificate and private key before changing any live state.
 */
export function buildHysteria2ClusterCertificateDeployScript(
  options: Hysteria2ClusterCertificateDeployOptions,
): string {
  const domain = assertHostname(options.domain);
  const fullchain = decodeStrictBase64(
    options.fullchainBase64,
    'fullchain',
    MAX_CERTIFICATE_BYTES,
  );
  const privateKey = decodeStrictBase64(
    options.privateKeyBase64,
    'private key',
    MAX_PRIVATE_KEY_BYTES,
  );
  if (!fullchain.toString('utf8').includes('-----BEGIN CERTIFICATE-----')) {
    throw new Error('fullchain не содержит PEM сертификат.');
  }
  if (!privateKey.toString('utf8').includes('PRIVATE KEY-----')) {
    throw new Error('private key не содержит PEM ключ.');
  }

  return `#!/usr/bin/env bash
set -Eeuo pipefail
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

DOMAIN=${shellQuote(domain)}
FULLCHAIN_B64=${shellQuote(options.fullchainBase64)}
PRIVATE_KEY_B64=${shellQuote(options.privateKeyBase64)}
DEPLOY_DIR="/opt/hysteria2-certs"
GENERATIONS_DIR="$DEPLOY_DIR/generations"
CURRENT_LINK="$DEPLOY_DIR/current"
REMNANODE_DIR="/opt/remnanode"
REMNANODE_COMPOSE="$REMNANODE_DIR/docker-compose.yml"
REMNANODE_OVERRIDE="$REMNANODE_DIR/docker-compose.override.yml"
OVERRIDE_MARKER="# Managed by RWManager: Hysteria2 certificates"
CRON_FILE="/etc/cron.d/rwm-hysteria2-certbot"
RESTART_MARKER="/opt/certbot/.hysteria2-restart-required"
LOCK_FILE="/run/lock/rwm-hysteria2-cert-deploy.lock"
STAGE_DIR=""
NEW_GENERATION=""
NEW_GENERATION_CREATED=0
CURRENT_TMP=""
OLD_CURRENT_PRESENT=0
OLD_CURRENT_TARGET=""
OVERRIDE_PRESENT=0
OVERRIDE_BACKUP=""
OVERRIDE_CANDIDATE=""
TRANSACTION_ACTIVE=0
COMMITTED=0
CERT_CHANGED=0
COMPOSE_CHANGED=0

fail() {
  echo "[ERROR] $*" >&2
  exit 1
}

certificate_has_exact_dns_san() {
  local certificate="$1"
  local expected_domain="$2"
  local san_domains=""
  san_domains=$(openssl x509 -in "$certificate" -noout -ext subjectAltName 2>/dev/null \\
    | grep -oE 'DNS:[^,[:space:]]+' \\
    | sed 's/^DNS://' \\
    | sort -u) || return 1
  [ "$san_domains" = "$expected_domain" ]
}

restore_previous_state() {
  local failed=0
  set +e
  if [ "$OLD_CURRENT_PRESENT" -eq 1 ]; then
    CURRENT_TMP="$DEPLOY_DIR/.current.rollback.$$"
    rm -f -- "$CURRENT_TMP"
    ln -s "$OLD_CURRENT_TARGET" "$CURRENT_TMP" \\
      && mv -Tf "$CURRENT_TMP" "$CURRENT_LINK" || failed=1
  else
    rm -f -- "$CURRENT_LINK" || failed=1
  fi
  if [ "$OVERRIDE_PRESENT" -eq 1 ]; then
    cat "$OVERRIDE_BACKUP" > "$REMNANODE_OVERRIDE" || failed=1
  else
    rm -f -- "$REMNANODE_OVERRIDE" || failed=1
  fi
  if [ "$OLD_CURRENT_PRESENT" -eq 1 ]; then
    (cd "$REMNANODE_DIR" && docker compose up -d --force-recreate remnanode) \\
      >/dev/null 2>&1 || failed=1
  fi
  [ "$failed" -eq 0 ]
}

cleanup() {
  local status=$?
  trap - EXIT
  if [ "$status" -ne 0 ] && [ "$TRANSACTION_ACTIVE" -eq 1 ] && [ "$COMMITTED" -eq 0 ]; then
    echo "[ROLLBACK] Восстанавливаем предыдущий сертификат follower-ноды" >&2
    restore_previous_state \\
      || echo "[ROLLBACK ERROR] Локальный откат follower-ноды не завершён" >&2
  fi
  [ -z "$CURRENT_TMP" ] || rm -f -- "$CURRENT_TMP"
  [ -z "$STAGE_DIR" ] || rm -rf -- "$STAGE_DIR"
  if [ "$status" -ne 0 ] && [ "$NEW_GENERATION_CREATED" -eq 1 ] && [ -n "$NEW_GENERATION" ]; then
    rm -rf -- "$NEW_GENERATION"
  fi
  [ -z "$OVERRIDE_BACKUP" ] || rm -f -- "$OVERRIDE_BACKUP"
  [ -z "$OVERRIDE_CANDIDATE" ] || rm -f -- "$OVERRIDE_CANDIDATE"
  exit "$status"
}
trap cleanup EXIT

verify_live_mount() {
  local current_real=""
  local container_id=""
  local file_name=""
  local host_hash=""
  local container_hash=""
  current_real=$(readlink -f "$CURRENT_LINK") || return 1
  container_id=$(cd "$REMNANODE_DIR" && timeout --foreground --kill-after=5s 20s docker compose ps -q remnanode) || return 1
  [ -n "$container_id" ] || return 1
  timeout --foreground --kill-after=5s 20s docker inspect "$container_id" | jq -e \\
    --arg source "$CURRENT_LINK" --arg realSource "$current_real" '
      .[0].State.Running == true
      and ([.[0].Mounts[]? | select(
        .Destination == "/etc/hysteria2"
        and (.Source == $source or .Source == $realSource)
        and .RW == false
      )] | length) == 1
    ' >/dev/null || return 1
  for file_name in fullchain.pem privkey.pem; do
    host_hash=$(sha256sum "$CURRENT_LINK/$file_name" | awk '{print $1}') || return 1
    container_hash=$( \\
      (cd "$REMNANODE_DIR" \\
        && timeout --foreground --kill-after=5s 20s \\
          docker compose exec -T --interactive=false remnanode \\
          cat "/etc/hysteria2/$file_name" </dev/null) \\
        | sha256sum | awk '{print $1}' \\
    ) || return 1
    [ -n "$host_hash" ] && [ "$host_hash" = "$container_hash" ] || return 1
  done
  openssl x509 -in "$CURRENT_LINK/fullchain.pem" -checkhost "$DOMAIN" -noout >/dev/null 2>&1
}

[ "$(id -u)" -eq 0 ] || fail "Скрипт нужно запускать от root или через sudo"
for command_name in base64 docker flock jq openssl readlink sha256sum timeout; do
  command -v "$command_name" >/dev/null 2>&1 || fail "$command_name не установлен"
done
[ -f "$REMNANODE_COMPOSE" ] && [ ! -L "$REMNANODE_COMPOSE" ] || fail "$REMNANODE_COMPOSE не найден или небезопасен"
docker compose version >/dev/null 2>&1 || fail "Docker Compose plugin не установлен"
docker compose -f "$REMNANODE_COMPOSE" config --services | grep -qx remnanode || fail "В compose не найден сервис remnanode"

install -d -o root -g root -m 755 /run/lock
exec 9>"$LOCK_FILE"
flock -n 9 || fail "Другая установка cluster-сертификата уже выполняется"

if [ -e "$DEPLOY_DIR" ]; then
  [ -d "$DEPLOY_DIR" ] && [ ! -L "$DEPLOY_DIR" ] || fail "$DEPLOY_DIR имеет небезопасный тип"
fi
install -d -o root -g root -m 700 "$DEPLOY_DIR" "$GENERATIONS_DIR"
STAGE_DIR=$(mktemp -d "$GENERATIONS_DIR/.rwm-stage.XXXXXX")
chmod 700 "$STAGE_DIR"
printf '%s' "$FULLCHAIN_B64" | base64 -d > "$STAGE_DIR/fullchain.pem" || fail "Не удалось декодировать fullchain"
printf '%s' "$PRIVATE_KEY_B64" | base64 -d > "$STAGE_DIR/privkey.pem" || fail "Не удалось декодировать private key"
chown root:root "$STAGE_DIR/fullchain.pem" "$STAGE_DIR/privkey.pem"
chmod 644 "$STAGE_DIR/fullchain.pem"
chmod 600 "$STAGE_DIR/privkey.pem"

openssl x509 -in "$STAGE_DIR/fullchain.pem" -noout >/dev/null 2>&1 || fail "fullchain.pem повреждён"
openssl x509 -in "$STAGE_DIR/fullchain.pem" -checkhost "$DOMAIN" -noout >/dev/null 2>&1 || fail "Сертификат не содержит домен $DOMAIN"
certificate_has_exact_dns_san "$STAGE_DIR/fullchain.pem" "$DOMAIN" || fail "Сертификат содержит неожиданный набор SAN"
openssl x509 -in "$STAGE_DIR/fullchain.pem" -checkend 86400 -noout >/dev/null 2>&1 || fail "Сертификат просрочен или истекает менее чем через сутки"
openssl pkey -in "$STAGE_DIR/privkey.pem" -check -noout >/dev/null 2>&1 || fail "Private key повреждён"
CERT_PUBLIC_KEY=$(openssl x509 -in "$STAGE_DIR/fullchain.pem" -pubkey -noout \\
  | openssl pkey -pubin -outform DER 2>/dev/null | sha256sum | awk '{print $1}')
KEY_PUBLIC_KEY=$(openssl pkey -in "$STAGE_DIR/privkey.pem" -pubout -outform DER 2>/dev/null \\
  | sha256sum | awk '{print $1}')
[ -n "$CERT_PUBLIC_KEY" ] && [ "$CERT_PUBLIC_KEY" = "$KEY_PUBLIC_KEY" ] || fail "Private key не соответствует сертификату"

CERT_FINGERPRINT=$(openssl x509 -in "$STAGE_DIR/fullchain.pem" -noout -fingerprint -sha256 \\
  | sed 's/^[^=]*=//; s/://g' | tr 'A-F' 'a-f')
[[ "$CERT_FINGERPRINT" =~ ^[0-9a-f]{64}$ ]] || fail "Не удалось получить fingerprint сертификата"
NEW_GENERATION="$GENERATIONS_DIR/$CERT_FINGERPRINT"
if [ -e "$NEW_GENERATION" ]; then
  [ -d "$NEW_GENERATION" ] && [ ! -L "$NEW_GENERATION" ] || fail "$NEW_GENERATION имеет небезопасный тип"
  cmp -s "$STAGE_DIR/fullchain.pem" "$NEW_GENERATION/fullchain.pem" \\
    && cmp -s "$STAGE_DIR/privkey.pem" "$NEW_GENERATION/privkey.pem" \\
    || fail "Существующее поколение с тем же fingerprint не совпадает"
  rm -rf -- "$STAGE_DIR"
  STAGE_DIR=""
else
  mv "$STAGE_DIR" "$NEW_GENERATION"
  STAGE_DIR=""
  NEW_GENERATION_CREATED=1
fi

if [ -e "$CURRENT_LINK" ] || [ -L "$CURRENT_LINK" ]; then
  [ -L "$CURRENT_LINK" ] || fail "$CURRENT_LINK должен быть symlink"
  OLD_CURRENT_PRESENT=1
  OLD_CURRENT_TARGET=$(readlink "$CURRENT_LINK")
fi
if [ -e "$REMNANODE_OVERRIDE" ] || [ -L "$REMNANODE_OVERRIDE" ]; then
  [ -f "$REMNANODE_OVERRIDE" ] && [ ! -L "$REMNANODE_OVERRIDE" ] || fail "$REMNANODE_OVERRIDE имеет небезопасный тип"
  OVERRIDE_PRESENT=1
  OVERRIDE_BACKUP=$(mktemp "$REMNANODE_DIR/.rwm-hysteria-override-backup.XXXXXX")
  cp -p "$REMNANODE_OVERRIDE" "$OVERRIDE_BACKUP"
fi
TRANSACTION_ACTIVE=1

DESIRED_TARGET="generations/$CERT_FINGERPRINT"
if [ "$OLD_CURRENT_PRESENT" -ne 1 ] || [ "$OLD_CURRENT_TARGET" != "$DESIRED_TARGET" ]; then
  CERT_CHANGED=1
  CURRENT_TMP="$DEPLOY_DIR/.current.$$"
  rm -f -- "$CURRENT_TMP"
  ln -s "$DESIRED_TARGET" "$CURRENT_TMP"
  mv -Tf "$CURRENT_TMP" "$CURRENT_LINK"
  CURRENT_TMP=""
fi

CURRENT_COMPOSE_JSON=$(cd "$REMNANODE_DIR" && docker compose config --format json) || fail "Не удалось прочитать compose Remnawave Node"
MOUNT_COUNT=$(printf '%s' "$CURRENT_COMPOSE_JSON" | jq -r '[.services.remnanode.volumes[]? | select(.target == "/etc/hysteria2")] | length')
OVERRIDE_CANDIDATE=$(mktemp "$REMNANODE_DIR/.rwm-hysteria-override-candidate.XXXXXX")
cat > "$OVERRIDE_CANDIDATE" <<'RWM_OVERRIDE_EOF'
# Managed by RWManager: Hysteria2 certificates
services:
  remnanode:
    volumes:
      - '/opt/hysteria2-certs/current:/etc/hysteria2:ro'
RWM_OVERRIDE_EOF
chmod 644 "$OVERRIDE_CANDIDATE"
if [ "$OVERRIDE_PRESENT" -eq 1 ] && grep -qF "$OVERRIDE_MARKER" "$REMNANODE_OVERRIDE"; then
  if ! cmp -s "$OVERRIDE_CANDIDATE" "$REMNANODE_OVERRIDE"; then
    cat "$OVERRIDE_CANDIDATE" > "$REMNANODE_OVERRIDE"
    chmod 644 "$REMNANODE_OVERRIDE"
    COMPOSE_CHANGED=1
  fi
elif [ "$MOUNT_COUNT" -eq 0 ]; then
  [ "$OVERRIDE_PRESENT" -eq 0 ] \\
    || fail "$REMNANODE_OVERRIDE не управляется RWManager; добавьте read-only mount вручную"
  cat "$OVERRIDE_CANDIDATE" > "$REMNANODE_OVERRIDE"
  chmod 644 "$REMNANODE_OVERRIDE"
  COMPOSE_CHANGED=1
fi

FINAL_COMPOSE_JSON=$(cd "$REMNANODE_DIR" && docker compose config --format json) || fail "Итоговая compose-конфигурация некорректна"
printf '%s' "$FINAL_COMPOSE_JSON" | jq -e --arg source "$CURRENT_LINK" '
  [.services.remnanode.volumes[]? | select(.target == "/etc/hysteria2")] as $mounts
  | ($mounts | length) == 1
    and $mounts[0].type == "bind"
    and $mounts[0].source == $source
    and $mounts[0].read_only == true
' >/dev/null || fail "Target /etc/hysteria2 занят другим или небезопасным mount"

LIVE_MOUNT_OK=0
if verify_live_mount; then LIVE_MOUNT_OK=1; fi
PENDING_RESTART=0
[ ! -f "$RESTART_MARKER" ] || PENDING_RESTART=1
if [ "$CERT_CHANGED" -eq 1 ] \\
  || [ "$COMPOSE_CHANGED" -eq 1 ] \\
  || [ "$LIVE_MOUNT_OK" -eq 0 ] \\
  || [ "$PENDING_RESTART" -eq 1 ]; then
  (cd "$REMNANODE_DIR" && docker compose up -d --force-recreate remnanode) \\
    || fail "Не удалось пересоздать remnanode"
  LIVE_MOUNT_OK=0
  for attempt in 1 2 3 4 5 6 7 8 9 10; do
    if verify_live_mount; then LIVE_MOUNT_OK=1; break; fi
    sleep 1
  done
else
  echo "Сертификат и read-only mount уже актуальны; remnanode не перезапускается."
fi
[ "$LIVE_MOUNT_OK" -eq 1 ] || fail "remnanode не использует опубликованный read-only сертификат"

# Cluster renewal is coordinated by RWManager. A per-node Certbot cron would
# create independent orders and eventually hit duplicate-certificate limits.
rm -f -- "$CRON_FILE"
rm -f -- "$RESTART_MARKER"
COMMITTED=1
TRANSACTION_ACTIVE=0

echo "Cluster-сертификат опубликован на follower-ноде: $DOMAIN"
echo "certificate_fingerprint=$CERT_FINGERPRINT"`;
}
