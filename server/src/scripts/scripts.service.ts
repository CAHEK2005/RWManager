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
}

export interface Script {
  id: string;
  name: string;
  description?: string;
  content: string;
  isBuiltIn: boolean;
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
    content: `cd /opt/remnanode && docker compose pull && docker compose up -d`,
  },
  {
    id: 'builtin-restart-node',
    name: 'Перезапуск ноды',
    description: 'Перезапускает Docker-контейнер Remnawave Node',
    isBuiltIn: true,
    content: `cd /opt/remnanode && docker compose restart`,
  },
  {
    id: 'builtin-status-node',
    name: 'Статус ноды',
    description: 'Показывает статус контейнера и последние 30 строк логов',
    isBuiltIn: true,
    content: `cd /opt/remnanode && docker compose ps && echo "--- Logs ---" && docker compose logs --tail=30`,
  },
  {
    id: 'builtin-setup-ssh-key',
    name: 'Настройка SSH-ключа',
    description: 'Добавляет публичный SSH-ключ и отключает вход по паролю. Перед запуском потребуется ввести публичный ключ.',
    isBuiltIn: true,
    content: `PUBLIC_KEY="{{ ssh_public_key | Публичный SSH-ключ (ssh-ed25519 AAAA... или ssh-rsa AAAA...) }}"

mkdir -p ~/.ssh
chmod 700 ~/.ssh
grep -qxF "$PUBLIC_KEY" ~/.ssh/authorized_keys 2>/dev/null || echo "$PUBLIC_KEY" >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys

sed -i 's/^#*[[:space:]]*PubkeyAuthentication.*/PubkeyAuthentication yes/' /etc/ssh/sshd_config
sed -i 's/^#*[[:space:]]*PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
grep -q '^PubkeyAuthentication' /etc/ssh/sshd_config   || echo 'PubkeyAuthentication yes'  >> /etc/ssh/sshd_config
grep -q '^PasswordAuthentication' /etc/ssh/sshd_config || echo 'PasswordAuthentication no' >> /etc/ssh/sshd_config

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
      } else if (
        scripts[idx].content !== builtin.content ||
        scripts[idx].name !== builtin.name ||
        scripts[idx].description !== builtin.description
      ) {
        scripts[idx] = builtin; // обновляем встроенные скрипты до актуальной версии
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
    return this.loadScripts();
  }

  async upsertScript(script: Omit<Script, 'id' | 'isBuiltIn'> & { id?: string }): Promise<Script> {
    const scripts = await this.loadScripts();
    const id = script.id || uuidv4();
    const saved: Script = { ...script, id, isBuiltIn: false };
    const idx = scripts.findIndex(s => s.id === id);
    if (idx >= 0) {
      if (scripts[idx].isBuiltIn) throw new Error('Встроенные скрипты нельзя изменять');
      scripts[idx] = saved;
    } else {
      scripts.push(saved);
    }
    await this.saveSetting('scripts', JSON.stringify(scripts));
    return saved;
  }

  async deleteScript(id: string): Promise<void> {
    const scripts = await this.loadScripts();
    const script = scripts.find(s => s.id === id);
    if (script?.isBuiltIn) throw new Error('Встроенные скрипты нельзя удалять');
    await this.saveSetting('scripts', JSON.stringify(scripts.filter(s => s.id !== id)));
  }

  // ── Execute ──────────────────────────────────────────────────────────────────

  async executeScript(
    scriptId: string,
    nodeIds: string[],
    variables?: Record<string, string>,
  ): Promise<{ jobId: string }> {
    const scripts = await this.loadScripts();
    const script = scripts.find(s => s.id === scriptId);
    if (!script) throw new Error('Скрипт не найден');

    const nodes = await this.loadSshNodes();
    const targetNodes = nodes.filter(n => nodeIds.includes(n.id));
    if (!targetNodes.length) throw new Error('Не выбрано ни одной ноды');

    const content = variables && Object.keys(variables).length > 0
      ? this.substituteVariables(script.content, variables)
      : script.content;

    const jobId = uuidv4();
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
      try {
        await this.runScriptOnNode(node, content, result);
        result.status = 'success';
      } catch (e) {
        result.logs.push(`[ERROR] ${e?.message || String(e)}`);
        result.status = 'error';
      }
    });

    Promise.all(promises).then(() => {
      job.status = job.results.every(r => r.status === 'success') ? 'success' : 'error';
    }).catch(() => {
      job.status = 'error';
    });

    return { jobId };
  }

  getJobStatus(jobId: string): ScriptJob | null {
    return this.jobs.get(jobId) || null;
  }

  private runScriptOnNode(node: SshNode, content: string, result: NodeResult): Promise<void> {
    return new Promise((resolve, reject) => {
      const conn = new Client();

      conn.on('ready', () => {
        const useSudo = node.sshUser && node.sshUser !== 'root';
        result.logs.push(useSudo ? '[SSH] Подключено (sudo)' : '[SSH] Подключено');
        const cmd = useSudo
          ? `sudo bash -e << 'SCRIPT_EOF'\n${content}\nSCRIPT_EOF`
          : `bash -e << 'SCRIPT_EOF'\n${content}\nSCRIPT_EOF`;
        conn.exec(cmd, (err, stream) => {
          if (err) {
            result.logs.push(`[ERROR] ${err.message}`);
            conn.end();
            return reject(err);
          }

          stream.on('data', (data: Buffer) => {
            data.toString().split('\n').filter(Boolean).forEach(l => result.logs.push(l));
          });

          stream.stderr.on('data', (data: Buffer) => {
            data.toString().split('\n').filter(Boolean).forEach(l => result.logs.push(`[stderr] ${l}`));
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
        result.logs.push(`[SSH] Ошибка подключения: ${err.message}`);
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
