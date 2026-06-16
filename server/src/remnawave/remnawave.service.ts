import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Setting } from '../settings/entities/setting.entity';
import { randomId } from '../common/random-id';
import {
  DEFAULT_XRAY_CONFIG_TEMPLATE,
  buildInitialXrayConfigFromTemplate,
} from '../settings/xray-template';
import {
  assertSafePublicHttpUrl,
  fetchWithTimeout,
  readLimitedResponseText,
} from '../security/url-safety';

@Injectable()
export class RemnavaveService {
  private readonly logger = new Logger(RemnavaveService.name);

  constructor(
    @InjectRepository(Setting)
    private settingRepo: Repository<Setting>,
  ) {}

  private async getSettings(): Promise<{ url: string; apiKey: string }> {
    const [urlSetting, apiKeySetting] = await Promise.all([
      this.settingRepo.findOne({ where: { key: 'remnawave_url' } }),
      this.settingRepo.findOne({ where: { key: 'remnawave_api_key' } }),
    ]);
    return {
      url: urlSetting?.value?.replace(/\/+$/, '') || '',
      apiKey: apiKeySetting?.value || '',
    };
  }

  private shouldAllowPrivateRemnawave(): boolean {
    return process.env.RWM_ALLOW_PRIVATE_REMNAWAVE === 'true';
  }

  private async buildApiUrl(baseUrl: string, path: string): Promise<string> {
    const cleanUrl = baseUrl.replace(/\/+$/, '');
    const parsed = await assertSafePublicHttpUrl(cleanUrl, {
      allowPrivate: this.shouldAllowPrivateRemnawave(),
    });
    return `${parsed.toString().replace(/\/+$/, '')}${path}`;
  }

  private async request(
    path: string,
    init: RequestInit = {},
    baseOverride?: string,
  ): Promise<any> {
    const settings = baseOverride
      ? { url: baseOverride, apiKey: '' }
      : await this.getSettings();
    if (!settings.url || (!settings.apiKey && !baseOverride)) {
      throw new Error('Remnawave credentials not configured');
    }
    const url = await this.buildApiUrl(settings.url, path);
    const headers = {
      ...(settings.apiKey
        ? { Authorization: `Bearer ${settings.apiKey}` }
        : {}),
      ...(init.headers || {}),
    };
    const res = await fetchWithTimeout(url, { ...init, headers }, 10_000);
    const text = await readLimitedResponseText(res, 1_048_576);
    if (!res.ok) {
      throw new Error(`Remnawave request failed: ${res.status} ${text}`);
    }
    return text ? JSON.parse(text) : null;
  }

  async getConfigProfiles(): Promise<any[]> {
    const data = await this.request('/api/config-profiles');
    // Response shape: { response: { total, configProfiles: [...] } }
    return data.response?.configProfiles || [];
  }

  async getConfigProfile(uuid: string): Promise<any> {
    const profiles = await this.getConfigProfiles();
    return profiles.find((p: any) => p.uuid === uuid) || null;
  }

  async updateConfigProfile(uuid: string, config: any): Promise<any> {
    const data = await this.request('/api/config-profiles', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ uuid, config }),
    });
    return data.response;
  }

  async getNodes(): Promise<any[]> {
    const data = await this.request('/api/nodes');
    return data.response || [];
  }

  async getAllHosts(): Promise<any[]> {
    const data = await this.request('/api/hosts');
    return data.response || [];
  }

  async updateHost(uuid: string, body: object): Promise<any> {
    const data = await this.request('/api/hosts', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ uuid, ...body }),
    });
    return data.response;
  }

  async getX25519Keys(): Promise<{ publicKey: string; privateKey: string }> {
    const data = await this.request('/api/system/tools/x25519/generate');
    const keypair = data.response?.keypairs?.[0] || data.keypairs?.[0];

    if (!keypair) throw new Error('No keypair returned from Remnawave');
    return { publicKey: keypair.publicKey, privateKey: keypair.privateKey };
  }

  async checkConnection(url: string, apiKey: string): Promise<boolean> {
    try {
      const apiUrl = await this.buildApiUrl(url, '/api/config-profiles');
      const res = await fetchWithTimeout(
        apiUrl,
        {
          headers: { Authorization: `Bearer ${apiKey}` },
        },
        10_000,
      );
      return res.ok;
    } catch {
      return false;
    }
  }

  async createConfigProfile(name: string, config?: object): Promise<any> {
    const tmpTag = `init-${Date.now().toString(36)}-rwm`;
    const defaultConfig = buildInitialXrayConfigFromTemplate(
      DEFAULT_XRAY_CONFIG_TEMPLATE,
      tmpTag,
      randomId(),
    );
    const body = { name, config: config ?? defaultConfig };
    this.logger.log(`createConfigProfile request: ${JSON.stringify(body)}`);

    const data = await this.request('/api/config-profiles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return data.response;
  }

  async deleteConfigProfile(uuid: string): Promise<any> {
    const data = await this.request(`/api/config-profiles/${uuid}`, {
      method: 'DELETE',
    });
    return data.response;
  }

  async renameConfigProfile(uuid: string, name: string): Promise<any> {
    const data = await this.request('/api/config-profiles', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uuid, name }),
    });
    return data.response;
  }

  async createHost(body: {
    inbound: { configProfileUuid: string; configProfileInboundUuid: string };
    remark: string;
    address: string;
    port: number;
    nodes?: string[];
  }): Promise<any> {
    const data = await this.request('/api/hosts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return data.response;
  }

  async applyProfileToNode(
    nodeUuid: string,
    profileUuid: string,
    inboundUuids: string[],
  ): Promise<any> {
    if (!inboundUuids.length)
      throw new Error('applyProfileToNode: inboundUuids must not be empty');

    const data = await this.request(
      '/api/nodes/bulk-actions/profile-modification',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uuids: [nodeUuid],
          configProfile: {
            activeConfigProfileUuid: profileUuid,
            activeInbounds: inboundUuids,
          },
        }),
      },
    );
    return data.response;
  }

  async getKeygenPubKey(): Promise<string> {
    const data = await this.request('/api/keygen');
    return data.response?.pubKey || '';
  }

  async createNode(body: {
    name: string;
    address: string;
    port?: number;
    countryCode?: string;
    configProfile: {
      activeConfigProfileUuid: string;
      activeInbounds: string[];
    };
  }): Promise<any> {
    const data = await this.request('/api/nodes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return data.response;
  }

  async deleteNode(uuid: string): Promise<any> {
    const data = await this.request(`/api/nodes/${uuid}`, {
      method: 'DELETE',
    });
    return data.response;
  }

  async enableNode(uuid: string): Promise<any> {
    const data = await this.request(`/api/nodes/${uuid}/actions/enable`, {
      method: 'POST',
    });
    return data.response;
  }

  async disableNode(uuid: string): Promise<any> {
    const data = await this.request(`/api/nodes/${uuid}/actions/disable`, {
      method: 'POST',
    });
    return data.response;
  }

  async restartNode(uuid: string): Promise<any> {
    const data = await this.request(`/api/nodes/${uuid}/actions/restart`, {
      method: 'POST',
    });
    return data.response;
  }
}
