import { BadRequestException, ForbiddenException, Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Domain } from './entities/domain.entity';

const SERVICE_PATTERNS: Record<string, string[]> = {
  'MAX':           ['max.ru'],
  'Яндекс':        ['yandex.ru','yandex.net','yandex.com','yandex.by','yandex.kz','ya.ru','yastatic.net','yandexcloud.net','ya.cc','yandex-team.ru'],
  'ВКонтакте':     ['vk.com','vk.ru','vkvideo.ru','userapi.com','vkontakte.ru','vk-apps.com','vkuseraudio.net','vkuservideo.net'],
  'Одноклассники': ['ok.ru'],
  'Mail.ru':       ['mail.ru','bk.ru','inbox.ru','list.ru','mycdn.me','imgsmail.ru','my.com'],
  'Авито':         ['avito.ru','avito.st'],
  'Кинопоиск':     ['kinopoisk.ru'],
  'Ozon':          ['ozon.ru','ozon.by','ozonusercontent.com','ozon.travel'],
  'Wildberries':   ['wildberries.ru','wildberries.by','wb.ru','wbcdn.ru','wbbasket.ru'],
  'Сбер':          ['sber.ru','sberbank.ru','sberpay.ru','sbermarket.ru','sberid.ru','sberbankacquiring.ru'],
  'Т-Банк':        ['tinkoff.ru','tcsbank.ru'],
  'Госуслуги':     ['gosuslugi.ru'],
  '2ГИС':          ['2gis.ru','2gis.com'],
  'Rutube':        ['rutube.ru','cdnvideo.ru'],
  'Telegram':      ['telegram.org','t.me','telegram.me','tdesktop.com','telegra.ph'],
  'МТС':           ['mts.ru'],
  'Beeline':       ['beeline.ru'],
  'Мегафон':       ['megafon.ru'],
  'Ростелеком':    ['rt.ru','rostelecom.ru'],
};

export interface CategoryResult {
  name: string;
  count: number;
  domains: string[];
}

@Injectable()
export class DomainsService implements OnModuleInit {
  constructor(
    @InjectRepository(Domain)
    private repo: Repository<Domain>,
  ) { }

  async onModuleInit() {
    await this.seedDefaultDomains();
  }

  private async seedDefaultDomains() {
    const count = await this.repo.count();
    
    if (count === 0) {
      
      const defaultDomains = [
        'ya.ru',
        'vk.com',
        'ok.ru',
        'gosuslugi.ru',
        'ozon.ru',
        'max.ru',
        'vkvideo.ru',
        'rutube.ru',
        'kinopoisk.ru',
        'avito.ru'
      ];

      const entities = defaultDomains.map(name => this.repo.create({ name }));
      await this.repo.save(entities);     
    }
  }

  async create(createDomainDto: { name: string }) {
    const exists = await this.repo.findOne({ where: { name: createDomainDto.name } });
    if (exists) return exists;

    const domain = this.repo.create(createDomainDto);
    return this.repo.save(domain);
  }

  async findAll(page: number = 1, limit: number = 10) {
    const skip = (page - 1) * limit;

    const [result, total] = await this.repo.findAndCount({
      take: limit,
      skip: skip,
      order: { id: 'DESC' },
    });

    return {
      data: result,
      total: total,
    };
  }

  async findAllUnpaginated(): Promise<Domain[]> {
    return this.repo.find({ order: { name: 'ASC' } });
  }

  findOne(id: number) {
    return this.repo.findOneBy({ id });
  }

  remove(id: number) {
    return this.repo.delete(id);
  }

  async removeAll() {
    await this.repo.clear();
    return { success: true };
  }

  async createMany(names: string[]) {
    if (!names || names.length === 0) return { count: 0 };

    const cleanNames = names
      .map(n => n.trim())
      .filter(n => n.length > 0);

    const existing = await this.repo.find();
    const existingSet = new Set(existing.map(d => d.name));

    const uniqueNewNames = [...new Set(cleanNames)]
      .filter(name => !existingSet.has(name));

    if (uniqueNewNames.length === 0) return { count: 0 };

    const entities = uniqueNewNames.map(name => this.repo.create({ name }));
    await this.repo.save(entities);

    return { count: entities.length };
  }

  // NOTE: SSRF check is hostname-string based. DNS rebinding is an accepted limitation.
  private isPrivateAddress(hostname: string): boolean {
    const h = hostname.toLowerCase();
    if (h === 'localhost' || h === '::1' || h === '[::1]') return true;
    if (h.startsWith('127.') || h.startsWith('0.0.0.0') || h.startsWith('169.254.')) return true;
    if (h.startsWith('10.') || h.startsWith('192.168.')) return true;
    for (let i = 16; i <= 31; i++) {
      if (h.startsWith(`172.${i}.`)) return true;
    }
    return false;
  }

  private categorizeDomains(domains: string[]): CategoryResult[] {
    // Build flat lookup: rootDomain → serviceName, sorted by root length DESC for accurate matching
    const lookup: Array<{ root: string; service: string }> = [];
    for (const [service, roots] of Object.entries(SERVICE_PATTERNS)) {
      for (const root of roots.sort((a, b) => b.length - a.length)) {
        lookup.push({ root, service });
      }
    }

    const buckets = new Map<string, string[]>();
    const others: string[] = [];

    for (const domain of domains) {
      const d = domain.toLowerCase();
      let matched = false;
      for (const { root, service } of lookup) {
        if (d === root || d.endsWith('.' + root)) {
          if (!buckets.has(service)) buckets.set(service, []);
          buckets.get(service)!.push(domain);
          matched = true;
          break;
        }
      }
      if (!matched) others.push(domain);
    }

    const result: CategoryResult[] = [];
    for (const [name, list] of buckets.entries()) {
      result.push({ name, count: list.length, domains: list });
    }
    result.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    if (others.length > 0) {
      result.push({ name: 'Другие', count: others.length, domains: others });
    }
    return result;
  }

  async previewUrl(url: string): Promise<{ total: number; categories: CategoryResult[] }> {
    let parsed: URL;
    try { parsed = new URL(url); } catch { throw new BadRequestException('Невалидный URL'); }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new BadRequestException('Только http/https');
    }
    if (this.isPrivateAddress(parsed.hostname)) {
      throw new ForbiddenException('Запрос к внутренним адресам запрещён');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    let text: string;
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) throw new BadRequestException(`HTTP ${res.status}`);
      text = await res.text();
    } catch (e: any) {
      if (e?.name === 'AbortError') throw new BadRequestException('Таймаут запроса');
      if (e instanceof BadRequestException) throw e;
      throw new BadRequestException(`Ошибка загрузки: ${e.message}`);
    } finally {
      clearTimeout(timeout);
    }

    const domains = text
      .split(/\r?\n/)
      .map(l => l.trim())
      .filter(l => l.length > 0 && !l.startsWith('#'));

    return { total: domains.length, categories: this.categorizeDomains(domains) };
  }
}