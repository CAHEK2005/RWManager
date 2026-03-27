import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

import { Domain } from '../domains/entities/domain.entity';
import { Setting } from '../settings/entities/setting.entity';
import { RemnavaveService } from '../remnawave/remnawave.service';
import { InboundBuilderService } from '../inbounds/inbound-builder.service';

@Injectable()
export class RotationService implements OnModuleInit {
  private readonly logger = new Logger(RotationService.name);

  constructor(
    @InjectRepository(Domain) private domainRepo: Repository<Domain>,
    @InjectRepository(Setting) private settingRepo: Repository<Setting>,
    private remnavaveService: RemnavaveService,
    private inboundBuilder: InboundBuilderService,
  ) {}

  async onModuleInit() {
    await this.initDefaultSettings();
  }

  private async initDefaultSettings() {
    const key = 'rotation_status';
    const existing = await this.settingRepo.findOne({ where: { key } });
    if (!existing) {
      this.logger.log(`Инициализация настройки: ${key} = active`);
      await this.settingRepo.save(this.settingRepo.create({ key, value: 'active' }));
    } else {
      this.logger.log(`Текущий статус ротации: ${existing.value}`);
    }
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async handleTicker() {
    const intervalSetting = await this.settingRepo.findOne({ where: { key: 'rotation_interval' } });
    const intervalMinutes = intervalSetting ? parseInt(intervalSetting.value, 10) : 30;

    const lastRunSetting = await this.settingRepo.findOne({ where: { key: 'last_rotation_timestamp' } });
    const lastRun = lastRunSetting ? parseInt(lastRunSetting.value, 10) : 0;

    const now = Date.now();
    const diffMinutes = (now - lastRun) / 1000 / 60;

    const statusSetting = await this.settingRepo.findOne({ where: { key: 'rotation_status' } });
    const isStopped = statusSetting?.value === 'stopped';

    if (diffMinutes < intervalMinutes || isStopped) return;

    const result = await this.performRotation();
    if (result.success) {
      await this.saveSetting('last_rotation_timestamp', now.toString());
    }
  }

  private async saveSetting(key: string, value: string) {
    let s = await this.settingRepo.findOne({ where: { key } });
    if (!s) s = this.settingRepo.create({ key });
    s.value = value;
    await this.settingRepo.save(s);
  }

  async performRotation() {
    this.logger.log('Запуск ротации...');

    const profileUuidSetting = await this.settingRepo.findOne({ where: { key: 'remnawave_profile_uuid' } });
    if (!profileUuidSetting?.value) {
      this.logger.error('Не задан remnawave_profile_uuid');
      return { success: false, message: 'Не задан UUID профиля Remnawave' };
    }
    const profileUuid = profileUuidSetting.value;

    const inboundsConfigSetting = await this.settingRepo.findOne({ where: { key: 'inbounds_config' } });
    let inboundsConfig: any[] = [];
    if (inboundsConfigSetting?.value) {
      try {
        inboundsConfig = JSON.parse(inboundsConfigSetting.value);
      } catch {
        this.logger.error('Ошибка парсинга inbounds_config');
        return { success: false, message: 'Неверный формат inbounds_config' };
      }
    }

    if (inboundsConfig.length === 0) {
      return { success: false, message: 'Список инбаундов пуст' };
    }

    let keys: { publicKey: string; privateKey: string };
    try {
      keys = await this.remnavaveService.getX25519Keys();
    } catch (e) {
      this.logger.error('Не удалось получить X25519 ключи', e);
      return { success: false, message: 'Ошибка получения X25519 ключей' };
    }

    const domains = await this.domainRepo.find({ where: { isEnabled: true } });
    const generatedInbounds: any[] = [];
    const usedPorts = new Set<number>();

    for (const config of inboundsConfig) {
      const type = config.type;
      if (type === 'custom') continue;

      const uuid = uuidv4();

      let port: number;
      if (!config.port || config.port === 'random') {
        port = this.getRandomPort(usedPorts);
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
          inbound = this.inboundBuilder.buildVlessWs({ port, uuid, sni });
          break;
        case 'shadowsocks-tcp':
          inbound = this.inboundBuilder.buildShadowsocksTcp({ port, uuid });
          break;
        case 'trojan-tcp-reality':
          inbound = this.inboundBuilder.buildTrojanRealityTcp({ port, uuid, sni, ...keys });
          break;
        default:
          this.logger.warn(`Неизвестный тип инбаунда: ${type}`);
          continue;
      }

      if (inbound) generatedInbounds.push(inbound);
    }

    let currentProfile: any;
    try {
      currentProfile = await this.remnavaveService.getConfigProfile(profileUuid);
    } catch (e) {
      this.logger.error('Не удалось получить профиль', e);
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
      updatedProfile = await this.remnavaveService.updateConfigProfile(profileUuid, mergedConfig);
    } catch (e) {
      this.logger.error('Не удалось обновить профиль', e);
      return { success: false, message: `Ошибка обновления профиля: ${e.message}` };
    }

    await this.syncHosts(profileUuid, updatedProfile?.inbounds || []);

    await this.saveSetting('last_rotation_timestamp', Date.now().toString());

    this.logger.log(`Ротация завершена. Обновлено ${generatedInbounds.length} инбаундов.`);
    return { success: true, message: `Ротация выполнена: ${generatedInbounds.length} инбаундов обновлено` };
  }

  private async syncHosts(profileUuid: string, updatedInbounds: any[]) {
    const mappingsSetting = await this.settingRepo.findOne({ where: { key: 'host_mappings' } });
    const nodeAddressSetting = await this.settingRepo.findOne({ where: { key: 'remnawave_node_address' } });
    const nodeUuidSetting = await this.settingRepo.findOne({ where: { key: 'remnawave_node_uuid' } });

    if (!mappingsSetting?.value || !nodeAddressSetting?.value || !nodeUuidSetting?.value) {
      this.logger.warn('syncHosts: маппинг хостов или нода не настроены — пропускаем синхронизацию хостов');
      return;
    }

    let mappings: { inboundIndex: number; hostUuid: string }[] = [];
    try {
      mappings = JSON.parse(mappingsSetting.value);
    } catch {
      this.logger.warn('syncHosts: не удалось распарсить host_mappings');
      return;
    }

    if (mappings.length === 0) {
      this.logger.warn('syncHosts: host_mappings пуст — пропускаем');
      return;
    }

    const nodeAddress = nodeAddressSetting.value;
    const nodeUuid = nodeUuidSetting.value;
    let updatedCount = 0;

    for (const { inboundIndex, hostUuid } of mappings) {
      const inbound = updatedInbounds[inboundIndex];
      if (!inbound) {
        this.logger.warn(`syncHosts: инбаунд с индексом ${inboundIndex} не найден — пропускаем`);
        continue;
      }

      const port = inbound.port ?? inbound.rawInbound?.port;
      this.logger.debug(`syncHosts: хост ${hostUuid} → inbound[${inboundIndex}] uuid=${inbound.uuid} port=${port}`);
      try {
        await this.remnavaveService.updateHost(hostUuid, {
          inbound: { configProfileUuid: profileUuid, configProfileInboundUuid: inbound.uuid },
          port,
          address: nodeAddress,
          nodes: [nodeUuid],
        });
        updatedCount++;
      } catch (e) {
        this.logger.error(`syncHosts: ошибка обновления хоста ${hostUuid}: ${e.message}`);
      }
    }

    this.logger.log(`syncHosts: обновлено ${updatedCount} хостов`);
  }

  private pickDomain(list: Domain[]): string {
    if (list.length === 0) return '';
    return list[Math.floor(Math.random() * list.length)].name;
  }

  private getRandomPort(usedPorts: Set<number>): number {
    let port: number;
    do {
      port = Math.floor(Math.random() * (60000 - 10000)) + 10000;
    } while (usedPorts.has(port));
    return port;
  }
}
