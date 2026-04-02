import {
  Controller, Get, Post, Body, Patch, Delete, Param, Query,
  HttpException, HttpStatus, Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Setting } from './entities/setting.entity';
import * as net from 'net';
import * as dns from 'dns/promises';
import { COUNTRIES } from './countries';
import { RemnavaveService } from '../remnawave/remnawave.service';
import { RotationService, ManagedProfile } from '../rotation/rotation.service';
import { TelegramService } from '../telegram/telegram.service';

@Controller('settings')
export class SettingsController {
  private readonly logger = new Logger(SettingsController.name);

  constructor(
    @InjectRepository(Setting)
    private settingsRepo: Repository<Setting>,
    private remnavaveService: RemnavaveService,
    private rotationService: RotationService,
    private telegramService: TelegramService,
  ) {}

  @Get()
  async findAll() {
    const settings = await this.settingsRepo.find();
    return settings.reduce((acc, curr) => ({ ...acc, [curr.key]: curr.value }), {});
  }

  @Get('profiles')
  async getProfiles() {
    this.logger.log('GET /profiles запрос');
    try {
      const profiles = await this.remnavaveService.getConfigProfiles();
      this.logger.log(`Получено профилей: ${profiles.length}`);
      return profiles;
    } catch (e) {
      this.logger.error(`Ошибка загрузки профилей: ${e.message}`);
      throw new HttpException(e.message, HttpStatus.BAD_REQUEST);
    }
  }

  @Get('profiles/managed')
  async getManagedProfiles() {
    return this.rotationService.loadProfiles();
  }

  @Post('profiles/managed')
  async addManagedProfile(@Body() body: { uuid?: string; name: string; createNew?: boolean }) {
    const profiles = await this.rotationService.loadProfiles();

    let profileUuid = body.uuid;

    if (body.createNew) {
      try {
        const created = await this.remnavaveService.createConfigProfile(body.name);
        profileUuid = created?.uuid || created?.response?.uuid || created;
        if (!profileUuid || typeof profileUuid !== 'string') {
          throw new HttpException('Не удалось получить UUID нового профиля', HttpStatus.BAD_REQUEST);
        }
      } catch (e) {
        if (e instanceof HttpException) throw e;
        throw new HttpException(`Ошибка создания профиля в Remnawave: ${e.message}`, HttpStatus.BAD_REQUEST);
      }
    }

    if (!profileUuid) throw new HttpException('UUID профиля не указан', HttpStatus.BAD_REQUEST);
    if (profiles.find(p => p.uuid === profileUuid)) {
      throw new HttpException('Профиль уже добавлен', HttpStatus.CONFLICT);
    }

    const newProfile: ManagedProfile = {
      uuid: profileUuid,
      name: body.name,
      inboundsConfig: [],
      excludedPorts: [],
      nodeUuid: '',
      nodeAddress: '',
      applyToNode: false,
      hostMappings: [],
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

    profiles.push(newProfile);
    await this.rotationService.saveProfiles(profiles);
    return newProfile;
  }

  @Patch('profiles/managed/:uuid/name')
  async renameManagedProfile(@Param('uuid') uuid: string, @Body() body: { name: string }) {
    const profiles = await this.rotationService.loadProfiles();
    const idx = profiles.findIndex(p => p.uuid === uuid);
    if (idx === -1) throw new HttpException('Профиль не найден', HttpStatus.NOT_FOUND);

    profiles[idx] = { ...profiles[idx], name: body.name };

    try {
      await this.remnavaveService.renameConfigProfile(uuid, body.name);
    } catch (e) {
      this.logger.warn(`Не удалось переименовать профиль в Remnawave: ${e.message}`);
    }

    await this.rotationService.saveProfiles(profiles);
    return profiles[idx];
  }

  @Patch('profiles/managed/:uuid')
  async updateManagedProfile(@Param('uuid') uuid: string, @Body() body: Partial<ManagedProfile>) {
    const profiles = await this.rotationService.loadProfiles();
    const idx = profiles.findIndex(p => p.uuid === uuid);
    if (idx === -1) throw new HttpException('Профиль не найден', HttpStatus.NOT_FOUND);

    profiles[idx] = { ...profiles[idx], ...body, uuid };
    await this.rotationService.saveProfiles(profiles);
    return profiles[idx];
  }

  @Delete('profiles/managed/:uuid')
  async deleteManagedProfile(
    @Param('uuid') uuid: string,
    @Query('deleteFromRemnawave') deleteFromRemnawave?: string,
  ) {
    const profiles = await this.rotationService.loadProfiles();
    const idx = profiles.findIndex(p => p.uuid === uuid);
    if (idx === -1) throw new HttpException('Профиль не найден', HttpStatus.NOT_FOUND);

    if (deleteFromRemnawave === 'true') {
      try {
        await this.remnavaveService.deleteConfigProfile(uuid);
      } catch (e) {
        this.logger.warn(`Не удалось удалить профиль из Remnawave: ${e.message}`);
      }
    }

    profiles.splice(idx, 1);
    await this.rotationService.saveProfiles(profiles);
    return { success: true };
  }

  @Post('profiles/managed/:uuid/rotate')
  async rotateProfile(@Param('uuid') uuid: string) {
    const profiles = await this.rotationService.loadProfiles();
    const idx = profiles.findIndex(p => p.uuid === uuid);
    if (idx === -1) throw new HttpException('Профиль не найден', HttpStatus.NOT_FOUND);

    const result = await this.rotationService.performRotation(profiles[idx]);

    profiles[idx] = {
      ...profiles[idx],
      lastRotationTimestamp: result.success ? Date.now() : profiles[idx].lastRotationTimestamp,
      lastRotationStatus: result.success ? 'success' : 'error',
      lastRotationError: result.success ? '' : result.message,
    };
    await this.rotationService.saveProfiles(profiles);
    return result;
  }

  @Post('profiles/managed/:uuid/hosts/create')
  async createHostsForProfile(@Param('uuid') uuid: string) {
    const profiles = await this.rotationService.loadProfiles();
    const idx = profiles.findIndex(p => p.uuid === uuid);
    if (idx === -1) throw new HttpException('Профиль не найден', HttpStatus.NOT_FOUND);

    const profile = profiles[idx];

    let rwProfile: any;
    try {
      rwProfile = await this.remnavaveService.getConfigProfile(uuid);
    } catch (e) {
      throw new HttpException('Ошибка получения профиля из Remnawave', HttpStatus.BAD_REQUEST);
    }

    const configInbounds: any[] = rwProfile?.config?.inbounds || [];
    const rwInbounds: any[] = rwProfile?.inbounds || [];

    if (configInbounds.length === 0) {
      throw new HttpException('Сначала запустите ротацию для генерации инбаундов', HttpStatus.BAD_REQUEST);
    }

    const tagToUuid = new Map<string, string>(
      rwInbounds
        .filter((i: any) => i.tag && i.uuid)
        .map((i: any) => [i.tag as string, i.uuid as string]),
    );

    let nodeName = '';
    let countryCode = '';
    let nodeAddress = profile.nodeAddress || '';

    if (profile.nodeUuid) {
      try {
        const nodes = await this.remnavaveService.getNodes();
        const node = nodes.find((n: any) => n.uuid === profile.nodeUuid);
        if (node) {
          nodeName = node.name || '';
          countryCode = node.countryCode || '';
          nodeAddress = node.address || nodeAddress;
        }
      } catch (e) {
        this.logger.warn(`Не удалось получить ноды: ${e.message}`);
      }
    }

    const countryFlag = countryCode.length === 2
      ? Array.from(countryCode.toUpperCase()).map(c => String.fromCodePoint(c.charCodeAt(0) - 65 + 0x1F1E6)).join('')
      : countryCode;

    const startIndex = profile.hostIndexStart ?? 1;
    const newMappings: { tag: string; hostUuid: string }[] = [];
    let created = 0;

    for (let i = 0; i < configInbounds.length; i++) {
      const configInbound = configInbounds[i];
      const inboundTag: string = configInbound.tag || '';
      const inboundType = inboundTag.replace(/-rwm.*$/, '');
      const inboundUuid = tagToUuid.get(inboundTag);

      if (!inboundUuid) {
        this.logger.warn(`createHostsForProfile: UUID не найден для тега ${inboundTag} — пропускаем`);
        continue;
      }

      let remark = (profile.hostTemplate || '{countryCode} {nodeName} - {inboundType}')
        .replace('{countryFlag}', countryFlag)
        .replace('{countryCode}', countryCode)
        .replace('{nodeName}', nodeName)
        .replace('{nodeAddress}', nodeAddress)
        .replace('{inboundType}', inboundType)
        .replace('{index}', String(startIndex + i));

      remark = remark.slice(0, 40);

      try {
        const newHost = await this.remnavaveService.createHost({
          inbound: { configProfileUuid: uuid, configProfileInboundUuid: inboundUuid },
          remark,
          address: nodeAddress,
          port: configInbound.port ?? 0,
          nodes: profile.nodeUuid ? [profile.nodeUuid] : undefined,
        });

        const hostUuid = newHost?.uuid || newHost?.response?.uuid || (typeof newHost === 'string' ? newHost : null);
        if (hostUuid) {
          newMappings.push({ tag: inboundTag, hostUuid });
          created++;
        }
      } catch (e) {
        this.logger.error(`Ошибка создания хоста для инбаунда ${inboundTag}: ${e.message}`);
      }
    }

    profiles[idx] = { ...profile, hostMappings: newMappings };
    await this.rotationService.saveProfiles(profiles);

    return { created, mappings: newMappings };
  }

  @Get('nodes')
  async getNodes() {
    try {
      return await this.remnavaveService.getNodes();
    } catch (e) {
      this.logger.error(`Ошибка загрузки нод: ${e.message}`);
      throw new HttpException(e.message, HttpStatus.BAD_REQUEST);
    }
  }

  @Get('hosts')
  async getHosts() {
    try {
      return await this.remnavaveService.getAllHosts();
    } catch (e) {
      this.logger.error(`Ошибка загрузки хостов: ${e.message}`);
      throw new HttpException(e.message, HttpStatus.BAD_REQUEST);
    }
  }

  @Get('profiles/managed/:uuid/hosts-with-sni')
  async getHostsWithSni(@Param('uuid') uuid: string) {
    const profiles = await this.rotationService.loadProfiles();
    const profile = profiles.find(p => p.uuid === uuid);
    if (!profile) throw new HttpException('Профиль не найден', HttpStatus.NOT_FOUND);

    if (!profile.hostMappings || profile.hostMappings.length === 0) return [];

    let rwProfile: any;
    try {
      rwProfile = await this.remnavaveService.getConfigProfile(uuid);
    } catch (e) {
      throw new HttpException('Ошибка получения профиля из Remnawave', HttpStatus.BAD_REQUEST);
    }

    const configInbounds: any[] = rwProfile?.config?.inbounds || [];

    const result = profile.hostMappings.map((mapping) => {
      const inbound = configInbounds.find((i: any) => i.tag === mapping.tag);
      let sni = '-';
      let protocol = '';
      let port: number | null = null;

      if (inbound) {
        protocol = inbound.protocol || '';
        port = inbound.port ?? null;
        const ss = inbound.streamSettings || {};
        if (ss.realitySettings?.serverNames?.[0]) {
          sni = ss.realitySettings.serverNames[0];
        } else if (ss.tlsSettings?.serverName) {
          sni = ss.tlsSettings.serverName;
        } else if (ss.wsSettings?.headers?.Host) {
          sni = ss.wsSettings.headers.Host;
        }
      }

      return { tag: mapping.tag, hostUuid: mapping.hostUuid, sni, protocol, port };
    });

    return result;
  }

  @Post('telegram/test')
  async testTelegram() {
    const configured = await this.telegramService.isConfigured();
    if (!configured) {
      throw new HttpException('Telegram не настроен', HttpStatus.BAD_REQUEST);
    }
    await this.telegramService.sendMessage('✅ <b>RWManager</b>\nТестовое сообщение — уведомления работают!');
    return { success: true };
  }

  @Post('check')
  async checkConnection(@Body() body: { remnawave_url: string; remnawave_api_key: string }) {
    const success = await this.remnavaveService.checkConnection(body.remnawave_url, body.remnawave_api_key);
    return { success };
  }

  @Post()
  async update(@Body() settings: Record<string, string>) {
    if (settings.remnawave_url) {
      try {
        const parsed = new URL(settings.remnawave_url);
        settings['remnawave_host'] = parsed.hostname;

        let address = '';
        if (net.isIP(parsed.hostname) === 0) {
          const result = await dns.lookup(parsed.hostname);
          address = result.address;
        } else {
          address = parsed.hostname;
        }

        if (address && address !== '127.0.0.1' && address !== 'localhost') {
          try {
            const geoRes = await fetch(`http://ip-api.com/json/${address}`);
            const geoData: any = await geoRes.json();

            if (geoData.status === 'success') {
              const countryCode = geoData.countryCode;
              const countryInfo = COUNTRIES.find(c => c.code === countryCode);

              if (countryInfo) {
                settings['remnawave_geo_country'] = countryInfo.name;
                settings['remnawave_geo_flag'] = countryInfo.emoji;
              } else {
                settings['remnawave_geo_country'] = geoData.country;
                settings['remnawave_geo_flag'] = '';
              }
            }
          } catch (geoError) {
            console.error(`GeoIP error: ${geoError.message}`);
          }
        }
      } catch (e) {
        console.warn(`Could not parse remnawave_url: ${settings.remnawave_url}`);
      }
    }

    for (const [key, value] of Object.entries(settings)) {
      await this.settingsRepo.save({ key, value });
    }
    return { success: true };
  }
}
