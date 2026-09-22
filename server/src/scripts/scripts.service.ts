import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Client, type ConnectConfig } from 'ssh2';
import { promises as dns } from 'node:dns';
import { isIP } from 'node:net';
import {
  createPrivateKey,
  createPublicKey,
  X509Certificate,
} from 'node:crypto';
import { Setting } from '../settings/entities/setting.entity';
import type { InstallNodeDto } from '../nodes/nodes.service';
import { SYSCTL_CONTENT } from '../config/constants';
import { TelegramService } from '../telegram/telegram.service';
import { randomId } from '../common/random-id';
import { SecretsService } from '../secrets/secrets.service';
import { connectSsh, parseSocks5ProxyUrl } from '../common/ssh-proxy';
import { decryptProxyUrl, encryptProxyUrl } from '../common/proxy-crypto';
import {
  HYSTERIA2_RECONFIGURE_SCRIPT,
  HYSTERIA2_RECONFIGURE_SCRIPT_ID,
  HYSTERIA2_SCRIPT_ID,
  HYSTERIA2_SETUP_SCRIPT,
} from './hysteria2-script';
import {
  buildHysteria2ClusterCaddyPrepareScript,
  buildHysteria2ClusterCertificateDeployScript,
  buildHysteria2ClusterProbeScript,
} from './hysteria2-cluster-script';
import {
  HYSTERIA2_CLUSTER_STATE_VERSION,
  createEmptyHysteria2ClusterState,
  normalizeHysteriaDomain,
  normalizeHysteriaEmail,
  normalizeIpAddress,
  upsertHysteria2ReconfigureGroup,
  upsertHysteria2SetupGroup,
  validateHysteria2ClusterDns,
  type Hysteria2ClusterDnsValidation,
  type Hysteria2ClusterGroup,
  type Hysteria2ClusterState,
} from './hysteria2-cluster-state';
import {
  WARP_NATIVE_SCRIPT_ID,
  WARP_NATIVE_SETUP_SCRIPT,
  WARP_NATIVE_STATUS_SCRIPT,
  WARP_NATIVE_STATUS_SCRIPT_ID,
} from './warp-native-script';

export interface SshNode {
  id: string;
  rwNodeUuid?: string;
  name: string;
  ip: string;
  sshPort?: number;
  sshUser?: string;
  authType: 'password' | 'key';
  password?: string;
  sshKey?: string;
  proxyUrl?: string;
  disableProxy?: boolean;
  hasProxyUrl?: boolean;
  passwordSecretId?: string;
  sshKeySecretId?: string;
  hasPassword?: boolean;
  hasSshKey?: boolean;
  categoryIds?: string[];
}

export interface Script {
  id: string;
  name: string;
  description?: string;
  content: string;
  isBuiltIn: boolean;
  isModified?: boolean;
  isHidden?: boolean;
}

interface NodeResult {
  nodeId: string;
  nodeName: string;
  logs: string[];
  status: 'running' | 'success' | 'error';
}

export interface ScriptJob {
  scriptName: string;
  status: 'running' | 'success' | 'error';
  results: NodeResult[];
}

export interface HistoryNodeResult {
  nodeId: string;
  nodeName: string;
  status: 'success' | 'error';
  logs: string[];
}

export interface HistoryEntry {
  id: string;
  scriptId: string;
  scriptName: string;
  status: 'success' | 'error';
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  nodeResults: HistoryNodeResult[];
}

export interface HistoryListItem {
  id: string;
  scriptId: string;
  scriptName: string;
  status: 'success' | 'error';
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  nodeCount: number;
  successCount: number;
  logPreview?: string;
}

interface Hysteria2CertificateBundle {
  fullchain: Buffer;
  privateKey: Buffer;
  fingerprint: string;
  notAfter: string;
}

const HYSTERIA2_CLUSTER_STATE_KEY = 'hysteria2_clusters';
const HYSTERIA2_CLUSTER_CONCURRENCY = 10;
const HYSTERIA2_CLUSTER_LOCK_KEY = 'hysteria2-clusters';
const HYSTERIA2_CERTIFICATE_PATH = '/opt/hysteria2-certs/current/fullchain.pem';
const HYSTERIA2_PRIVATE_KEY_PATH = '/opt/hysteria2-certs/current/privkey.pem';

const WARP_SETUP_SCRIPT = `PROXY_PORT="{{ warp_proxy_port | SOCKS5-порт WARP (по умолчанию 40000) }}"
PROXY_PORT="\${PROXY_PORT:-40000}"

# ── 1. Зависимости ────────────────────────────────────────────────────────────
echo "[1/5] Установка зависимостей..."
apt-get install -y curl gnupg lsb-release 2>/dev/null || true

# ── 2. Репозиторий Cloudflare ─────────────────────────────────────────────────
echo "[2/5] Добавление репозитория Cloudflare WARP..."
curl -fsSL https://pkg.cloudflareclient.com/pubkey.gpg \\
  | gpg --yes --dearmor --output /usr/share/keyrings/cloudflare-warp-archive-keyring.gpg

echo "deb [signed-by=/usr/share/keyrings/cloudflare-warp-archive-keyring.gpg] https://pkg.cloudflareclient.com/ $(lsb_release -cs) main" \\
  | tee /etc/apt/sources.list.d/cloudflare-client.list > /dev/null

# ── 3. Установка пакета ───────────────────────────────────────────────────────
echo "[3/5] Установка cloudflare-warp..."
apt-get update -qq
apt-get install -y cloudflare-warp

# ── 4. Запуск демона ──────────────────────────────────────────────────────────
echo "[4/5] Запуск warp-svc..."
systemctl enable warp-svc 2>/dev/null || true
systemctl start  warp-svc 2>/dev/null || true
sleep 3

# ── 5. Регистрация, режим proxy, подключение ──────────────────────────────────
echo "[5/5] Регистрация и подключение..."

WARP_STATUS=$(warp-cli status 2>&1 || true)

if echo "$WARP_STATUS" | grep -qi "Registration Missing"; then
  echo "  Регистрация новой учётной записи..."
  warp-cli registration new
  sleep 2
else
  echo "  Учётная запись уже зарегистрирована, пропускаем"
fi

warp-cli mode proxy

if [ "$PROXY_PORT" != "40000" ]; then
  echo "  Устанавливаем порт прокси: $PROXY_PORT"
  warp-cli proxy port "$PROXY_PORT"
fi

warp-cli connect
sleep 3

# ── Итог ─────────────────────────────────────────────────────────────────────
echo ""
echo "=== Статус WARP ==="
warp-cli status 2>&1 || true
echo ""
echo "=== Настройки прокси ==="
warp-cli settings 2>&1 | grep -i proxy || true
echo ""
echo "Готово: WARP настроен в режиме SOCKS5-прокси"
echo "  Адрес: 127.0.0.1:\${PROXY_PORT}"
echo "  Используйте в Xray как outbound: socks://127.0.0.1:\${PROXY_PORT}"`;

const WARP_STATUS_SCRIPT = `echo "=== Статус WARP ==="
warp-cli status 2>&1 || echo "warp-cli не найден"
echo ""
echo "=== Настройки ==="
warp-cli settings 2>&1 || true
echo ""
echo "=== Сервис warp-svc ==="
systemctl status warp-svc --no-pager 2>/dev/null || true`;

const WARP_UNINSTALL_SCRIPT = `echo "Отключение и удаление WARP..."
warp-cli disconnect 2>/dev/null || true
warp-cli registration delete 2>/dev/null || true
systemctl stop    warp-svc 2>/dev/null || true
systemctl disable warp-svc 2>/dev/null || true
apt-get remove -y cloudflare-warp 2>/dev/null || true
rm -f /etc/apt/sources.list.d/cloudflare-client.list
rm -f /usr/share/keyrings/cloudflare-warp-archive-keyring.gpg
apt-get update -qq 2>/dev/null || true
echo "Готово: WARP удалён"`;

const BUILT_IN_SCRIPTS: Script[] = [
  {
    id: 'builtin-optimize-network',
    name: 'Оптимизация сети',
    description:
      'Применяет sysctl-параметры для оптимизации TCP/BBR и отключения IPv6',
    isBuiltIn: true,
    content: `tee /etc/sysctl.d/99-vpn.conf << 'SYSCTL_EOF'
${SYSCTL_CONTENT}
SYSCTL_EOF
sysctl -p /etc/sysctl.d/99-vpn.conf`,
  },
  {
    id: 'builtin-update-node',
    name: 'Обновление ноды',
    description:
      'Скачивает последний образ Remnawave Node и перезапускает контейнер',
    isBuiltIn: true,
    content: `[ -d /opt/remnanode ] || { echo "[ERROR] /opt/remnanode не найден"; exit 1; }
cd /opt/remnanode && docker compose pull && docker compose up -d`,
  },
  {
    id: 'builtin-restart-node',
    name: 'Перезапуск ноды',
    description: 'Перезапускает Docker-контейнер Remnawave Node',
    isBuiltIn: true,
    content: `[ -d /opt/remnanode ] || { echo "[ERROR] /opt/remnanode не найден"; exit 1; }
cd /opt/remnanode && docker compose up -d --force-recreate`,
  },
  {
    id: 'builtin-status-node',
    name: 'Статус ноды',
    description: 'Показывает статус контейнера и последние 30 строк логов',
    isBuiltIn: true,
    content: `cd /opt/remnanode && docker compose ps && echo "--- Logs ---" && docker compose logs --tail=30`,
  },
  {
    id: WARP_NATIVE_SCRIPT_ID,
    name: 'Установка WARP Native (без ключа)',
    description:
      'Автоматически устанавливает distillium/warp-native на Debian/Ubuntu, регистрирует бесплатный WARP и запускает интерфейс WireGuard warp',
    isBuiltIn: true,
    content: WARP_NATIVE_SETUP_SCRIPT,
  },
  {
    id: WARP_NATIVE_STATUS_SCRIPT_ID,
    name: 'Статус WARP Native',
    description: 'Показывает состояние сервиса wg-quick@warp и интерфейса warp',
    isBuiltIn: true,
    content: WARP_NATIVE_STATUS_SCRIPT,
  },
  {
    id: 'builtin-setup-warp',
    name: 'Установка WARP SOCKS5 (warp-cli)',
    description:
      'Устанавливает Cloudflare WARP, регистрирует учётную запись и настраивает SOCKS5-прокси на указанном порту (по умолчанию 40000)',
    isBuiltIn: true,
    content: WARP_SETUP_SCRIPT,
  },
  {
    id: 'builtin-warp-status',
    name: 'Статус WARP SOCKS5 (warp-cli)',
    description: 'Показывает текущий статус Cloudflare WARP и настройки прокси',
    isBuiltIn: true,
    content: WARP_STATUS_SCRIPT,
  },
  {
    id: 'builtin-uninstall-warp',
    name: 'Удаление WARP SOCKS5 (warp-cli)',
    description:
      'Отключает, удаляет регистрацию и деинсталлирует Cloudflare WARP',
    isBuiltIn: true,
    content: WARP_UNINSTALL_SCRIPT,
  },
  {
    id: HYSTERIA2_SCRIPT_ID,
    name: 'Настройка Hysteria2',
    description:
      "Настраивает группу Hysteria2 с общим доменом: один coordinator получает сертификат Let's Encrypt, остальные ноды получают его по SSH",
    isBuiltIn: true,
    content: HYSTERIA2_SETUP_SCRIPT,
  },
  {
    id: HYSTERIA2_RECONFIGURE_SCRIPT_ID,
    name: 'Смена домена Hysteria2',
    description:
      "Меняет общий домен группы Hysteria2 и синхронно обновляет сертификат Let's Encrypt на всех выбранных нодах",
    isBuiltIn: true,
    content: HYSTERIA2_RECONFIGURE_SCRIPT,
  },
  {
    id: 'builtin-setup-ssh-key',
    name: 'Настройка SSH-ключа',
    description:
      'Добавляет публичный SSH-ключ и отключает вход по паролю. Перед запуском потребуется ввести публичный ключ.',
    isBuiltIn: true,
    content: `PUBLIC_KEY="{{ ssh_public_key | Публичный SSH-ключ (ssh-ed25519 AAAA... или ssh-rsa AAAA...) }}"

# ── Добавить ключ в authorized_keys ──────────────────────────────────────────
mkdir -p ~/.ssh
chmod 700 ~/.ssh
grep -qxF "$PUBLIC_KEY" ~/.ssh/authorized_keys 2>/dev/null || echo "$PUBLIC_KEY" >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys

# ── Применить настройки SSH ───────────────────────────────────────────────────
# На Ubuntu 22.04+ Include sshd_config.d/*.conf стоит в начале sshd_config,
# и OpenSSH берёт ПЕРВОЕ вхождение ключа. Поэтому файлы из drop-in директории
# (например cloud-init) могут перекрывать основной конфиг.
# Решение: пишем наш файл с префиксом 00 — он обрабатывается первым.

if [ -d /etc/ssh/sshd_config.d ]; then
  cat > /etc/ssh/sshd_config.d/00-rwm-auth.conf << 'SSHCONF_EOF'
# Managed by RWManager — do not edit manually
PubkeyAuthentication yes
PasswordAuthentication no
SSHCONF_EOF
  chmod 600 /etc/ssh/sshd_config.d/00-rwm-auth.conf

  # Закомментировать конфликтующие строки в остальных drop-in файлах
  for f in /etc/ssh/sshd_config.d/*.conf; do
    [ "$f" = "/etc/ssh/sshd_config.d/00-rwm-auth.conf" ] && continue
    [ -f "$f" ] || continue
    sed -i 's/^[[:space:]]*PubkeyAuthentication[[:space:]].*$/# &/' "$f"
    sed -i 's/^[[:space:]]*PasswordAuthentication[[:space:]].*$/# &/' "$f"
  done
fi

# Обновить основной sshd_config (для систем без drop-in директории)
sed -i 's/^#*[[:space:]]*PubkeyAuthentication.*/PubkeyAuthentication yes/' /etc/ssh/sshd_config
sed -i 's/^#*[[:space:]]*PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
grep -q '^PubkeyAuthentication' /etc/ssh/sshd_config   || echo 'PubkeyAuthentication yes'  >> /etc/ssh/sshd_config
grep -q '^PasswordAuthentication' /etc/ssh/sshd_config || echo 'PasswordAuthentication no' >> /etc/ssh/sshd_config

# Проверить конфиг перед перезапуском — защита от самоблокировки
sshd -t || { echo "[ERROR] Конфигурация SSH невалидна, перезапуск отменён"; exit 1; }
systemctl restart sshd 2>/dev/null || service ssh restart
echo "Готово: ключ добавлен, вход по паролю отключён"`,
  },
  {
    id: 'builtin-health-check',
    name: 'Проверка состояния ноды',
    description:
      'Показывает статус контейнера, открытые порты, загрузку CPU/RAM и использование диска',
    isBuiltIn: true,
    content: `echo "=== Контейнеры Docker ==="
docker ps --format "table {{.Names}}\\t{{.Status}}\\t{{.Ports}}" 2>/dev/null || echo "Docker недоступен"

echo ""
echo "=== Открытые порты ==="
ss -tlnp 2>/dev/null | head -20

echo ""
echo "=== Нагрузка CPU / RAM ==="
top -bn1 | head -8

echo ""
echo "=== Использование диска ==="
df -h /

echo ""
echo "=== Последние ошибки в логах ноды ==="
docker logs --tail=20 remnanode 2>&1 | grep -iE "(error|fatal|panic)" | tail -10 || echo "Ошибок не найдено"`,
  },
  {
    id: 'builtin-xray-logs',
    name: 'Логи ноды',
    description: 'Выводит последние 100 строк логов контейнера remnanode',
    isBuiltIn: true,
    content: `docker logs --tail=100 remnanode 2>&1`,
  },
  {
    id: 'builtin-docker-cleanup',
    name: 'Очистка Docker',
    description:
      'Удаляет неиспользуемые образы, остановленные контейнеры и анонимные тома. Освобождает место на диске.',
    isBuiltIn: true,
    content: `echo "=== До очистки ==="
df -h /
docker system df 2>/dev/null

echo ""
echo "=== Очистка ==="
docker system prune -f
docker volume prune -f

echo ""
echo "=== После очистки ==="
df -h /
docker system df 2>/dev/null
echo "Готово"`,
  },
];

@Injectable()
export class ScriptsService implements OnModuleInit {
  private readonly logger = new Logger(ScriptsService.name);
  private jobs = new Map<string, ScriptJob>();
  private readonly hysteriaClusterLocks = new Map<string, Promise<void>>();

  constructor(
    @InjectRepository(Setting)
    private settingRepo: Repository<Setting>,
    private telegramService: TelegramService,
    private secretsService: SecretsService,
  ) {}

  async onModuleInit() {
    await this.seedBuiltInScripts();
  }

  private async seedBuiltInScripts() {
    const scripts = await this.loadScripts();
    let changed = false;
    for (const builtin of BUILT_IN_SCRIPTS) {
      const idx = scripts.findIndex((s) => s.id === builtin.id);
      if (idx < 0) {
        scripts.push(builtin);
        changed = true;
      } else if (
        !scripts[idx].isModified &&
        !scripts[idx].isHidden &&
        (scripts[idx].content !== builtin.content ||
          scripts[idx].name !== builtin.name ||
          scripts[idx].description !== builtin.description)
      ) {
        scripts[idx] = { ...builtin }; // обновляем только немодифицированные встроенные скрипты
        changed = true;
      }
    }
    if (changed) {
      await this.saveSetting('scripts', JSON.stringify(scripts));
    }
  }

  private substituteVariables(
    content: string,
    variables: Record<string, string>,
  ): string {
    return content.replace(
      /\{\{\s*(\w+)(?:\s*\|[^}]*)?\s*\}\}/g,
      (_, name: string) => {
        return Object.prototype.hasOwnProperty.call(variables, name)
          ? variables[name]
          : `{{ ${name} }}`;
      },
    );
  }

  private renderScript(
    script: Script,
    variables: Record<string, string>,
  ): string {
    this.validateScriptVariables(script, variables);
    return Object.keys(variables).length > 0
      ? this.substituteVariables(script.content, variables)
      : script.content;
  }

  private validateScriptVariables(
    script: Script,
    variables: Record<string, string>,
  ): void {
    if (
      script.id !== HYSTERIA2_SCRIPT_ID &&
      script.id !== HYSTERIA2_RECONFIGURE_SCRIPT_ID
    ) {
      return;
    }

    const needsDomain = /\{\{\s*hysteria_domain(?:\s*\||\s*\}\})/.test(
      script.content,
    );
    const needsNewDomain = /\{\{\s*hysteria_new_domain(?:\s*\||\s*\}\})/.test(
      script.content,
    );
    const needsEmail = /\{\{\s*certbot_email(?:\s*\||\s*\}\})/.test(
      script.content,
    );
    if (!needsDomain && !needsNewDomain && !needsEmail) return;

    const domain = variables.hysteria_domain;
    const newDomain = variables.hysteria_new_domain;
    const email = variables.certbot_email;

    if (
      needsDomain &&
      (typeof domain !== 'string' || !this.isValidHostname(domain))
    ) {
      throw new Error(
        'Некорректный домен Hysteria2. Укажите доменное имя в нижнем регистре (ASCII/Punycode), без схемы, пути и wildcard.',
      );
    }

    if (
      needsNewDomain &&
      (typeof newDomain !== 'string' || !this.isValidHostname(newDomain))
    ) {
      throw new Error(
        'Некорректный новый домен Hysteria2. Укажите доменное имя в нижнем регистре (ASCII/Punycode), без схемы, пути и wildcard.',
      );
    }

    if (
      needsEmail &&
      (typeof email !== 'string' || !this.isValidEmail(email))
    ) {
      throw new Error("Некорректный email для Let's Encrypt.");
    }
  }

  private isValidEmail(value: string): boolean {
    if (value.length > 254 || value !== value.trim()) return false;

    const atIndex = value.lastIndexOf('@');
    if (atIndex <= 0 || atIndex !== value.indexOf('@')) return false;

    const localPart = value.slice(0, atIndex);
    const domain = value.slice(atIndex + 1);
    return (
      localPart.length <= 64 &&
      !localPart.startsWith('.') &&
      !localPart.endsWith('.') &&
      !localPart.includes('..') &&
      /^[A-Za-z0-9._%+-]+$/.test(localPart) &&
      this.isValidHostname(domain)
    );
  }

  private isValidHostname(value: string): boolean {
    if (
      value.length < 3 ||
      value.length > 253 ||
      value !== value.trim() ||
      value !== value.toLowerCase() ||
      !value.includes('.')
    ) {
      return false;
    }

    return value
      .split('.')
      .every(
        (label) =>
          label.length >= 1 &&
          label.length <= 63 &&
          /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label),
      );
  }

  private maskSecrets(text: string, mask: string[]): string {
    let result = text;
    for (const val of mask) {
      result = result.split(val).join('***');
    }
    return result;
  }

  private async saveSetting(key: string, value: string) {
    let s = await this.settingRepo.findOne({ where: { key } });
    if (!s) s = this.settingRepo.create({ key });
    s.value = value;
    await this.settingRepo.save(s);
  }

  // ── SSH Nodes ────────────────────────────────────────────────────────────────

  async getSshNodes(): Promise<SshNode[]> {
    const nodes = await this.loadStoredSshNodes();
    return nodes.map((node) => this.redactSshNode(node));
  }

  private async loadStoredSshNodes(): Promise<SshNode[]> {
    const raw = await this.settingRepo.findOne({ where: { key: 'ssh_nodes' } });
    try {
      return JSON.parse(raw?.value || '[]');
    } catch {
      return [];
    }
  }

  private redactSshNode(node: SshNode): SshNode {
    const {
      password,
      sshKey,
      passwordSecretId,
      sshKeySecretId,
      proxyUrl,
      ...rest
    } = node;
    return {
      ...rest,
      hasPassword: Boolean(password || passwordSecretId),
      hasSshKey: Boolean(sshKey || sshKeySecretId),
      hasProxyUrl: Boolean(proxyUrl),
    };
  }

  async resolveSshProxyUrl(
    nodeProxyUrl?: string | null,
    disableProxy = false,
  ): Promise<string | undefined> {
    if (disableProxy) return undefined;
    if (nodeProxyUrl) return decryptProxyUrl(nodeProxyUrl);
    const setting = await this.settingRepo.findOne({
      where: { key: 'ssh_proxy_url' },
    });
    return setting?.value ? decryptProxyUrl(setting.value) : undefined;
  }

  private async resolveSshNodeSecrets(node: SshNode): Promise<SshNode> {
    const resolved = { ...node };
    if (!resolved.password && resolved.passwordSecretId) {
      resolved.password =
        (await this.secretsService.getValue(resolved.passwordSecretId)) ?? '';
    }
    if (!resolved.sshKey && resolved.sshKeySecretId) {
      resolved.sshKey =
        (await this.secretsService.getValue(resolved.sshKeySecretId)) ?? '';
    }
    return resolved;
  }

  private async loadSshNodesForExecution(
    nodeIds?: string[],
  ): Promise<SshNode[]> {
    const storedNodes = await this.loadStoredSshNodes();
    const nodes = nodeIds
      ? storedNodes.filter((node) => nodeIds.includes(node.id))
      : storedNodes;
    let globalProxyUrl: Promise<string | undefined> | undefined;
    return Promise.all(
      nodes.map(async (node) => ({
        ...(await this.resolveSshNodeSecrets(node)),
        proxyUrl: node.disableProxy
          ? undefined
          : node.proxyUrl
            ? decryptProxyUrl(node.proxyUrl)
            : await (globalProxyUrl ??= this.resolveSshProxyUrl()),
      })),
    );
  }

  async getSshNodeForConnection(id: string): Promise<SshNode | null> {
    const nodes = await this.loadSshNodesForExecution([id]);
    return nodes.find((node) => node.id === id) ?? null;
  }

  async getSshProxyUrlForNode(id: string): Promise<string | undefined> {
    const nodes = await this.loadStoredSshNodes();
    const node = nodes.find((item) => item.id === id);
    return this.resolveSshProxyUrl(node?.proxyUrl, node?.disableProxy);
  }

  private async saveSshCredentialSecret(
    existingSecretId: string | undefined,
    name: string,
    type: 'password' | 'ssh-key',
    value: string | undefined,
  ): Promise<string | undefined> {
    if (!value?.trim()) return existingSecretId;
    if (existingSecretId) {
      const existingValue =
        await this.secretsService.getValue(existingSecretId);
      if (existingValue === value) return existingSecretId;
    }
    const secret = await this.secretsService.create({ name, type, value });
    return secret.id;
  }

  async upsertSshNode(
    node: Omit<SshNode, 'id'> & { id?: string },
  ): Promise<SshNode> {
    const nodes = await this.loadStoredSshNodes();
    const id = node.id || randomId();
    const existing = nodes.find((n) => n.id === id);
    const saved: SshNode = { ...existing, ...node, id } as SshNode;
    if (node.proxyUrl !== undefined) {
      if (node.proxyUrl) {
        parseSocks5ProxyUrl(node.proxyUrl);
        saved.proxyUrl = encryptProxyUrl(node.proxyUrl);
      } else delete saved.proxyUrl;
    }
    if (node.passwordSecretId) {
      if (
        (await this.secretsService.getValue(node.passwordSecretId)) === null
      ) {
        throw new Error('Selected SSH password secret was not found');
      }
      saved.passwordSecretId = node.passwordSecretId;
    } else {
      saved.passwordSecretId = await this.saveSshCredentialSecret(
        existing?.passwordSecretId,
        `${saved.name} SSH password`,
        'password',
        node.password,
      );
    }
    if (node.sshKeySecretId) {
      if ((await this.secretsService.getValue(node.sshKeySecretId)) === null) {
        throw new Error('Selected SSH key secret was not found');
      }
      saved.sshKeySecretId = node.sshKeySecretId;
    } else {
      saved.sshKeySecretId = await this.saveSshCredentialSecret(
        existing?.sshKeySecretId,
        `${saved.name} SSH key`,
        'ssh-key',
        node.sshKey,
      );
    }
    delete saved.password;
    delete saved.sshKey;
    delete saved.hasPassword;
    delete saved.hasSshKey;
    const idx = nodes.findIndex((n) => n.id === id);
    if (idx >= 0) nodes[idx] = saved;
    else nodes.push(saved);
    await this.saveSetting('ssh_nodes', JSON.stringify(nodes));
    return this.redactSshNode(saved);
  }

  async deleteSshNode(id: string): Promise<void> {
    const nodes = await this.loadStoredSshNodes();
    await this.saveSetting(
      'ssh_nodes',
      JSON.stringify(nodes.filter((n) => n.id !== id)),
    );
  }

  async deleteSshNodes(
    ids: string[],
  ): Promise<{ success: true; deleted: number }> {
    const nodes = await this.loadStoredSshNodes();
    const selected = new Set(ids);
    const remaining = nodes.filter((node) => !selected.has(node.id));
    await this.saveSetting('ssh_nodes', JSON.stringify(remaining));
    return { success: true, deleted: nodes.length - remaining.length };
  }

  async getCategories(): Promise<string[]> {
    const raw = await this.settingRepo.findOne({
      where: { key: 'ssh_node_categories' },
    });
    try {
      return JSON.parse(raw?.value || '[]');
    } catch {
      return [];
    }
  }

  async upsertCategory(name: string): Promise<string[]> {
    const cats = await this.getCategories();
    const trimmed = name.trim();
    if (!trimmed) throw new Error('Название категории не может быть пустым');
    if (!cats.includes(trimmed)) {
      cats.push(trimmed);
      await this.saveSetting('ssh_node_categories', JSON.stringify(cats));
    }
    return cats;
  }

  async deleteCategory(name: string): Promise<string[]> {
    const cats = await this.getCategories();
    const updated = cats.filter((c) => c !== name);
    await this.saveSetting('ssh_node_categories', JSON.stringify(updated));
    // Remove category from all nodes
    const nodes = await this.loadStoredSshNodes();
    const updatedNodes = nodes.map((n) => ({
      ...n,
      categoryIds: (n.categoryIds || []).filter((c) => c !== name),
    }));
    await this.saveSetting('ssh_nodes', JSON.stringify(updatedNodes));
    return updated;
  }

  async deleteCategories(
    ids: string[],
  ): Promise<{ success: true; deleted: number }> {
    const selected = new Set(ids);
    const row = await this.settingRepo.findOne({
      where: { key: 'node_categories' },
    });
    let categories: { id: string; name: string; color: string }[];
    try {
      categories = JSON.parse(row?.value || '[]');
      if (!Array.isArray(categories)) categories = [];
    } catch {
      categories = [];
    }
    const remaining = categories.filter(
      (category) => !selected.has(category.id),
    );
    const nodes = await this.loadStoredSshNodes();
    const updatedNodes = nodes.map((node) => ({
      ...node,
      categoryIds: (node.categoryIds || []).filter((id) => !selected.has(id)),
    }));
    await this.saveSetting('node_categories', JSON.stringify(remaining));
    await this.saveSetting('ssh_nodes', JSON.stringify(updatedNodes));
    return { success: true, deleted: categories.length - remaining.length };
  }

  async addSshNodeFromInstall(
    dto: InstallNodeDto,
    rwNodeUuid: string,
    name: string,
  ): Promise<void> {
    const node: SshNode = {
      id: randomId(),
      rwNodeUuid,
      name,
      ip: dto.ip,
      sshPort: dto.sshPort || 22,
      sshUser: dto.sshUser || 'root',
      authType: dto.authType,
      password: dto.password,
      sshKey: dto.sshKey,
      sshKeySecretId: dto.sshKeySecretId,
      passwordSecretId: dto.passwordSecretId,
      proxyUrl: dto.proxyUrl,
    };
    await this.upsertSshNode(node);
    this.logger.log(`Нода сохранена после установки: ${name} (${dto.ip})`);
  }

  // ── Scripts ──────────────────────────────────────────────────────────────────

  private async loadScripts(): Promise<Script[]> {
    const raw = await this.settingRepo.findOne({ where: { key: 'scripts' } });
    try {
      return JSON.parse(raw?.value || '[]');
    } catch {
      return [];
    }
  }

  async getScripts(): Promise<Script[]> {
    const scripts = await this.loadScripts();
    return scripts.filter((s) => !s.isHidden);
  }

  async upsertScript(
    script: Omit<Script, 'id' | 'isBuiltIn'> & { id?: string },
  ): Promise<Script> {
    const scripts = await this.loadScripts();
    const id = script.id || randomId();
    const idx = scripts.findIndex((s) => s.id === id);
    let saved: Script;
    if (idx >= 0) {
      const existing = scripts[idx];
      saved = {
        ...existing,
        name: script.name,
        description: script.description,
        content: script.content,
      };
      if (existing.isBuiltIn) saved.isModified = true;
      scripts[idx] = saved;
    } else {
      saved = { ...script, id, isBuiltIn: false };
      scripts.push(saved);
    }
    await this.saveSetting('scripts', JSON.stringify(scripts));
    return saved;
  }

  async deleteScript(id: string): Promise<void> {
    const scripts = await this.loadScripts();
    const script = scripts.find((s) => s.id === id);
    if (script?.isBuiltIn) {
      script.isHidden = true;
      await this.saveSetting('scripts', JSON.stringify(scripts));
      return;
    }
    await this.saveSetting(
      'scripts',
      JSON.stringify(scripts.filter((s) => s.id !== id)),
    );
  }

  async deleteScripts(
    ids: string[],
  ): Promise<{ success: true; deleted: number }> {
    const selected = new Set(ids);
    const scripts = await this.loadScripts();
    let deleted = 0;
    const remaining = scripts.filter((script) => {
      if (!selected.has(script.id) || script.isHidden) return true;
      deleted++;
      if (script.isBuiltIn) {
        script.isHidden = true;
        return true;
      }
      return false;
    });
    await this.saveSetting('scripts', JSON.stringify(remaining));
    return { success: true, deleted };
  }

  async revertScript(id: string): Promise<Script> {
    const original = BUILT_IN_SCRIPTS.find((s) => s.id === id);
    if (!original)
      throw new Error('Скрипт не является встроенным или не найден');
    const scripts = await this.loadScripts();
    const idx = scripts.findIndex((s) => s.id === id);
    if (idx < 0) throw new Error('Скрипт не найден');
    const reverted: Script = { ...original };
    scripts[idx] = reverted;
    await this.saveSetting('scripts', JSON.stringify(scripts));
    return reverted;
  }

  // ── History ──────────────────────────────────────────────────────────────────

  private async loadHistory(): Promise<HistoryEntry[]> {
    const raw = await this.settingRepo.findOne({
      where: { key: 'script_history' },
    });
    try {
      return JSON.parse(raw?.value || '[]');
    } catch {
      return [];
    }
  }

  private async appendHistory(entry: HistoryEntry): Promise<void> {
    try {
      const history = await this.loadHistory();
      history.unshift(entry);
      await this.saveSetting(
        'script_history',
        JSON.stringify(history.slice(0, 100)),
      );
    } catch (e) {
      this.logger.error('Ошибка сохранения истории:', e);
    }
  }

  async getHistory(
    page = 1,
    limit = 20,
  ): Promise<{ data: HistoryListItem[]; total: number }> {
    const history = await this.loadHistory();
    const total = history.length;
    const start = (page - 1) * limit;
    const data = history
      .slice(start, start + limit)
      .map((e) => this.toHistoryListItem(e));
    return { data, total };
  }

  async getHistoryEntry(id: string): Promise<HistoryEntry | null> {
    const history = await this.loadHistory();
    return history.find((e) => e.id === id) ?? null;
  }

  async getHistoryByScript(
    scriptId: string,
    page = 1,
    limit = 10,
  ): Promise<{ data: HistoryListItem[]; total: number }> {
    const history = await this.loadHistory();
    const filtered = history.filter((e) => e.scriptId === scriptId);
    const total = filtered.length;
    const start = (page - 1) * limit;
    const data = filtered
      .slice(start, start + limit)
      .map((e) => this.toHistoryListItem(e));
    return { data, total };
  }

  private toHistoryListItem(entry: HistoryEntry): HistoryListItem {
    const allLogs = entry.nodeResults.flatMap((r) => r.logs);
    const meaningful = allLogs.filter(
      (l) => !l.startsWith('[SSH]') && !l.startsWith('[AUTO]'),
    );
    const logPreview = (
      meaningful[meaningful.length - 1] ||
      allLogs[allLogs.length - 1] ||
      ''
    ).slice(0, 120);
    return {
      id: entry.id,
      scriptId: entry.scriptId,
      scriptName: entry.scriptName,
      status: entry.status,
      startedAt: entry.startedAt,
      finishedAt: entry.finishedAt,
      durationMs: entry.durationMs,
      nodeCount: entry.nodeResults.length,
      successCount: entry.nodeResults.filter((r) => r.status === 'success')
        .length,
      logPreview,
    };
  }

  async clearHistory(): Promise<void> {
    await this.saveSetting('script_history', '[]');
  }

  async deleteHistoryEntries(
    ids: string[],
  ): Promise<{ success: true; deleted: number }> {
    const history = await this.loadHistory();
    const selected = new Set(ids);
    const remaining = history.filter((entry) => !selected.has(entry.id));
    await this.saveSetting('script_history', JSON.stringify(remaining));
    return { success: true, deleted: history.length - remaining.length };
  }

  // ── Execute ──────────────────────────────────────────────────────────────────

  async executeScript(
    scriptId: string,
    nodeIds: string[],
    variables?: Record<string, string>,
    variablesPerNode?: Record<string, Record<string, string>>,
  ): Promise<{ jobId: string }> {
    const scripts = await this.loadScripts();
    const script = scripts.find((s) => s.id === scriptId);
    if (!script) throw new Error('Скрипт не найден');

    const nodes = await this.loadSshNodesForExecution(nodeIds);
    const targetNodes = nodes.filter((n) => nodeIds.includes(n.id));
    if (!targetNodes.length) throw new Error('Не выбрано ни одной ноды');

    if (
      targetNodes.length > 1 &&
      script.isBuiltIn &&
      !script.isModified &&
      (script.id === HYSTERIA2_SCRIPT_ID ||
        script.id === HYSTERIA2_RECONFIGURE_SCRIPT_ID)
    ) {
      return this.executeHysteria2ClusterScript(
        script,
        nodeIds,
        targetNodes,
        variables,
        variablesPerNode,
      );
    }

    const renderedContentByNode = new Map<string, string>();
    for (const node of targetNodes) {
      const nodeVars = {
        ...(variables ?? {}),
        ...(variablesPerNode?.[node.id] ?? {}),
      };
      renderedContentByNode.set(node.id, this.renderScript(script, nodeVars));
    }

    const sensitiveValues = [
      ...Object.values(variables || {}),
      ...Object.values(variablesPerNode || {}).flatMap((v) => Object.values(v)),
    ].filter((v) => v.length > 3);

    const jobId = randomId();
    const startedAt = new Date().toISOString();
    const job: ScriptJob = {
      scriptName: script.name,
      status: 'running',
      results: targetNodes.map((n) => ({
        nodeId: n.id,
        nodeName: n.name,
        logs: [],
        status: 'running',
      })),
    };
    this.jobs.set(jobId, job);

    // Запускаем параллельно на всех нодах
    const promises = targetNodes.map(async (node, idx) => {
      const result = job.results[idx];
      const content = renderedContentByNode.get(node.id) ?? script.content;
      try {
        await this.runScriptOnNode(node, content, result, sensitiveValues);
        result.status = 'success';
      } catch (e) {
        result.logs.push(
          this.maskSecrets(
            `[ERROR] ${e?.message || String(e)}`,
            sensitiveValues,
          ),
        );
        result.status = 'error';
      }
    });

    Promise.all(promises)
      .then(() => {
        job.status = job.results.every((r) => r.status === 'success')
          ? 'success'
          : 'error';
      })
      .catch(() => {
        job.status = 'error';
      })
      .finally(async () => {
        const finishedAt = new Date().toISOString();
        await this.appendHistory({
          id: jobId,
          scriptId,
          scriptName: script.name,
          status: job.status as 'success' | 'error',
          startedAt,
          finishedAt,
          durationMs:
            new Date(finishedAt).getTime() - new Date(startedAt).getTime(),
          nodeResults: job.results.map((r) => ({
            nodeId: r.nodeId,
            nodeName: r.nodeName,
            status: r.status as 'success' | 'error',
            logs: r.logs,
          })),
        });
        const successCount = job.results.filter(
          (r) => r.status === 'success',
        ).length;
        this.telegramService
          .notifyScriptExecution(
            script.name,
            job.status as 'success' | 'error',
            successCount,
            job.results.length,
          )
          .catch(() => {});
        setTimeout(() => this.jobs.delete(jobId), 3_600_000);
      });

    return { jobId };
  }

  private async executeHysteria2ClusterScript(
    script: Script,
    requestedNodeIds: string[],
    targetNodes: SshNode[],
    variables?: Record<string, string>,
    variablesPerNode?: Record<string, Record<string, string>>,
  ): Promise<{ jobId: string }> {
    const uniqueRequestedIds = [...new Set(requestedNodeIds)];
    if (
      uniqueRequestedIds.length !== requestedNodeIds.length ||
      targetNodes.length !== uniqueRequestedIds.length
    ) {
      throw new Error(
        'Некоторые выбранные ноды не найдены или указаны несколько раз.',
      );
    }

    const isSetup = script.id === HYSTERIA2_SCRIPT_ID;
    const domainVariable = isSetup ? 'hysteria_domain' : 'hysteria_new_domain';
    const renderedContentByNode = new Map<string, string>();
    let domain = '';
    let email = '';

    for (const node of targetNodes) {
      const nodeVariables = {
        ...(variables ?? {}),
        ...(variablesPerNode?.[node.id] ?? {}),
      };
      const nodeDomain = normalizeHysteriaDomain(
        nodeVariables[domainVariable] ?? '',
      );
      const nodeEmail = normalizeHysteriaEmail(
        nodeVariables.certbot_email ?? '',
      );
      if (domain && nodeDomain !== domain) {
        throw new Error(
          'Для всех нод группы Hysteria2 должен быть указан одинаковый домен.',
        );
      }
      if (email && nodeEmail !== email) {
        throw new Error(
          "Для всех нод группы Hysteria2 должен быть указан один email Let's Encrypt.",
        );
      }
      domain = nodeDomain;
      email = nodeEmail;
      renderedContentByNode.set(
        node.id,
        this.renderScript(script, nodeVariables),
      );
    }

    const currentState = await this.loadHysteria2ClusterState();
    const now = new Date().toISOString();
    const existingSetupGroup = currentState.groups.find(
      (candidate) =>
        candidate.domain === domain &&
        candidate.nodeIds.some((nodeId) =>
          targetNodes.some((node) => node.id === nodeId),
        ),
    );
    const upsert = isSetup
      ? upsertHysteria2SetupGroup(currentState, {
          groupId: existingSetupGroup?.id ?? randomId(),
          domain,
          email,
          nodeIds: targetNodes.map((node) => node.id),
          now,
        })
      : upsertHysteria2ReconfigureGroup(currentState, {
          newDomain: domain,
          email,
          nodeIds: targetNodes.map((node) => node.id),
          now,
        });

    const sensitiveValues = [
      ...Object.values(variables || {}),
      ...Object.values(variablesPerNode || {}).flatMap((nodeVariables) =>
        Object.values(nodeVariables),
      ),
    ].filter((value) => value.length > 3);
    const jobId = randomId();
    const startedAt = new Date().toISOString();
    const job: ScriptJob = {
      scriptName: script.name,
      status: 'running',
      results: targetNodes.map((node) => ({
        nodeId: node.id,
        nodeName: node.name,
        logs: [],
        status: 'running',
      })),
    };
    this.jobs.set(jobId, job);

    void (async () => {
      try {
        await this.withHysteriaClusterLock(
          HYSTERIA2_CLUSTER_LOCK_KEY,
          async () => {
            await this.runHysteria2ClusterOperation({
              state: upsert.state,
              group: upsert.group,
              created: upsert.created,
              action: isSetup ? 'setup' : 'reconfigure',
              nodes: targetNodes,
              results: job.results,
              renderedContentByNode,
              sensitiveValues,
            });
          },
        );
        job.status = 'success';
      } catch (error) {
        const message = this.maskSecrets(
          `[ERROR] ${this.errorMessage(error)}`,
          sensitiveValues,
        );
        for (const result of job.results) {
          if (result.status === 'running') {
            result.logs.push(message);
            result.status = 'error';
          }
        }
        job.status = 'error';
      } finally {
        await this.finishScriptJob(
          jobId,
          script.id,
          script.name,
          startedAt,
          job,
          true,
        );
      }
    })();

    return { jobId };
  }

  private errorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (typeof error === 'string') return error;
    try {
      return JSON.stringify(error) || 'Неизвестная ошибка';
    } catch {
      return 'Неизвестная ошибка';
    }
  }

  private async loadHysteria2ClusterState(): Promise<Hysteria2ClusterState> {
    const row = await this.settingRepo.findOne({
      where: { key: HYSTERIA2_CLUSTER_STATE_KEY },
    });
    if (!row?.value) return createEmptyHysteria2ClusterState();

    let parsed: unknown;
    try {
      parsed = JSON.parse(row.value);
    } catch {
      throw new Error('Состояние кластеров Hysteria2 повреждено.');
    }
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      (parsed as Hysteria2ClusterState).version !==
        HYSTERIA2_CLUSTER_STATE_VERSION ||
      !Array.isArray((parsed as Hysteria2ClusterState).groups)
    ) {
      throw new Error(
        'Состояние кластеров Hysteria2 имеет неизвестный формат.',
      );
    }
    return parsed as Hysteria2ClusterState;
  }

  private async saveHysteria2ClusterState(
    state: Hysteria2ClusterState,
  ): Promise<void> {
    await this.saveSetting(HYSTERIA2_CLUSTER_STATE_KEY, JSON.stringify(state));
  }

  private replaceHysteria2ClusterGroup(
    state: Hysteria2ClusterState,
    group: Hysteria2ClusterGroup,
  ): Hysteria2ClusterState {
    return {
      version: HYSTERIA2_CLUSTER_STATE_VERSION,
      groups: [
        ...state.groups.filter((candidate) => candidate.id !== group.id),
        { ...group, nodeIds: [...group.nodeIds] },
      ].sort((left, right) => left.id.localeCompare(right.id)),
    };
  }

  private async withHysteriaClusterLock<T>(
    key: string,
    task: () => Promise<T>,
  ): Promise<T> {
    const previous = this.hysteriaClusterLocks.get(key) ?? Promise.resolve();
    let release = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queued = previous.catch(() => undefined).then(() => gate);
    this.hysteriaClusterLocks.set(key, queued);
    await previous.catch(() => undefined);
    try {
      return await task();
    } finally {
      release();
      if (this.hysteriaClusterLocks.get(key) === queued) {
        this.hysteriaClusterLocks.delete(key);
      }
    }
  }

  private async runWithConcurrency<T>(
    values: readonly T[],
    limit: number,
    worker: (value: T, index: number) => Promise<void>,
  ): Promise<PromiseSettledResult<void>[]> {
    const outcomes = new Array<PromiseSettledResult<void>>(values.length);
    let cursor = 0;
    const runners = Array.from(
      { length: Math.min(Math.max(limit, 1), values.length) },
      async () => {
        while (cursor < values.length) {
          const index = cursor++;
          try {
            await worker(values[index], index);
            outcomes[index] = { status: 'fulfilled', value: undefined };
          } catch (reason) {
            outcomes[index] = { status: 'rejected', reason };
          }
        }
      },
    );
    await Promise.all(runners);
    return outcomes;
  }

  private async resolveHysteria2ClusterDns(
    domain: string,
    nodes: readonly SshNode[],
  ): Promise<Hysteria2ClusterDnsValidation> {
    const resolveOptional = async (
      resolver: () => Promise<string[]>,
    ): Promise<string[]> => {
      try {
        return await resolver();
      } catch (error) {
        const code = (error as NodeJS.ErrnoException)?.code;
        if (code === 'ENODATA' || code === 'ENOTFOUND') return [];
        throw error;
      }
    };
    const [resolvedIpv4, resolvedIpv6] = await Promise.all([
      resolveOptional(() => dns.resolve4(domain)),
      resolveOptional(() => dns.resolve6(domain)),
    ]);
    if (resolvedIpv6.length > 0) {
      throw new Error(
        `Для домена ${domain} найдены AAAA-записи. Текущая кластерная настройка Hysteria2 поддерживает только A-записи; удалите AAAA перед запуском.`,
      );
    }
    const nodeAddresses = await Promise.all(
      nodes.map(async (node) => ({
        nodeId: node.id,
        address: await this.resolveHysteria2NodeAddress(node),
      })),
    );
    return validateHysteria2ClusterDns({
      domain,
      resolvedIpv4,
      resolvedIpv6,
      nodes: nodeAddresses,
    });
  }

  private async resolveHysteria2NodeAddress(node: SshNode): Promise<string> {
    if (isIP(node.ip)) return normalizeIpAddress(node.ip);
    let addresses: string[];
    try {
      addresses = await dns.resolve4(node.ip);
    } catch {
      throw new Error(
        `Не удалось определить IPv4-адрес SSH-ноды ${node.name}: ${node.ip}`,
      );
    }
    const uniqueAddresses = [
      ...new Set(addresses.map((address) => normalizeIpAddress(address))),
    ];
    if (uniqueAddresses.length !== 1) {
      throw new Error(
        `SSH-адрес ноды ${node.name} (${node.ip}) должен резолвиться ровно в один IPv4-адрес для DNS-балансировки Hysteria2.`,
      );
    }
    return uniqueAddresses[0];
  }

  private certificateHasExactDomain(
    certificate: X509Certificate,
    domain: string,
  ): boolean {
    const dnsNames = (certificate.subjectAltName ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter((value) => value.startsWith('DNS:'))
      .map((value) => value.slice(4).toLowerCase());
    return dnsNames.length === 1 && dnsNames[0] === domain;
  }

  private async selectInitialHysteria2Coordinator(
    group: Hysteria2ClusterGroup,
    nodes: readonly SshNode[],
  ): Promise<string> {
    const rootNodes = nodes
      .filter((node) => (node.sshUser || 'root') === 'root')
      .sort((left, right) => left.id.localeCompare(right.id));
    if (rootNodes.length === 0) {
      throw new Error(
        'Для coordinator Hysteria2 нужна хотя бы одна нода с SSH-пользователем root.',
      );
    }

    const matching: string[] = [];
    await this.runWithConcurrency(
      rootNodes,
      HYSTERIA2_CLUSTER_CONCURRENCY,
      async (node) => {
        try {
          const files = await this.readRemoteFiles(
            node,
            ['/opt/certbot/hysteria2.env', HYSTERIA2_CERTIFICATE_PATH],
            384 * 1024,
          );
          const environment = files
            .get('/opt/certbot/hysteria2.env')
            ?.toString('utf8');
          const certificatePem = files.get(HYSTERIA2_CERTIFICATE_PATH);
          if (
            !environment
              ?.split(/\r?\n/)
              .some(
                (line) => line.trim() === `HYSTERIA_DOMAIN=${group.domain}`,
              ) ||
            !certificatePem
          ) {
            return;
          }
          const certificate = new X509Certificate(certificatePem);
          if (
            certificate.checkHost(group.domain) &&
            this.certificateHasExactDomain(certificate, group.domain) &&
            Date.parse(certificate.validTo) > Date.now() + 86_400_000
          ) {
            matching.push(node.id);
          }
        } catch {
          // A missing or unreadable local lineage simply makes this node
          // ineligible for migration preference. The full prepare phase below
          // still reports connectivity errors for every selected node.
        }
      },
    );
    matching.sort((left, right) => left.localeCompare(right));
    if (matching.includes(group.coordinatorNodeId)) {
      return group.coordinatorNodeId;
    }
    return matching[0] ?? rootNodes[0].id;
  }

  private readAndValidateHysteria2Certificate(
    node: SshNode,
    domain: string,
  ): Promise<Hysteria2CertificateBundle> {
    if ((node.sshUser || 'root') !== 'root') {
      return Promise.reject(
        new Error(
          'Coordinator Hysteria2 должен подключаться по SSH как root для безопасного чтения private key.',
        ),
      );
    }
    return this.readRemoteFiles(
      node,
      [HYSTERIA2_CERTIFICATE_PATH, HYSTERIA2_PRIVATE_KEY_PATH],
      384 * 1024,
    ).then((files) => {
      const fullchain = files.get(HYSTERIA2_CERTIFICATE_PATH);
      const privateKey = files.get(HYSTERIA2_PRIVATE_KEY_PATH);
      if (!fullchain || !privateKey) {
        throw new Error('Coordinator не вернул полный комплект сертификата.');
      }

      let certificate: X509Certificate;
      try {
        certificate = new X509Certificate(fullchain);
      } catch {
        throw new Error('Сертификат coordinator повреждён.');
      }
      if (
        !certificate.checkHost(domain) ||
        !this.certificateHasExactDomain(certificate, domain)
      ) {
        throw new Error(
          `Сертификат coordinator не соответствует единственному домену ${domain}.`,
        );
      }
      const expiresAt = Date.parse(certificate.validTo);
      if (!Number.isFinite(expiresAt) || expiresAt <= Date.now() + 86_400_000) {
        throw new Error(
          'Сертификат coordinator просрочен или истекает менее чем через сутки.',
        );
      }

      try {
        const parsedPrivateKey = createPrivateKey(privateKey);
        const certificatePublicKey = certificate.publicKey.export({
          type: 'spki',
          format: 'der',
        });
        const privatePublicKey = createPublicKey(parsedPrivateKey).export({
          type: 'spki',
          format: 'der',
        });
        if (
          !Buffer.from(certificatePublicKey).equals(
            Buffer.from(privatePublicKey),
          )
        ) {
          throw new Error('mismatch');
        }
      } catch {
        throw new Error(
          'Private key coordinator не соответствует сертификату.',
        );
      }

      const fingerprint = certificate.fingerprint256
        .replaceAll(':', '')
        .toLowerCase();
      if (!/^[0-9a-f]{64}$/.test(fingerprint)) {
        throw new Error('Не удалось вычислить fingerprint сертификата.');
      }
      return {
        fullchain,
        privateKey,
        fingerprint,
        notAfter: new Date(expiresAt).toISOString(),
      };
    });
  }

  private async runHysteria2ClusterOperation(options: {
    state: Hysteria2ClusterState;
    group: Hysteria2ClusterGroup;
    created: boolean;
    action: 'setup' | 'reconfigure' | 'renew';
    nodes: SshNode[];
    results: NodeResult[];
    renderedContentByNode?: Map<string, string>;
    sensitiveValues: string[];
  }): Promise<void> {
    let { state, group } = options;
    const resultByNodeId = new Map(
      options.results.map((result) => [result.nodeId, result]),
    );
    const nodesById = new Map(options.nodes.map((node) => [node.id, node]));

    if (options.created) {
      const coordinatorNodeId = await this.selectInitialHysteria2Coordinator(
        group,
        options.nodes,
      );
      if (coordinatorNodeId !== group.coordinatorNodeId) {
        group = { ...group, coordinatorNodeId };
        state = this.replaceHysteria2ClusterGroup(state, group);
      }
    }

    const coordinator = nodesById.get(group.coordinatorNodeId);
    const coordinatorResult = resultByNodeId.get(group.coordinatorNodeId);
    if (!coordinator || !coordinatorResult) {
      throw new Error(
        'Сохранённый coordinator Hysteria2 отсутствует среди выбранных нод.',
      );
    }
    if ((coordinator.sshUser || 'root') !== 'root') {
      throw new Error(
        `Coordinator ${coordinator.name} должен подключаться по SSH как root.`,
      );
    }

    const dnsValidation = await this.resolveHysteria2ClusterDns(
      group.domain,
      options.nodes,
    );
    const coordinatorAddress =
      dnsValidation.nodes.find((node) => node.nodeId === coordinator.id)
        ?.address ?? (await this.resolveHysteria2NodeAddress(coordinator));
    const followers = options.nodes.filter(
      (node) => node.id !== coordinator.id,
    );

    coordinatorResult.logs.push(
      `[CLUSTER] Coordinator: ${coordinator.name} (${coordinatorAddress})`,
    );
    coordinatorResult.logs.push(
      '[CLUSTER] Подготовка общего маршрута HTTP-01...',
    );
    await this.runScriptOnNode(
      coordinator,
      buildHysteria2ClusterCaddyPrepareScript({
        domain: group.domain,
        role: 'coordinator',
      }),
      coordinatorResult,
      options.sensitiveValues,
    );

    const prepareOutcomes = await this.runWithConcurrency(
      followers,
      HYSTERIA2_CLUSTER_CONCURRENCY,
      async (node) => {
        const result = resultByNodeId.get(node.id);
        if (!result) throw new Error(`Не найден результат ноды ${node.id}`);
        result.logs.push(
          `[CLUSTER] HTTP-01 перенаправляется на coordinator ${coordinatorAddress}`,
        );
        try {
          await this.runScriptOnNode(
            node,
            buildHysteria2ClusterCaddyPrepareScript({
              domain: group.domain,
              role: 'follower',
              coordinatorAddress,
            }),
            result,
            options.sensitiveValues,
          );
        } catch (error) {
          result.logs.push(
            this.maskSecrets(
              `[ERROR] ${this.errorMessage(error)}`,
              options.sensitiveValues,
            ),
          );
          result.status = 'error';
          throw error;
        }
      },
    );
    if (prepareOutcomes.some((outcome) => outcome.status === 'rejected')) {
      throw new Error(
        'HTTP-01 не подготовлен на всех DNS-нодах; запрос сертификата отменён.',
      );
    }

    coordinatorResult.logs.push(
      `[CLUSTER] Проверка HTTP-01 через ${dnsValidation.resolvedAddresses.length} DNS-адресов...`,
    );
    await this.runScriptOnNode(
      coordinator,
      buildHysteria2ClusterProbeScript({
        domain: group.domain,
        addresses: dnsValidation.resolvedAddresses,
      }),
      coordinatorResult,
      options.sensitiveValues,
    );

    coordinatorResult.logs.push(
      options.action === 'renew'
        ? '[CLUSTER] Проверка централизованного продления сертификата...'
        : '[CLUSTER] Получение и публикация единого сертификата...',
    );
    const coordinatorScript =
      options.action === 'renew'
        ? `export HYSTERIA_CLUSTER_MANAGED=1\n` +
          `test -x /opt/certbot/renew-hysteria2.sh || { echo "[ERROR] Скрипт продления Hysteria2 не найден" >&2; exit 1; }\n` +
          `/opt/certbot/renew-hysteria2.sh`
        : options.renderedContentByNode?.get(coordinator.id);
    if (!coordinatorScript) {
      throw new Error('Не удалось подготовить coordinator script Hysteria2.');
    }
    await this.runScriptOnNode(
      coordinator,
      options.action === 'renew'
        ? coordinatorScript
        : `export HYSTERIA_CLUSTER_MANAGED=1\n${coordinatorScript}`,
      coordinatorResult,
      options.sensitiveValues,
    );

    // Commit the coordinator and lineage as soon as they are healthy. If a
    // follower fails below, the scheduler can repair it from this saved state.
    await this.saveHysteria2ClusterState(state);
    const bundle = await this.readAndValidateHysteria2Certificate(
      coordinator,
      group.domain,
    );
    coordinatorResult.logs.push(
      `[CLUSTER] Сертификат проверен, fingerprint ${bundle.fingerprint.slice(0, 16)}…`,
    );
    coordinatorResult.status = 'success';

    const fullchainBase64 = bundle.fullchain.toString('base64');
    const privateKeyBase64 = bundle.privateKey.toString('base64');
    const certificateMasks = [
      ...options.sensitiveValues,
      bundle.privateKey.toString('utf8'),
      privateKeyBase64,
    ];
    const deployScript = buildHysteria2ClusterCertificateDeployScript({
      domain: group.domain,
      fullchainBase64,
      privateKeyBase64,
    });
    const deployOutcomes = await this.runWithConcurrency(
      followers,
      HYSTERIA2_CLUSTER_CONCURRENCY,
      async (node) => {
        const result = resultByNodeId.get(node.id);
        if (!result) throw new Error(`Не найден результат ноды ${node.id}`);
        result.logs.push('[CLUSTER] Установка единого сертификата...');
        try {
          await this.runScriptOnNode(
            node,
            deployScript,
            result,
            certificateMasks,
          );
          result.status = 'success';
        } catch (error) {
          result.logs.push(
            this.maskSecrets(
              `[ERROR] ${this.errorMessage(error)}`,
              certificateMasks,
            ),
          );
          result.status = 'error';
          throw error;
        }
      },
    );
    if (deployOutcomes.some((outcome) => outcome.status === 'rejected')) {
      throw new Error(
        'Сертификат получен, но доставлен не на все follower-ноды. Следующее автопродление повторит доставку.',
      );
    }

    const completedAt = new Date().toISOString();
    group = {
      ...group,
      certificateFingerprint: bundle.fingerprint,
      certificateNotAfter: bundle.notAfter,
      lastRenewalAt: completedAt,
      updatedAt: completedAt,
    };
    state = this.replaceHysteria2ClusterGroup(state, group);
    await this.saveHysteria2ClusterState(state);
  }

  private async finishScriptJob(
    jobId: string,
    scriptId: string,
    scriptName: string,
    startedAt: string,
    job: ScriptJob,
    notify: boolean,
  ): Promise<void> {
    const finishedAt = new Date().toISOString();
    await this.appendHistory({
      id: jobId,
      scriptId,
      scriptName,
      status: job.status as 'success' | 'error',
      startedAt,
      finishedAt,
      durationMs:
        new Date(finishedAt).getTime() - new Date(startedAt).getTime(),
      nodeResults: job.results.map((result) => ({
        nodeId: result.nodeId,
        nodeName: result.nodeName,
        status: result.status as 'success' | 'error',
        logs: result.logs,
      })),
    });
    if (notify) {
      const successCount = job.results.filter(
        (result) => result.status === 'success',
      ).length;
      this.telegramService
        .notifyScriptExecution(
          scriptName,
          job.status as 'success' | 'error',
          successCount,
          job.results.length,
        )
        .catch(() => undefined);
    }
    const cleanupTimer = setTimeout(() => this.jobs.delete(jobId), 3_600_000);
    cleanupTimer.unref?.();
  }

  @Cron('17 3,15 * * *', { timeZone: 'UTC' })
  async renewHysteria2Clusters(): Promise<void> {
    let snapshot: Hysteria2ClusterState;
    try {
      snapshot = await this.loadHysteria2ClusterState();
    } catch (error) {
      this.logger.error(
        `Автопродление Hysteria2 не запущено: ${this.errorMessage(error)}`,
      );
      return;
    }

    for (const snapshotGroup of snapshot.groups) {
      try {
        await this.withHysteriaClusterLock(
          HYSTERIA2_CLUSTER_LOCK_KEY,
          async () => {
            const state = await this.loadHysteria2ClusterState();
            const group = state.groups.find(
              (candidate) => candidate.id === snapshotGroup.id,
            );
            if (!group) return;
            const nodes = await this.loadSshNodesForExecution(group.nodeIds);
            if (nodes.length !== group.nodeIds.length) {
              throw new Error(
                'Одна или несколько нод группы удалены из SSH-реестра.',
              );
            }
            const results: NodeResult[] = nodes.map((node) => ({
              nodeId: node.id,
              nodeName: node.name,
              logs: [],
              status: 'running',
            }));
            await this.runHysteria2ClusterOperation({
              state,
              group,
              created: false,
              action: 'renew',
              nodes,
              results,
              sensitiveValues: [],
            });
            this.logger.log(
              `Hysteria2 cluster ${group.domain}: сертификат проверен и синхронизирован на ${nodes.length} нодах`,
            );
          },
        );
      } catch (error) {
        this.logger.error(
          `Hysteria2 cluster ${snapshotGroup.domain}: ошибка автопродления: ${this.errorMessage(error)}`,
        );
      }
    }
  }

  async executeSequence(
    scriptIds: string[],
    nodeIds: string[],
    variablesPerScript: Record<string, Record<string, string>>,
    variablesPerScriptPerNode?: Record<
      string,
      Record<string, Record<string, string>>
    >,
  ): Promise<{ jobId: string }> {
    if (!scriptIds.length) throw new Error('Список скриптов пуст');

    const scripts = await this.loadScripts();
    const resolvedScripts = scriptIds.map((id) => {
      const s = scripts.find((sc) => sc.id === id);
      if (!s) throw new Error(`Скрипт не найден: ${id}`);
      return s;
    });

    const nodes = await this.loadSshNodesForExecution(nodeIds);
    const targetNodes = nodes.filter((n) => nodeIds.includes(n.id));
    if (!targetNodes.length) throw new Error('Не выбрано ни одной ноды');

    if (
      targetNodes.length > 1 &&
      resolvedScripts.some(
        (script) =>
          script.isBuiltIn &&
          !script.isModified &&
          (script.id === HYSTERIA2_SCRIPT_ID ||
            script.id === HYSTERIA2_RECONFIGURE_SCRIPT_ID),
      )
    ) {
      throw new Error(
        'Кластерные скрипты Hysteria2 запускаются отдельно, потому что HTTP-01 и сертификат координируются для всей группы нод.',
      );
    }

    const renderedContentByNode = new Map<string, string[]>();
    for (const node of targetNodes) {
      renderedContentByNode.set(
        node.id,
        resolvedScripts.map((script) => {
          const vars = {
            ...(variablesPerScript[script.id] ?? {}),
            ...(variablesPerScriptPerNode?.[script.id]?.[node.id] ?? {}),
          };
          return this.renderScript(script, vars);
        }),
      );
    }

    const sensitiveValues = [
      ...Object.values(variablesPerScript).flatMap((vars) =>
        Object.values(vars),
      ),
      ...Object.values(variablesPerScriptPerNode || {})
        .flatMap((perNode) => Object.values(perNode))
        .flatMap((vars) => Object.values(vars)),
    ].filter((v) => v.length > 3);

    const jobId = randomId();
    const startedAt = new Date().toISOString();
    const scriptName = resolvedScripts.map((s) => s.name).join(' → ');
    const job: ScriptJob = {
      scriptName,
      status: 'running',
      results: targetNodes.map((n) => ({
        nodeId: n.id,
        nodeName: n.name,
        logs: [],
        status: 'running',
      })),
    };
    this.jobs.set(jobId, job);

    const nodePromises = targetNodes.map(async (node, idx) => {
      const result = job.results[idx];
      for (let i = 0; i < resolvedScripts.length; i++) {
        const script = resolvedScripts[i];
        const content =
          renderedContentByNode.get(node.id)?.[i] ?? script.content;

        result.logs.push(`=== Скрипт ${i + 1}: ${script.name} ===`);

        try {
          await this.runScriptOnNode(node, content, result, sensitiveValues);
        } catch (e) {
          result.logs.push(
            this.maskSecrets(
              `[ERROR] ${e?.message || String(e)}`,
              sensitiveValues,
            ),
          );
          result.status = 'error';
          return;
        }
      }
      result.status = 'success';
    });

    Promise.all(nodePromises)
      .then(() => {
        job.status = job.results.every((r) => r.status === 'success')
          ? 'success'
          : 'error';
      })
      .catch(() => {
        job.status = 'error';
      })
      .finally(async () => {
        const finishedAt = new Date().toISOString();
        await this.appendHistory({
          id: jobId,
          scriptId: scriptIds.join(','),
          scriptName,
          status: job.status as 'success' | 'error',
          startedAt,
          finishedAt,
          durationMs:
            new Date(finishedAt).getTime() - new Date(startedAt).getTime(),
          nodeResults: job.results.map((r) => ({
            nodeId: r.nodeId,
            nodeName: r.nodeName,
            status: r.status as 'success' | 'error',
            logs: r.logs,
          })),
        });
        setTimeout(() => this.jobs.delete(jobId), 3_600_000);
      });

    return { jobId };
  }

  getJobStatus(jobId: string): ScriptJob | null {
    return this.jobs.get(jobId) || null;
  }

  private stripAnsi(text: string): string {
    // eslint-disable-next-line no-control-regex
    return text.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '').replace(/\r/g, '');
  }

  private sshConnectOptions(node: SshNode): ConnectConfig {
    const options: ConnectConfig = {
      host: node.ip,
      port: node.sshPort || 22,
      username: node.sshUser || 'root',
      readyTimeout: 30_000,
    };
    if (node.authType === 'key' && node.sshKey) {
      options.privateKey = node.sshKey;
    } else {
      options.password = node.password || '';
    }
    return options;
  }

  private readRemoteFiles(
    node: SshNode,
    paths: string[],
    maxTotalBytes = 512 * 1024,
  ): Promise<Map<string, Buffer>> {
    return new Promise((resolve, reject) => {
      const conn = new Client();
      let settled = false;
      const timeout = setTimeout(
        () => finish(new Error('Таймаут чтения файлов сертификата по SSH')),
        30_000,
      );
      const finish = (error?: Error, files?: Map<string, Buffer>) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        conn.end();
        if (error) reject(error);
        else resolve(files ?? new Map());
      };

      conn.on('ready', () => {
        conn.sftp((sftpError, sftp) => {
          if (sftpError) return finish(sftpError);
          const readFile = (path: string) =>
            new Promise<Buffer>((readResolve, readReject) => {
              sftp.stat(path, (statError, attributes) => {
                if (statError) return readReject(statError);
                if (
                  !Number.isFinite(attributes.size) ||
                  attributes.size <= 0 ||
                  attributes.size > maxTotalBytes
                ) {
                  return readReject(
                    new Error(
                      'Удалённый файл имеет недопустимый размер: ' + path,
                    ),
                  );
                }
                sftp.readFile(path, (error, data) => {
                  if (error) return readReject(error);
                  const content = Buffer.isBuffer(data)
                    ? data
                    : Buffer.from(data);
                  if (content.length === 0 || content.length > maxTotalBytes) {
                    return readReject(
                      new Error(
                        'Удалённый файл имеет недопустимый размер: ' + path,
                      ),
                    );
                  }
                  readResolve(content);
                });
              });
            });

          void Promise.all(
            paths.map(async (path) => [path, await readFile(path)] as const),
          )
            .then((entries) => {
              const totalBytes = entries.reduce(
                (sum, [, content]) => sum + content.length,
                0,
              );
              if (totalBytes > maxTotalBytes) {
                throw new Error(
                  'Файлы сертификата превышают допустимый размер',
                );
              }
              finish(undefined, new Map(entries));
            })
            .catch((error: Error) => finish(error));
        });
      });
      conn.on('error', (error) => finish(error));
      conn.on('close', () => {
        if (!settled) finish(new Error('SSH-соединение закрыто'));
      });
      connectSsh(conn, this.sshConnectOptions(node), node.proxyUrl);
    });
  }

  private runScriptOnNode(
    node: SshNode,
    content: string,
    result: NodeResult,
    mask: string[],
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const conn = new Client();
      const remoteScriptPath = `/tmp/rwm-script-${randomId()}.sh`;
      let settled = false;
      let uploadTimer: ReturnType<typeof setTimeout> | undefined;

      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        if (uploadTimer) clearTimeout(uploadTimer);
        conn.end();
        if (error) {
          reject(error);
        } else {
          result.logs.push('[SSH] Выполнено успешно');
          resolve();
        }
      };

      const executeUploadedScript = (useSudo: boolean) => {
        const runner = useSudo ? 'sudo bash' : 'bash';
        const cmd =
          `RWM_SCRIPT_FILE='${remoteScriptPath}'; ` +
          'rwm_cleanup() { rm -f -- "$RWM_SCRIPT_FILE"; }; ' +
          'trap rwm_cleanup EXIT; ' +
          "trap 'exit 129' HUP; trap 'exit 130' INT; trap 'exit 143' TERM; " +
          `${runner} -e -- "$RWM_SCRIPT_FILE"`;

        conn.exec(
          cmd,
          { pty: { term: 'xterm', cols: 200, rows: 50 } },
          (err, stream) => {
            if (err) {
              result.logs.push(
                this.maskSecrets(`[ERROR] ${err.message}`, mask),
              );
              return finish(err);
            }

            stream.on('data', (data: Buffer) => {
              const text = this.stripAnsi(data.toString());
              // Auto-respond 'y' to common y/n confirmation prompts (e.g. ToS acceptance)
              if (/\[y\/n\]|\[Y\/N\]|\[yes\/no\]/i.test(text)) {
                stream.write('y\n');
                result.logs.push(
                  '[AUTO] Отправлен ответ "y" на запрос подтверждения',
                );
              }
              text
                .split('\n')
                .filter((line) => line.trim())
                .forEach((line) =>
                  result.logs.push(this.maskSecrets(line, mask)),
                );
            });

            // With PTY, stderr is merged into stdout — keep handler for non-PTY compat
            stream.stderr.on('data', (data: Buffer) => {
              this.stripAnsi(data.toString())
                .split('\n')
                .filter(Boolean)
                .forEach((line) =>
                  result.logs.push(this.maskSecrets(`[stderr] ${line}`, mask)),
                );
            });

            stream.on('error', (streamError: Error) => finish(streamError));
            stream.on('close', (code: number) => {
              if (settled) return;
              if (code !== 0) {
                return finish(
                  new Error(`Скрипт завершился с кодом ${String(code)}`),
                );
              }
              finish();
            });
          },
        );
      };

      conn.on('ready', () => {
        const useSudo = node.sshUser && node.sshUser !== 'root';
        result.logs.push(
          useSudo ? '[SSH] Подключено (sudo)' : '[SSH] Подключено',
        );

        // Upload over a dedicated channel first. Commands executed by the script
        // may read stdin; keeping source code on stdin would let them consume the
        // unparsed remainder of the script.
        // Self-delete after Bash has opened the file. The EXIT trap below remains
        // a fallback, but an SSH process can be killed before traps are delivered.
        const uploadedContent = `rm -f -- "$0"\n${content}`;
        const contentBytes = Buffer.byteLength(uploadedContent, 'utf8');
        const orphanCleanupSeconds = 300;
        const uploadCmd =
          `RWM_SCRIPT_FILE='${remoteScriptPath}'; umask 077; ` +
          'cat > "$RWM_SCRIPT_FILE" && ' +
          `[ "$(wc -c < "$RWM_SCRIPT_FILE")" -eq ${contentBytes} ] || ` +
          '{ rm -f -- "$RWM_SCRIPT_FILE"; exit 1; }; ' +
          `nohup sh -c 'sleep ${orphanCleanupSeconds}; rm -f -- "$1"' ` +
          'sh "$RWM_SCRIPT_FILE" </dev/null >/dev/null 2>&1 &';

        uploadTimer = setTimeout(
          () => finish(new Error('Таймаут загрузки скрипта на ноду')),
          30_000,
        );

        conn.exec(uploadCmd, (err, stream) => {
          // A timed-out SSH request can still deliver its callback later. End
          // that channel without sending the payload; the remote size check
          // then removes the empty/incomplete file.
          if (settled) {
            if (!err) {
              stream.on('error', () => undefined);
              stream.stderr.on('error', () => undefined);
              stream.resume();
              stream.stderr.resume();
              stream.end();
            }
            return;
          }
          if (err) {
            result.logs.push(this.maskSecrets(`[ERROR] ${err.message}`, mask));
            return finish(err);
          }

          let uploadError = '';
          // Consume stdout so the non-PTY channel enters flowing mode and can
          // deliver its close event after the remote cat process exits.
          stream.on('data', (data: Buffer) => {
            uploadError += this.stripAnsi(data.toString());
          });
          stream.stderr.on('data', (data: Buffer) => {
            uploadError += this.stripAnsi(data.toString());
          });
          stream.on('error', (streamError: Error) => finish(streamError));
          stream.on('close', (code: number) => {
            if (settled) return;
            if (uploadTimer) {
              clearTimeout(uploadTimer);
              uploadTimer = undefined;
            }
            if (code !== 0) {
              const detail = uploadError.trim();
              return finish(
                new Error(
                  `Не удалось загрузить скрипт на ноду (код ${String(code)})${detail ? `: ${detail}` : ''}`,
                ),
              );
            }
            executeUploadedScript(Boolean(useSudo));
          });
          stream.end(uploadedContent, 'utf8');
        });
      });

      conn.on('error', (err) => {
        result.logs.push(
          this.maskSecrets(`[SSH] Ошибка подключения: ${err.message}`, mask),
        );
        finish(err);
      });
      conn.on('close', () => {
        if (!settled) finish(new Error('SSH-соединение закрыто'));
      });

      connectSsh(conn, this.sshConnectOptions(node), node.proxyUrl);
    });
  }
}
