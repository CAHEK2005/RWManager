import { Controller, Get, Post, Body, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Setting } from './entities/setting.entity';
import * as net from 'net';
import * as dns from 'dns/promises';
import { COUNTRIES } from './countries';
import { RemnavaveService } from '../remnawave/remnawave.service';

@Controller('settings')
export class SettingsController {
  private readonly logger = new Logger(SettingsController.name);

  constructor(
    @InjectRepository(Setting)
    private settingsRepo: Repository<Setting>,
    private remnavaveService: RemnavaveService,
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
