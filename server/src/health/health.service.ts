import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Cron } from '@nestjs/schedule';
import { Repository } from 'typeorm';
import * as net from 'net';
import { Setting } from '../settings/entities/setting.entity';
import { TelegramService } from '../telegram/telegram.service';
import { ScriptsService } from '../scripts/scripts.service';

export interface NodeHealthStatus {
  nodeId: string;
  nodeName: string;
  ip: string;
  port: number;
  online: boolean;
  lastCheck: string;
  lastOnline: string | null;
}

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);
  private statusMap = new Map<string, NodeHealthStatus>();
  // Track last notification time per node to avoid spam (cooldown 30 min)
  private lastNotified = new Map<string, number>();

  constructor(
    @InjectRepository(Setting)
    private settingRepo: Repository<Setting>,
    private telegramService: TelegramService,
    private scriptsService: ScriptsService,
  ) {}

  private async getSettings(): Promise<{ enabled: boolean; intervalMin: number }> {
    const rows = await this.settingRepo.find({
      where: [
        { key: 'health_check_enabled' },
        { key: 'health_check_interval' },
      ],
    });
    const get = (k: string) => rows.find(r => r.key === k)?.value || '';
    return {
      enabled: get('health_check_enabled') === 'true',
      intervalMin: parseInt(get('health_check_interval') || '5', 10),
    };
  }

  private tcpPing(ip: string, port: number, timeoutMs = 5000): Promise<boolean> {
    return new Promise(resolve => {
      const socket = new net.Socket();
      socket.setTimeout(timeoutMs);
      socket.on('connect', () => { socket.destroy(); resolve(true); });
      socket.on('timeout', () => { socket.destroy(); resolve(false); });
      socket.on('error', () => resolve(false));
      socket.connect(port, ip);
    });
  }

  @Cron('* * * * *')
  async handleTick() {
    const { enabled, intervalMin } = await this.getSettings();
    if (!enabled) return;

    const now = Date.now();
    const lastRunKey = '_health_last_run';
    const lastRunEntry = await this.settingRepo.findOne({ where: { key: lastRunKey } });
    const lastRun = parseInt(lastRunEntry?.value || '0', 10);
    if (now - lastRun < intervalMin * 60 * 1000) return;
    await this.settingRepo.save({ key: lastRunKey, value: String(now) });

    const nodes = await this.scriptsService.getSshNodes();
    if (!nodes.length) return;

    const nowIso = new Date().toISOString();
    for (const node of nodes) {
      const online = await this.tcpPing(node.ip, node.sshPort || 22);
      const prev = this.statusMap.get(node.id);
      const status: NodeHealthStatus = {
        nodeId: node.id,
        nodeName: node.name,
        ip: node.ip,
        port: node.sshPort || 22,
        online,
        lastCheck: nowIso,
        lastOnline: online ? nowIso : (prev?.lastOnline ?? null),
      };
      this.statusMap.set(node.id, status);

      if (!online) {
        const lastNotif = this.lastNotified.get(node.id) || 0;
        const cooldown = 30 * 60 * 1000;
        if (now - lastNotif >= cooldown) {
          this.lastNotified.set(node.id, now);
          this.telegramService.sendMessage(
            `⚠️ <b>Нода недоступна</b>\n<b>${node.name}</b> (${node.ip}:${node.sshPort || 22})\nПоследняя проверка: ${nowIso}`,
          ).catch(() => {});
        }
      } else {
        this.lastNotified.delete(node.id);
      }
    }
  }

  getStatus(): NodeHealthStatus[] {
    return Array.from(this.statusMap.values());
  }
}
