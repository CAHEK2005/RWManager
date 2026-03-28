import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Setting } from '../settings/entities/setting.entity';

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

  async getConfigProfiles(): Promise<any[]> {
    const { url, apiKey } = await this.getSettings();
    if (!url || !apiKey) throw new Error('Remnawave credentials not configured');

    const res = await fetch(`${url}/api/config-profiles`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!res.ok) throw new Error(`Failed to get config profiles: ${res.status}`);
    const data = await res.json();
    // Response shape: { response: { total, configProfiles: [...] } }
    return data.response?.configProfiles || [];
  }

  async getConfigProfile(uuid: string): Promise<any> {
    const profiles = await this.getConfigProfiles();
    return profiles.find((p: any) => p.uuid === uuid) || null;
  }

  async updateConfigProfile(uuid: string, config: any): Promise<any> {
    const { url, apiKey } = await this.getSettings();
    if (!url || !apiKey) throw new Error('Remnawave credentials not configured');

    const res = await fetch(`${url}/api/config-profiles`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ uuid, config }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Failed to update config profile: ${res.status} ${errText}`);
    }
    const data = await res.json();
    return data.response;
  }

  async getNodes(): Promise<any[]> {
    const { url, apiKey } = await this.getSettings();
    if (!url || !apiKey) throw new Error('Remnawave credentials not configured');

    const res = await fetch(`${url}/api/nodes`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!res.ok) throw new Error(`Failed to get nodes: ${res.status}`);
    const data = await res.json();
    return data.response || [];
  }

  async getAllHosts(): Promise<any[]> {
    const { url, apiKey } = await this.getSettings();
    if (!url || !apiKey) throw new Error('Remnawave credentials not configured');

    const res = await fetch(`${url}/api/hosts`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!res.ok) throw new Error(`Failed to get hosts: ${res.status}`);
    const data = await res.json();
    return data.response || [];
  }

  async updateHost(uuid: string, body: object): Promise<any> {
    const { url, apiKey } = await this.getSettings();
    if (!url || !apiKey) throw new Error('Remnawave credentials not configured');

    const res = await fetch(`${url}/api/hosts`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ uuid, ...body }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Failed to update host ${uuid}: ${res.status} ${errText}`);
    }
    const data = await res.json();
    return data.response;
  }

  async getX25519Keys(): Promise<{ publicKey: string; privateKey: string }> {
    const { url, apiKey } = await this.getSettings();
    if (!url || !apiKey) throw new Error('Remnawave credentials not configured');

    const res = await fetch(`${url}/api/system/tools/x25519/generate`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!res.ok) throw new Error(`Failed to get X25519 keys: ${res.status}`);
    const data = await res.json();
    const keypair = data.response?.keypairs?.[0] || data.keypairs?.[0];

    if (!keypair) throw new Error('No keypair returned from Remnawave');
    return { publicKey: keypair.publicKey, privateKey: keypair.privateKey };
  }

  async checkConnection(url: string, apiKey: string): Promise<boolean> {
    try {
      const cleanUrl = url.replace(/\/+$/, '');
      const res = await fetch(`${cleanUrl}/api/config-profiles`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async createConfigProfile(name: string, config?: object): Promise<any> {
    const { url, apiKey } = await this.getSettings();
    if (!url || !apiKey) throw new Error('Remnawave credentials not configured');

    const defaultConfig = { inbounds: [] };
    const body = { name, config: config ?? defaultConfig };
    this.logger.log(`createConfigProfile request: ${JSON.stringify(body)}`);

    const res = await fetch(`${url}/api/config-profiles`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      this.logger.error(`createConfigProfile failed ${res.status}: ${errText}`);
      throw new Error(`Failed to create config profile: ${res.status} ${errText}`);
    }
    const data = await res.json();
    return data.response;
  }

  async deleteConfigProfile(uuid: string): Promise<any> {
    const { url, apiKey } = await this.getSettings();
    if (!url || !apiKey) throw new Error('Remnawave credentials not configured');

    const res = await fetch(`${url}/api/config-profiles/${uuid}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Failed to delete config profile: ${res.status} ${errText}`);
    }
    const data = await res.json();
    return data.response;
  }

  async renameConfigProfile(uuid: string, name: string): Promise<any> {
    const { url, apiKey } = await this.getSettings();
    if (!url || !apiKey) throw new Error('Remnawave credentials not configured');

    const res = await fetch(`${url}/api/config-profiles`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ uuid, name }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Failed to rename config profile: ${res.status} ${errText}`);
    }
    const data = await res.json();
    return data.response;
  }

  async createHost(body: {
    inbound: { configProfileUuid: string; configProfileInboundUuid: string };
    remark: string;
    address: string;
    port: number;
    nodes?: string[];
  }): Promise<any> {
    const { url, apiKey } = await this.getSettings();
    if (!url || !apiKey) throw new Error('Remnawave credentials not configured');

    const res = await fetch(`${url}/api/hosts`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Failed to create host: ${res.status} ${errText}`);
    }
    const data = await res.json();
    return data.response;
  }

  async applyProfileToNode(nodeUuid: string, profileUuid: string, inboundUuids: string[]): Promise<any> {
    const { url, apiKey } = await this.getSettings();
    if (!url || !apiKey) throw new Error('Remnawave credentials not configured');

    if (!inboundUuids.length) throw new Error('applyProfileToNode: inboundUuids must not be empty');

    const res = await fetch(`${url}/api/nodes/bulk-actions/profile-modification`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        uuids: [nodeUuid],
        configProfile: {
          activeConfigProfileUuid: profileUuid,
          activeInbounds: inboundUuids,
        },
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Failed to apply profile to node: ${res.status} ${errText}`);
    }
    const data = await res.json();
    return data.response;
  }
}
