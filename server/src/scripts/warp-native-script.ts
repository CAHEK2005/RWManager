export const WARP_NATIVE_SCRIPT_ID = 'builtin-setup-warp-native';
export const WARP_NATIVE_STATUS_SCRIPT_ID = 'builtin-status-warp-native';

// The upstream installer is pinned because its three prompts are answered below.
// Update both the commit and SHA-256 only after reviewing a new upstream version.
export const WARP_NATIVE_SETUP_SCRIPT = `#!/usr/bin/env bash
set -Eeuo pipefail

export DEBIAN_FRONTEND=noninteractive
export APT_LISTCHANGES_FRONTEND=none

fail() {
  echo "[ERROR] $*" >&2
  exit 1
}

[ "$(id -u)" -eq 0 ] || fail "Для установки WARP Native нужны права root"
[ -r /etc/os-release ] || fail "Не удалось определить операционную систему"
. /etc/os-release
case "$ID" in
  debian|ubuntu) ;;
  *) fail "WARP Native поддерживает только Debian и Ubuntu" ;;
esac
command -v apt-get >/dev/null || fail "apt-get не найден"
command -v systemctl >/dev/null || fail "systemctl не найден"

if [ -f /etc/wireguard/warp.conf ]; then
  echo "Конфигурация WARP Native уже существует. Проверяем и включаем интерфейс..."
  systemctl enable --now wg-quick@warp
  systemctl is-active --quiet wg-quick@warp || fail "Сервис wg-quick@warp не запущен"
  wg show warp >/dev/null || fail "Интерфейс warp не найден"
  echo "WARP Native уже установлен и запущен (интерфейс warp)"
  exit 0
fi

echo "[1/3] Устанавливаем зависимости для загрузки установщика..."
apt-get update -qq
apt-get install -y -qq --no-install-recommends ca-certificates curl coreutils

installer=$(mktemp /tmp/rwm-warp-native.XXXXXX)
trap 'rm -f -- "$installer"' EXIT

echo "[2/3] Скачиваем проверенную версию distillium/warp-native..."
curl --proto '=https' --tlsv1.2 --fail --silent --show-error --location --retry 3 --max-time 120 'https://raw.githubusercontent.com/distillium/warp-native/bc31dadd048d89031350cdbeadf325a249f3cfd7/install.sh' --output "$installer"
printf '%s  %s\\n' 'eb5cacdd9752c74b34b58d853b8bdf95c7d11be60b8fdc6bb7ace7b3cd5ec963' "$installer" | sha256sum --check --status || fail "Контрольная сумма установщика не совпадает"

echo "[3/3] Устанавливаем WARP Native с бесплатной регистрацией..."
# Ответы на три запроса закреплённой версии: русский язык, пустой WARP+ ключ,
# пустой интервал watchdog (значение по умолчанию — 10 минут).
timeout --foreground --kill-after=30s 30m bash "$installer" <<'WARP_NATIVE_INPUT'
2


WARP_NATIVE_INPUT

systemctl is-active --quiet wg-quick@warp || fail "Сервис wg-quick@warp не запущен"
wg show warp >/dev/null || fail "Интерфейс warp не найден"
echo "WARP Native установлен: бесплатный аккаунт, интерфейс warp"
echo "Для Xray укажите streamSettings.sockopt.interface = warp"
`;

export const WARP_NATIVE_STATUS_SCRIPT = `#!/usr/bin/env bash
echo "=== Сервис WARP Native ==="
systemctl status wg-quick@warp --no-pager 2>&1 || true
echo ""
echo "=== Интерфейс warp ==="
wg show warp 2>&1 || true
`;
