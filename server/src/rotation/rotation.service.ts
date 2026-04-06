import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

import { Domain } from '../domains/entities/domain.entity';
import { Setting } from '../settings/entities/setting.entity';
import { RemnavaveService } from '../remnawave/remnawave.service';
import { InboundBuilderService } from '../inbounds/inbound-builder.service';
import { TelegramService } from '../telegram/telegram.service';

export interface RotationHistoryEntry {
  id: string;
  profileUuid: string;
  profileName: string;
  timestamp: number;
  status: 'success' | 'error';
  message: string;
}

export interface ManagedProfile {
  uuid: string;
  name: string;
  inboundsConfig: any[];
  excludedPorts: number[];
  nodeUuid: string;
  nodeAddress: string;
  applyToNode: boolean;
  hostMappings: { tag: string; hostUuid: string }[];
  hostTemplate: string;
  rotationEnabled: boolean;
  rotationMode: 'interval' | 'schedule' | 'days-of-week';
  rotationInterval: number;
  rotationScheduleTime: string;
  rotationTimezone: string;
  rotationScheduleDays?: number[];
  lastRotationTimestamp: number;
  lastRotationStatus: 'success' | 'error' | null;
  lastRotationError: string;
  profileDomains?: string[];
  hostIndexStart?: number;
}

@Injectable()
export class RotationService implements OnModuleInit {
  private readonly logger = new Logger(RotationService.name);

  constructor(
    @InjectRepository(Domain) private domainRepo: Repository<Domain>,
    @InjectRepository(Setting) private settingRepo: Repository<Setting>,
    private remnavaveService: RemnavaveService,
    private inboundBuilder: InboundBuilderService,
    private telegramService: TelegramService,
  ) {}

  async onModuleInit() {
    await this.initDefaultSettings();
  }

  private async initDefaultSettings() {
    const key = 'managed_profiles';
    let existing = await this.settingRepo.findOne({ where: { key } });
    if (!existing) {
      this.logger.log(`Инициализация настройки: ${key} = []`);
      await this.settingRepo.save(this.settingRepo.create({ key, value: '[]' }));
      existing = await this.settingRepo.findOne({ where: { key } });
    }

    // Миграция: если managed_profiles == '[]' и remnawave_profile_uuid задан
    if (existing?.value === '[]') {
      const profileUuidSetting = await this.settingRepo.findOne({ where: { key: 'remnawave_profile_uuid' } });
      if (profileUuidSetting?.value) {
        const getKey = async (k: string): Promise<string> => {
          const s = await this.settingRepo.findOne({ where: { key: k } });
          return s?.value || '';
        };

        let inboundsConfig: any[] = [];
        try {
          inboundsConfig = JSON.parse((await getKey('inbounds_config')) || '[]');
        } catch { /* ignore */ }

        let hostMappings: { tag: string; hostUuid: string }[] = [];
        try {
          const oldMappings = JSON.parse((await getKey('host_mappings')) || '[]');
          if (oldMappings.length > 0 && inboundsConfig.length > 0) {
            hostMappings = oldMappings
              .filter((m: any) => m.inboundIndex !== undefined && inboundsConfig[m.inboundIndex])
              .map((m: any) => ({
                tag: `${inboundsConfig[m.inboundIndex].type}-rwm`,
                hostUuid: m.hostUuid,
              }));
          }
        } catch { /* ignore */ }

        const migrated: ManagedProfile = {
          uuid: profileUuidSetting.value,
          name: 'Default',
          inboundsConfig,
          excludedPorts: [],
          nodeUuid: await getKey('remnawave_node_uuid'),
          nodeAddress: await getKey('remnawave_node_address'),
          applyToNode: false,
          hostMappings,
          hostTemplate: '{countryCode} {nodeName} - {inboundType}',
          rotationEnabled: true,
          rotationMode: 'interval',
          rotationInterval: 1440,
          rotationScheduleTime: '03:00',
          rotationTimezone: 'Europe/Moscow',
          lastRotationTimestamp: 0,
          lastRotationStatus: null,
          lastRotationError: '',
        };

        await this.saveSetting('managed_profiles', JSON.stringify([migrated]));
        this.logger.log(`Миграция: создан профиль Default из старых настроек (uuid=${migrated.uuid})`);
      }
    } else {
      // Миграция: добавить tagSuffix к инбаундам без него
      let profiles: ManagedProfile[];
      try {
        profiles = JSON.parse(existing?.value || '[]');
      } catch {
        profiles = [];
      }
      let migrated = false;
      for (const p of profiles) {
        for (const cfg of p.inboundsConfig || []) {
          if (!cfg.tagSuffix && cfg.type && cfg.type !== 'custom') {
            cfg.tagSuffix = Math.random().toString(16).slice(2, 8);
            migrated = true;
          }
        }
      }
      if (migrated) {
        await this.saveSetting('managed_profiles', JSON.stringify(profiles));
        this.logger.log('Миграция: добавлен tagSuffix для инбаундов без суффикса');
      }
      const count = profiles.length;
      this.logger.log(`Текущее количество managed_profiles: ${count}`);
    }
  }

  private async saveSetting(key: string, value: string) {
    let s = await this.settingRepo.findOne({ where: { key } });
    if (!s) s = this.settingRepo.create({ key });
    s.value = value;
    await this.settingRepo.save(s);
  }

  async loadProfiles(): Promise<ManagedProfile[]> {
    const raw = await this.settingRepo.findOne({ where: { key: 'managed_profiles' } });
    try {
      return JSON.parse(raw?.value || '[]');
    } catch {
      return [];
    }
  }

  async saveProfiles(profiles: ManagedProfile[]): Promise<void> {
    await this.saveSetting('managed_profiles', JSON.stringify(profiles));
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async handleTicker() {
    const profiles = await this.loadProfiles();
    if (!profiles.length) return;

    let updated = false;
    const updatedProfiles = [...profiles];

    for (let i = 0; i < profiles.length; i++) {
      const p = profiles[i];
      if (!p.rotationEnabled) continue;
      if (!this.isDue(p)) continue;

      const globalUsedPorts = new Set<number>(
        profiles
          .filter((_, j) => j !== i)
          .flatMap(other => (other.inboundsConfig || []).map((c: any) => c.port).filter(Number.isInteger)),
      );
      const result = await this.performRotation(p, globalUsedPorts);
      updatedProfiles[i] = {
        ...p,
        lastRotationTimestamp: result.success ? Date.now() : p.lastRotationTimestamp,
        lastRotationStatus: result.success ? 'success' : 'error',
        lastRotationError: result.success ? '' : result.message,
      };
      updated = true;
    }

    if (updated) await this.saveProfiles(updatedProfiles);
  }

  private isDue(p: ManagedProfile): boolean {
    if (p.rotationMode === 'interval') {
      const diffMin = (Date.now() - (p.lastRotationTimestamp || 0)) / 60000;
      return diffMin >= (p.rotationInterval || 1440);
    } else if (p.rotationMode === 'days-of-week') {
      return this.isDaysOfWeekDue(p);
    } else {
      return this.isScheduleDue(p);
    }
  }

  private isScheduleDue(p: ManagedProfile): boolean {
    const now = new Date();
    const tz = p.rotationTimezone || 'Europe/Moscow';
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      hour: '2-digit', minute: '2-digit', hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(now);
    const get = (t: string) => parts.find(x => x.type === t)?.value || '';
    const currentTime = `${get('hour')}:${get('minute')}`;
    const currentDate = `${get('year')}-${get('month')}-${get('day')}`;
    if (currentTime !== p.rotationScheduleTime) return false;
    if (!p.lastRotationTimestamp) return true;
    const lastDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date(p.lastRotationTimestamp));
    return lastDate !== currentDate;
  }

  private isDaysOfWeekDue(p: ManagedProfile): boolean {
    if (!p.rotationScheduleDays?.length) return false;
    const now = new Date();
    const tz = p.rotationTimezone || 'Europe/Moscow';
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      hour: '2-digit', minute: '2-digit', hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(now);
    const get = (t: string) => parts.find(x => x.type === t)?.value || '';
    const currentTime = `${get('hour')}:${get('minute')}`;
    const currentDate = `${get('year')}-${get('month')}-${get('day')}`;
    const currentDayOfWeek = new Date(Date.UTC(
      parseInt(get('year')), parseInt(get('month')) - 1, parseInt(get('day')),
    )).getUTCDay();
    if (!p.rotationScheduleDays.includes(currentDayOfWeek)) return false;
    if (currentTime !== p.rotationScheduleTime) return false;
    if (!p.lastRotationTimestamp) return true;
    const lastDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date(p.lastRotationTimestamp));
    return lastDate !== currentDate;
  }

  async rotateAllProfiles(): Promise<{ success: boolean; message: string }> {
    const profiles = await this.loadProfiles();
    let successCount = 0;
    const updated = [...profiles];

    for (let i = 0; i < profiles.length; i++) {
      if (!profiles[i].rotationEnabled) continue;
      const result = await this.performRotation(profiles[i]);
      updated[i] = {
        ...profiles[i],
        lastRotationTimestamp: result.success ? Date.now() : profiles[i].lastRotationTimestamp,
        lastRotationStatus: result.success ? 'success' : 'error',
        lastRotationError: result.success ? '' : result.message,
      };
      if (result.success) successCount++;
    }

    await this.saveProfiles(updated);
    return { success: true, message: `Ротация выполнена: ${successCount}/${profiles.length}` };
  }

  async performRotation(profile: ManagedProfile, globalUsedPorts?: Set<number>): Promise<{ success: boolean; message: string }> {
    try {
      this.logger.log(`Запуск ротации профиля: ${profile.name} (${profile.uuid})`);

      if (!profile.uuid) {
        return { success: false, message: 'Не задан UUID профиля' };
      }
      if (!profile.inboundsConfig || profile.inboundsConfig.length === 0) {
        return { success: false, message: 'Список инбаундов пуст' };
      }

      let keys: { publicKey: string; privateKey: string };
      try {
        keys = await this.remnavaveService.getX25519Keys();
      } catch {
        return { success: false, message: 'Ошибка получения X25519 ключей' };
      }

      let domains: { name: string }[];
      if (profile.profileDomains && profile.profileDomains.length > 0) {
        domains = profile.profileDomains.map(name => ({ name }));
      } else {
        domains = await this.domainRepo.find({ where: { isEnabled: true } });
      }
      const generatedInbounds: any[] = [];
      const usedPorts = new Set<number>(globalUsedPorts || []);
      const excludedPorts = new Set<number>(profile.excludedPorts || []);
      const rotNonce = Date.now().toString(36);

      for (const config of profile.inboundsConfig) {
        const type = config.type;
        if (type === 'custom') continue;

        const uuid = uuidv4();
        let port: number;
        if (!config.port || config.port === 'random') {
          port = this.getRandomPort(usedPorts, excludedPorts);
        } else {
          port = typeof config.port === 'string' ? parseInt(config.port, 10) : config.port;
        }
        usedPorts.add(port);

        const sni = config.sni === 'random' ? this.pickDomain(domains) : (config.sni || '');

        let inbound: any;
        switch (type) {
          case 'vless-tcp-reality':
            inbound = this.inboundBuilder.buildVlessRealityTcp({ port, uuid, sni, ...keys });
            break;
          case 'vless-xhttp-reality':
            inbound = this.inboundBuilder.buildVlessRealityXhttp({ port, uuid, sni, ...keys });
            break;
          case 'vless-grpc-reality':
            inbound = this.inboundBuilder.buildVlessRealityGrpc({ port, uuid, sni, ...keys });
            break;
          case 'vless-ws':
            inbound = this.inboundBuilder.buildVlessWs({ port, uuid, sni, security: config.security });
            break;
          case 'shadowsocks-tcp':
            inbound = this.inboundBuilder.buildShadowsocksTcp({ port, uuid });
            break;
          case 'trojan-tcp-reality':
            inbound = this.inboundBuilder.buildTrojanRealityTcp({ port, uuid, sni, ...keys });
            break;
          case 'vmess-tcp':
            inbound = this.inboundBuilder.buildVmessTcp({ port, uuid });
            break;
          default:
            this.logger.warn(`Неизвестный тип инбаунда: ${type}`);
            continue;
        }

        if (inbound) {
          if (config.tag) {
            inbound.tag = config.tag;
          }
          if (config.tagSuffix) {
            inbound.tag = `${inbound.tag}-${config.tagSuffix}`;
          }
          const baseTag: string = inbound.tag;
          const sameTagCount = generatedInbounds.filter(
            (i: any) => i.tag === baseTag || i.tag?.startsWith(`${baseTag}-`),
          ).length;
          if (sameTagCount > 0) {
            inbound.tag = `${baseTag}-${sameTagCount + 1}`;
          }
          generatedInbounds.push(inbound);
        }
      }

      let currentProfile: any;
      try {
        currentProfile = await this.remnavaveService.getConfigProfile(profile.uuid);
      } catch {
        return { success: false, message: 'Ошибка получения профиля из Remnawave' };
      }

      const mergedConfig = {
        ...(currentProfile?.config || {}),
        inbounds: generatedInbounds,
        outbounds: [
          { tag: 'DIRECT', protocol: 'freedom' },
          { tag: 'BLOCK', protocol: 'blackhole' },
        ],
        routing: {
          rules: [
            { type: 'field', ip: ['geoip:private'], outboundTag: 'BLOCK' },
            { type: 'field', domain: ['geosite:private'], outboundTag: 'BLOCK' },
            { type: 'field', protocol: ['bittorrent'], outboundTag: 'BLOCK' },
          ],
        },
      };

      let updatedProfile: any;
      try {
        updatedProfile = await this.remnavaveService.updateConfigProfile(profile.uuid, mergedConfig);
      } catch (e) {
        return { success: false, message: `Ошибка обновления профиля: ${e?.message}` };
      }

      const updatedInbounds = updatedProfile?.inbounds || [];
      await this.syncHosts(profile.uuid, updatedInbounds, profile);

      if (profile.applyToNode && profile.nodeUuid && updatedInbounds.length > 0) {
        try {
          const inboundUuids = updatedInbounds.map((i: any) => i.uuid).filter(Boolean);
          if (inboundUuids.length > 0) {
            await this.remnavaveService.applyProfileToNode(profile.nodeUuid, profile.uuid, inboundUuids);
          }
        } catch (e) {
          this.logger.warn(`applyProfileToNode failed: ${e?.message}`);
        }
      }

      this.logger.log(`Ротация профиля ${profile.name} завершена. Инбаундов: ${generatedInbounds.length}`);
      const successMsg = `Ротация выполнена: ${generatedInbounds.length} инбаундов обновлено`;
      await this.appendHistory({ id: uuidv4(), profileUuid: profile.uuid, profileName: profile.name, timestamp: Date.now(), status: 'success', message: successMsg });
      await this.telegramService.notifyRotation(profile.name, 'success', successMsg);
      return { success: true, message: successMsg };
    } catch (e) {
      const errMsg = e?.message || String(e);
      await this.appendHistory({ id: uuidv4(), profileUuid: profile.uuid, profileName: profile.name, timestamp: Date.now(), status: 'error', message: errMsg }).catch(() => {});
      await this.telegramService.notifyRotation(profile.name, 'error', errMsg).catch(() => {});
      return { success: false, message: errMsg };
    }
  }

  private async syncHosts(profileUuid: string, updatedInbounds: any[], profile: ManagedProfile) {
    if (!profile.hostMappings || profile.hostMappings.length === 0) {
      this.logger.warn('syncHosts: hostMappings пуст — пропускаем');
      return;
    }

    let updatedCount = 0;
    for (const mapping of profile.hostMappings) {
      const { hostUuid } = mapping;
      const tag = (mapping as any).tag as string | undefined;
      const legacyType = (mapping as any).inboundType as string | undefined;

      const inbound = tag
        ? updatedInbounds.find((i: any) => i.tag === tag)
        : updatedInbounds.find((i: any) => i.tag?.startsWith(legacyType));

      if (!inbound) {
        this.logger.warn(`syncHosts: инбаунд ${tag || legacyType} не найден — пропускаем`);
        continue;
      }

      const port = inbound.port ?? inbound.rawInbound?.port;
      try {
        await this.remnavaveService.updateHost(hostUuid, {
          inbound: { configProfileUuid: profileUuid, configProfileInboundUuid: inbound.uuid },
          port,
          address: profile.nodeAddress,
          nodes: [profile.nodeUuid],
        });
        updatedCount++;
      } catch (e) {
        this.logger.error(`syncHosts: ошибка обновления хоста ${hostUuid}: ${e?.message}`);
      }
    }

    this.logger.log(`syncHosts: обновлено ${updatedCount} хостов`);
  }

  private pickDomain(list: { name: string }[]): string {
    if (list.length === 0) return '';
    return list[Math.floor(Math.random() * list.length)].name;
  }

  private getRandomPort(usedPorts: Set<number>, excludedPorts: Set<number> = new Set()): number {
    let port: number;
    do {
      port = Math.floor(Math.random() * (60000 - 10000)) + 10000;
    } while (usedPorts.has(port) || excludedPorts.has(port));
    return port;
  }

  async getHistory(): Promise<RotationHistoryEntry[]> {
    const raw = await this.settingRepo.findOne({ where: { key: 'rotation_history' } });
    try {
      return JSON.parse(raw?.value || '[]');
    } catch {
      return [];
    }
  }

  private async appendHistory(entry: RotationHistoryEntry): Promise<void> {
    const history = await this.getHistory();
    history.unshift(entry);
    if (history.length > 100) history.length = 100;
    await this.saveSetting('rotation_history', JSON.stringify(history));
  }
}
