import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Client } from 'ssh2';
import { v4 as uuidv4 } from 'uuid';
import { Setting } from '../settings/entities/setting.entity';
import { RemnavaveService } from '../remnawave/remnawave.service';

export interface InstallNodeDto {
  name: string;
  ip: string;
  sshPort?: number;
  sshUser?: string;
  authType: 'password' | 'key';
  password?: string;
  sshKey?: string;
  profileUuid?: string;
  createNewProfile?: boolean;
  profileName?: string;
  countryCode?: string;
  nodePort?: number;
  enableOptimization?: boolean;
}

interface Job {
  status: 'running' | 'success' | 'error';
  logs: string[];
  nodeUuid?: string;
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

@Injectable()
export class NodesService {
  private readonly logger = new Logger(NodesService.name);
  private jobs = new Map<string, Job>();

  constructor(
    @InjectRepository(Setting)
    private settingRepo: Repository<Setting>,
    private remnavaveService: RemnavaveService,
  ) {}

  getJobStatus(jobId: string): { status: string; logs: string[]; nodeUuid?: string } | null {
    const job = this.jobs.get(jobId);
    if (!job) return null;
    return { status: job.status, logs: [...job.logs], nodeUuid: job.nodeUuid };
  }

  async startInstall(dto: InstallNodeDto): Promise<{ jobId: string; nodeUuid: string }> {
    const sshUser = dto.sshUser || 'root';
    const nodePort = dto.nodePort || 2222;
    const useSudo = sshUser !== 'root';

    const sudo = (cmd: string) => (useSudo ? `sudo ${cmd}` : cmd);

    let profileUuid = dto.profileUuid || '';

    if (dto.createNewProfile && dto.profileName) {
      const created = await this.remnavaveService.createConfigProfile(dto.profileName);
      profileUuid = created?.uuid || created?.response?.uuid || created;
      if (!profileUuid || typeof profileUuid !== 'string') {
        throw new Error('Не удалось получить UUID нового профиля');
      }
    }

    if (!profileUuid) throw new Error('UUID профиля не указан');

    const sslCert = await this.remnavaveService.getKeygenPubKey();

    const rwProfile = await this.remnavaveService.getConfigProfile(profileUuid);
    const inboundUuids: string[] = (rwProfile?.inbounds || [])
      .map((i: any) => i.uuid)
      .filter(Boolean);

    const nodeBody: any = {
      name: dto.name,
      address: dto.ip,
      port: nodePort,
      configProfile: {
        activeConfigProfileUuid: profileUuid,
        activeInbounds: inboundUuids,
      },
    };
    if (dto.countryCode) nodeBody.countryCode = dto.countryCode;

    const createdNode = await this.remnavaveService.createNode(nodeBody);
    const nodeUuid: string = createdNode?.uuid || createdNode?.response?.uuid || '';

    const jobId = uuidv4();
    const job: Job = { status: 'running', logs: [], nodeUuid };
    this.jobs.set(jobId, job);

    const composeContent = [
      `services:`,
      `  remnanode:`,
      `    container_name: remnanode`,
      `    hostname: remnanode`,
      `    image: remnawave/node:latest`,
      `    network_mode: host`,
      `    restart: always`,
      `    cap_add:`,
      `      - NET_ADMIN`,
      `    ulimits:`,
      `      nofile:`,
      `        soft: 1048576`,
      `        hard: 1048576`,
      `    environment:`,
      `      - NODE_PORT=${nodePort}`,
      `      - SECRET_KEY=${sslCert}`,
    ].join('\n');

    const commands: string[] = [
      sudo(`mkdir -p /opt/remnanode`),
      `curl -fsSL https://get.docker.com | ${useSudo ? 'sudo ' : ''}sh`,
      `${sudo(`tee /opt/remnanode/docker-compose.yml`)} << 'COMPOSE_EOF'\n${composeContent}\nCOMPOSE_EOF`,
      sudo(`systemctl enable --now docker`),
      `cd /opt/remnanode && ${sudo(`docker compose up -d`)}`,
    ];

    if (dto.enableOptimization) {
      commands.push(
        `${sudo(`tee /etc/sysctl.d/99-vpn.conf`)} << 'SYSCTL_EOF'\n${SYSCTL_CONTENT}\nSYSCTL_EOF`,
        sudo(`sysctl -p /etc/sysctl.d/99-vpn.conf`),
      );
    }

    this.runSsh(dto, sshUser, commands, job).catch((err) => {
      job.logs.push(`[FATAL] ${err?.message || String(err)}`);
      job.status = 'error';
    });

    return { jobId, nodeUuid };
  }

  private runSsh(dto: InstallNodeDto, sshUser: string, commands: string[], job: Job): Promise<void> {
    return new Promise((resolve, reject) => {
      const conn = new Client();

      conn.on('ready', () => {
        job.logs.push('[SSH] Подключено');
        this.runCommandsSequentially(conn, commands, job)
          .then(() => {
            job.status = 'success';
            job.logs.push('[SSH] Установка завершена успешно');
            conn.end();
            resolve();
          })
          .catch((err) => {
            job.status = 'error';
            job.logs.push(`[SSH] Ошибка: ${err?.message || String(err)}`);
            conn.end();
            reject(err);
          });
      });

      conn.on('error', (err) => {
        job.status = 'error';
        job.logs.push(`[SSH] Ошибка подключения: ${err?.message || String(err)}`);
        reject(err);
      });

      const connectOptions: any = {
        host: dto.ip,
        port: dto.sshPort || 22,
        username: sshUser,
        readyTimeout: 30000,
      };

      if (dto.authType === 'key' && dto.sshKey) {
        connectOptions.privateKey = dto.sshKey;
      } else {
        connectOptions.password = dto.password || '';
      }

      conn.connect(connectOptions);
    });
  }

  private runCommandsSequentially(conn: Client, commands: string[], job: Job): Promise<void> {
    return commands.reduce(
      (chain, cmd) => chain.then(() => this.execCommand(conn, cmd, job)),
      Promise.resolve(),
    );
  }

  private execCommand(conn: Client, cmd: string, job: Job): Promise<void> {
    return new Promise((resolve, reject) => {
      const displayCmd = cmd.length > 80 ? cmd.slice(0, 80) + '...' : cmd;
      job.logs.push(`$ ${displayCmd}`);

      conn.exec(cmd, (err, stream) => {
        if (err) {
          job.logs.push(`[ERROR] ${err.message}`);
          return reject(err);
        }

        stream.on('data', (data: Buffer) => {
          const lines = data.toString().split('\n').filter(Boolean);
          lines.forEach((l) => job.logs.push(l));
        });

        stream.stderr.on('data', (data: Buffer) => {
          const lines = data.toString().split('\n').filter(Boolean);
          lines.forEach((l) => job.logs.push(`[stderr] ${l}`));
        });

        stream.on('close', (code: number) => {
          if (code !== 0) {
            return reject(new Error(`Команда завершилась с кодом ${code}`));
          }
          resolve();
        });
      });
    });
  }
}
