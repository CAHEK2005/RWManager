import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Client } from 'ssh2';
import { v4 as uuidv4 } from 'uuid';
import { Setting } from '../settings/entities/setting.entity';
import type { InstallNodeDto } from '../nodes/nodes.service';

export interface SshNode {
  id: string;
  rwNodeUuid?: string;
  name: string;
  ip: string;
  sshPort: number;
  sshUser: string;
  authType: 'password' | 'key';
  password?: string;
  sshKey?: string;
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
}

const SYSCTL_CONTENT = `net.ipv6.conf.all.disable_ipv6 = 1
net.ipv6.conf.default.disable_ipv6 = 1
net.ipv6.conf.lo.disable_ipv6 = 1
net.ipv4.ip_forward = 1
net.ipv4.conf.all.send_redirects = 0
net.ipv4.conf.default.send_redirects = 0
net.ipv4.conf.all.accept_redirects = 0
net.ipv4.conf.default.accept_redirects = 0
net.ipv4.conf.all.accept_source_route = 0
net.ipv4.conf.default.accept_source_route = 0
net.ipv4.conf.all.rp_filter = 2
net.ipv4.conf.default.rp_filter = 2
net.ipv4.conf.all.log_martians = 1
net.ipv4.conf.default.log_martians = 1
net.ipv4.icmp_echo_ignore_broadcasts = 1
net.ipv4.icmp_ratelimit = 100
net.ipv4.icmp_ratemask = 88089
net.ipv4.icmp_ignore_bogus_error_responses = 1
net.ipv4.tcp_syncookies = 1
net.ipv4.tcp_timestamps = 1
net.ipv4.tcp_fin_timeout = 20
net.ipv4.tcp_fastopen = 1
net.ipv4.tcp_max_syn_backlog = 8192
net.ipv4.tcp_ecn = 1
net.ipv4.tcp_sack = 1
net.ipv4.tcp_keepalive_time = 600
net.ipv4.tcp_keepalive_intvl = 60
net.ipv4.tcp_keepalive_probes = 5
net.ipv4.tcp_rmem = 4096 87380 16777216
net.ipv4.tcp_wmem = 4096 65536 16777216
net.core.somaxconn = 4096
net.core.netdev_max_backlog = 5000
net.core.rmem_max = 16777216
net.core.wmem_max = 16777216
net.core.default_qdisc = fq
net.ipv4.tcp_congestion_control = bbr
kernel.yama.ptrace_scope = 1
kernel.randomize_va_space = 2
fs.suid_dumpable = 0
vm.swappiness = 10
fs.file-max = 2097152`;

const WARP_SETUP_SCRIPT = `PROXY_PORT="{{ warp_proxy_port | SOCKS5-порт WARP (по умолчанию 40000) }}"
PROXY_PORT="\${PROXY_PORT:-40000}"

# ── 1. Зависимости ────────────────────────────────────────────────────────────
echo "[1/5] Установка зависимостей..."
apt-get install -y curl gnupg lsb-release 2>/dev/null || true

# ── 2. Репозиторий Cloudflare ─────────────────────────────────────────────────
echo "[2/5] Добавление репозитория Cloudflare WARP..."
curl -fsSL https://pkg.cloudflareclient.com/pubkey.gpg \\
  | gpg --yes --dearmor --output /usr/share/keyrings/cloudflare-warp-archive-keyring.gpg

echo "deb [signed-by=/usr/share/keyrings/cloudflare-warp-archive-keyring.gpg] https://pkg.cloudflareclient.com/ \$(lsb_release -cs) main" \\
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

WARP_STATUS=\$(warp-cli status 2>&1 || true)

if echo "\$WARP_STATUS" | grep -qi "Registration Missing"; then
  echo "  Регистрация новой учётной записи..."
  warp-cli registration new
  sleep 2
else
  echo "  Учётная запись уже зарегистрирована, пропускаем"
fi

warp-cli mode proxy

if [ "\$PROXY_PORT" != "40000" ]; then
  echo "  Устанавливаем порт прокси: \$PROXY_PORT"
  warp-cli proxy port "\$PROXY_PORT"
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
    description: 'Применяет sysctl-параметры для оптимизации TCP/BBR и отключения IPv6',
    isBuiltIn: true,
    content: `tee /etc/sysctl.d/99-vpn.conf << 'SYSCTL_EOF'
${SYSCTL_CONTENT}
SYSCTL_EOF
sysctl -p /etc/sysctl.d/99-vpn.conf`,
  },
  {
    id: 'builtin-update-node',
    name: 'Обновление ноды',
    description: 'Скачивает последний образ Remnawave Node и перезапускает контейнер',
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
    id: 'builtin-setup-warp',
    name: 'Установка WARP',
    description: 'Устанавливает Cloudflare WARP, регистрирует учётную запись и настраивает SOCKS5-прокси на указанном порту (по умолчанию 40000)',
    isBuiltIn: true,
    content: WARP_SETUP_SCRIPT,
  },
  {
    id: 'builtin-warp-status',
    name: 'Статус WARP',
    description: 'Показывает текущий статус Cloudflare WARP и настройки прокси',
    isBuiltIn: true,
    content: WARP_STATUS_SCRIPT,
  },
  {
    id: 'builtin-uninstall-warp',
    name: 'Удаление WARP',
    description: 'Отключает, удаляет регистрацию и деинсталлирует Cloudflare WARP',
    isBuiltIn: true,
    content: WARP_UNINSTALL_SCRIPT,
  },
  {
    id: 'builtin-setup-ssh-key',
    name: 'Настройка SSH-ключа',
    description: 'Добавляет публичный SSH-ключ и отключает вход по паролю. Перед запуском потребуется ввести публичный ключ.',
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
];

@Injectable()
export class ScriptsService implements OnModuleInit {
  private readonly logger = new Logger(ScriptsService.name);
  private jobs = new Map<string, ScriptJob>();

  constructor(
    @InjectRepository(Setting)
    private settingRepo: Repository<Setting>,
  ) {}

  async onModuleInit() {
    await this.seedBuiltInScripts();
  }

  private async seedBuiltInScripts() {
    const scripts = await this.loadScripts();
    let changed = false;
    for (const builtin of BUILT_IN_SCRIPTS) {
      const idx = scripts.findIndex(s => s.id === builtin.id);
      if (idx < 0) {
        scripts.push(builtin);
        changed = true;
      } else if (!scripts[idx].isModified && !scripts[idx].isHidden && (
        scripts[idx].content !== builtin.content ||
        scripts[idx].name !== builtin.name ||
        scripts[idx].description !== builtin.description
      )) {
        scripts[idx] = { ...builtin }; // обновляем только немодифицированные встроенные скрипты
        changed = true;
      }
    }
    if (changed) {
      await this.saveSetting('scripts', JSON.stringify(scripts));
    }
  }

  private substituteVariables(content: string, variables: Record<string, string>): string {
    return content.replace(/\{\{\s*(\w+)(?:\s*\|[^}]*)?\s*\}\}/g, (_, name: string) => {
      return Object.prototype.hasOwnProperty.call(variables, name) ? variables[name] : `{{ ${name} }}`;
    });
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
    const raw = await this.settingRepo.findOne({ where: { key: 'ssh_nodes' } });
    try { return JSON.parse(raw?.value || '[]'); } catch { return []; }
  }

  private async loadSshNodes(): Promise<SshNode[]> {
    return this.getSshNodes();
  }

  async upsertSshNode(node: Omit<SshNode, 'id'> & { id?: string }): Promise<SshNode> {
    const nodes = await this.loadSshNodes();
    const id = node.id || uuidv4();
    const saved: SshNode = { ...node, id } as SshNode;
    const idx = nodes.findIndex(n => n.id === id);
    if (idx >= 0) nodes[idx] = saved;
    else nodes.push(saved);
    await this.saveSetting('ssh_nodes', JSON.stringify(nodes));
    return saved;
  }

  async deleteSshNode(id: string): Promise<void> {
    const nodes = await this.loadSshNodes();
    await this.saveSetting('ssh_nodes', JSON.stringify(nodes.filter(n => n.id !== id)));
  }

  async addSshNodeFromInstall(dto: InstallNodeDto, rwNodeUuid: string, name: string): Promise<void> {
    const node: SshNode = {
      id: uuidv4(),
      rwNodeUuid,
      name,
      ip: dto.ip,
      sshPort: dto.sshPort || 22,
      sshUser: dto.sshUser || 'root',
      authType: dto.authType,
      password: dto.password,
      sshKey: dto.sshKey,
    };
    const nodes = await this.loadSshNodes();
    nodes.push(node);
    await this.saveSetting('ssh_nodes', JSON.stringify(nodes));
    this.logger.log(`SSH-нода сохранена после установки: ${name} (${dto.ip})`);
  }

  // ── Scripts ──────────────────────────────────────────────────────────────────

  private async loadScripts(): Promise<Script[]> {
    const raw = await this.settingRepo.findOne({ where: { key: 'scripts' } });
    try { return JSON.parse(raw?.value || '[]'); } catch { return []; }
  }

  async getScripts(): Promise<Script[]> {
    const scripts = await this.loadScripts();
    return scripts.filter(s => !s.isHidden);
  }

  async upsertScript(script: Omit<Script, 'id' | 'isBuiltIn'> & { id?: string }): Promise<Script> {
    const scripts = await this.loadScripts();
    const id = script.id || uuidv4();
    const idx = scripts.findIndex(s => s.id === id);
    let saved: Script;
    if (idx >= 0) {
      const existing = scripts[idx];
      saved = { ...existing, name: script.name, description: script.description, content: script.content };
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
    const script = scripts.find(s => s.id === id);
    if (script?.isBuiltIn) {
      script.isHidden = true;
      await this.saveSetting('scripts', JSON.stringify(scripts));
      return;
    }
    await this.saveSetting('scripts', JSON.stringify(scripts.filter(s => s.id !== id)));
  }

  async revertScript(id: string): Promise<Script> {
    const original = BUILT_IN_SCRIPTS.find(s => s.id === id);
    if (!original) throw new Error('Скрипт не является встроенным или не найден');
    const scripts = await this.loadScripts();
    const idx = scripts.findIndex(s => s.id === id);
    if (idx < 0) throw new Error('Скрипт не найден');
    const reverted: Script = { ...original };
    scripts[idx] = reverted;
    await this.saveSetting('scripts', JSON.stringify(scripts));
    return reverted;
  }

  // ── History ──────────────────────────────────────────────────────────────────

  private async loadHistory(): Promise<HistoryEntry[]> {
    const raw = await this.settingRepo.findOne({ where: { key: 'script_history' } });
    try { return JSON.parse(raw?.value || '[]'); } catch { return []; }
  }

  private async appendHistory(entry: HistoryEntry): Promise<void> {
    try {
      const history = await this.loadHistory();
      history.unshift(entry);
      await this.saveSetting('script_history', JSON.stringify(history.slice(0, 100)));
    } catch (e) {
      this.logger.error('Ошибка сохранения истории:', e);
    }
  }

  async getHistory(page = 1, limit = 20): Promise<{ data: HistoryListItem[]; total: number }> {
    const history = await this.loadHistory();
    const total = history.length;
    const start = (page - 1) * limit;
    const data = history.slice(start, start + limit).map(e => ({
      id: e.id,
      scriptId: e.scriptId,
      scriptName: e.scriptName,
      status: e.status,
      startedAt: e.startedAt,
      finishedAt: e.finishedAt,
      durationMs: e.durationMs,
      nodeCount: e.nodeResults.length,
      successCount: e.nodeResults.filter(r => r.status === 'success').length,
    }));
    return { data, total };
  }

  async getHistoryEntry(id: string): Promise<HistoryEntry | null> {
    const history = await this.loadHistory();
    return history.find(e => e.id === id) ?? null;
  }

  async clearHistory(): Promise<void> {
    await this.saveSetting('script_history', '[]');
  }

  // ── Execute ──────────────────────────────────────────────────────────────────

  async executeScript(
    scriptId: string,
    nodeIds: string[],
    variables?: Record<string, string>,
    variablesPerNode?: Record<string, Record<string, string>>,
  ): Promise<{ jobId: string }> {
    const scripts = await this.loadScripts();
    const script = scripts.find(s => s.id === scriptId);
    if (!script) throw new Error('Скрипт не найден');

    const nodes = await this.loadSshNodes();
    const targetNodes = nodes.filter(n => nodeIds.includes(n.id));
    if (!targetNodes.length) throw new Error('Не выбрано ни одной ноды');

    const sensitiveValues = [
      ...Object.values(variables || {}),
      ...Object.values(variablesPerNode || {}).flatMap(v => Object.values(v)),
    ].filter(v => v.length > 3);

    const jobId = uuidv4();
    const startedAt = new Date().toISOString();
    const job: ScriptJob = {
      scriptName: script.name,
      status: 'running',
      results: targetNodes.map(n => ({
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
      const nodeVars = variablesPerNode?.[node.id] ?? variables ?? {};
      const content = Object.keys(nodeVars).length > 0
        ? this.substituteVariables(script.content, nodeVars)
        : script.content;
      try {
        await this.runScriptOnNode(node, content, result, sensitiveValues);
        result.status = 'success';
      } catch (e) {
        result.logs.push(this.maskSecrets(`[ERROR] ${e?.message || String(e)}`, sensitiveValues));
        result.status = 'error';
      }
    });

    Promise.all(promises).then(() => {
      job.status = job.results.every(r => r.status === 'success') ? 'success' : 'error';
    }).catch(() => {
      job.status = 'error';
    }).finally(async () => {
      const finishedAt = new Date().toISOString();
      await this.appendHistory({
        id: jobId,
        scriptId,
        scriptName: script.name,
        status: job.status as 'success' | 'error',
        startedAt,
        finishedAt,
        durationMs: new Date(finishedAt).getTime() - new Date(startedAt).getTime(),
        nodeResults: job.results.map(r => ({
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

  async executeSequence(
    scriptIds: string[],
    nodeIds: string[],
    variablesPerScript: Record<string, Record<string, string>>,
    variablesPerScriptPerNode?: Record<string, Record<string, Record<string, string>>>,
  ): Promise<{ jobId: string }> {
    if (!scriptIds.length) throw new Error('Список скриптов пуст');

    const scripts = await this.loadScripts();
    const resolvedScripts = scriptIds.map(id => {
      const s = scripts.find(sc => sc.id === id);
      if (!s) throw new Error(`Скрипт не найден: ${id}`);
      return s;
    });

    const nodes = await this.loadSshNodes();
    const targetNodes = nodes.filter(n => nodeIds.includes(n.id));
    if (!targetNodes.length) throw new Error('Не выбрано ни одной ноды');

    const sensitiveValues = [
      ...Object.values(variablesPerScript).flatMap(vars => Object.values(vars)),
      ...Object.values(variablesPerScriptPerNode || {})
        .flatMap(perNode => Object.values(perNode))
        .flatMap(vars => Object.values(vars)),
    ].filter(v => v.length > 3);

    const jobId = uuidv4();
    const startedAt = new Date().toISOString();
    const scriptName = resolvedScripts.map(s => s.name).join(' → ');
    const job: ScriptJob = {
      scriptName,
      status: 'running',
      results: targetNodes.map(n => ({
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
        const vars = variablesPerScriptPerNode?.[script.id]?.[node.id]
          ?? variablesPerScript[script.id]
          ?? {};
        const content = Object.keys(vars).length > 0
          ? this.substituteVariables(script.content, vars)
          : script.content;

        result.logs.push(`=== Скрипт ${i + 1}: ${script.name} ===`);

        try {
          await this.runScriptOnNode(node, content, result, sensitiveValues);
        } catch (e) {
          result.logs.push(this.maskSecrets(`[ERROR] ${e?.message || String(e)}`, sensitiveValues));
          result.status = 'error';
          return;
        }
      }
      result.status = 'success';
    });

    Promise.all(nodePromises).then(() => {
      job.status = job.results.every(r => r.status === 'success') ? 'success' : 'error';
    }).catch(() => {
      job.status = 'error';
    }).finally(async () => {
      const finishedAt = new Date().toISOString();
      await this.appendHistory({
        id: jobId,
        scriptId: scriptIds.join(','),
        scriptName,
        status: job.status as 'success' | 'error',
        startedAt,
        finishedAt,
        durationMs: new Date(finishedAt).getTime() - new Date(startedAt).getTime(),
        nodeResults: job.results.map(r => ({
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

  private runScriptOnNode(node: SshNode, content: string, result: NodeResult, mask: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const conn = new Client();

      conn.on('ready', () => {
        const useSudo = node.sshUser && node.sshUser !== 'root';
        result.logs.push(useSudo ? '[SSH] Подключено (sudo)' : '[SSH] Подключено');
        const cmd = useSudo
          ? `sudo bash -e << 'SCRIPT_EOF'\n${content}\nSCRIPT_EOF`
          : `bash -e << 'SCRIPT_EOF'\n${content}\nSCRIPT_EOF`;

        // Allocate a PTY so interactive programs (e.g. warp-cli) see a real terminal
        conn.exec(cmd, { pty: { term: 'xterm', cols: 200, rows: 50 } }, (err, stream) => {
          if (err) {
            result.logs.push(this.maskSecrets(`[ERROR] ${err.message}`, mask));
            conn.end();
            return reject(err);
          }

          stream.on('data', (data: Buffer) => {
            const text = this.stripAnsi(data.toString());
            // Auto-respond 'y' to common y/n confirmation prompts (e.g. ToS acceptance)
            if (/\[y\/n\]|\[Y\/N\]|\[yes\/no\]/i.test(text)) {
              stream.write('y\n');
              result.logs.push('[AUTO] Отправлен ответ "y" на запрос подтверждения');
            }
            text.split('\n').filter(l => l.trim())
              .forEach(l => result.logs.push(this.maskSecrets(l, mask)));
          });

          // With PTY, stderr is merged into stdout — keep handler for non-PTY compat
          stream.stderr.on('data', (data: Buffer) => {
            this.stripAnsi(data.toString()).split('\n').filter(Boolean)
              .forEach(l => result.logs.push(this.maskSecrets(`[stderr] ${l}`, mask)));
          });

          stream.on('close', (code: number) => {
            conn.end();
            if (code !== 0) return reject(new Error(`Скрипт завершился с кодом ${code}`));
            result.logs.push('[SSH] Выполнено успешно');
            resolve();
          });
        });
      });

      conn.on('error', (err) => {
        result.logs.push(this.maskSecrets(`[SSH] Ошибка подключения: ${err.message}`, mask));
        reject(err);
      });

      const connectOptions: any = {
        host: node.ip,
        port: node.sshPort || 22,
        username: node.sshUser || 'root',
        readyTimeout: 30000,
      };
      if (node.authType === 'key' && node.sshKey) {
        connectOptions.privateKey = node.sshKey;
      } else {
        connectOptions.password = node.password || '';
      }
      conn.connect(connectOptions);
    });
  }
}
