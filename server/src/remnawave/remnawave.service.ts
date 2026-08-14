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
import type {
  CreateRemnawaveHostBody,
  CreateRemnawaveNodeBody,
  RemnawaveConfigProfile,
  RemnawaveHost,
  RemnawaveNode,
  RemnawaveResponse,
  RemnawaveXrayConfig,
  UpdateRemnawaveHostBody,
} from './remnawave.types';

export interface RemnawaveConnectionCheckResult {
  success: boolean;
  message?: string;
  status?: number;
}

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

  private async request<T>(
    path: string,
    init: RequestInit = {},
    baseOverride?: string,
  ): Promise<T> {
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
    return (text ? JSON.parse(text) : undefined) as T;
  }

  private unwrapResponse<T>(data: RemnawaveResponse<T>, operation: string): T {
    if (!data || data.response === undefined) {
      throw new Error(`Invalid response from Remnawave for ${operation}`);
    }
    return data.response;
  }

  async getConfigProfiles(): Promise<RemnawaveConfigProfile[]> {
    const data = await this.request<
      RemnawaveResponse<{
        total: number;
        configProfiles: RemnawaveConfigProfile[];
      }>
    >('/api/config-profiles');
    return this.unwrapResponse(data, 'get config profiles').configProfiles;
  }

  async getConfigProfile(uuid: string): Promise<RemnawaveConfigProfile> {
    const data = await this.request<RemnawaveResponse<RemnawaveConfigProfile>>(
      `/api/config-profiles/${encodeURIComponent(uuid)}`,
    );
    return this.unwrapResponse(data, 'get config profile');
  }

  async updateConfigProfile(
    uuid: string,
    config: RemnawaveXrayConfig,
  ): Promise<RemnawaveConfigProfile> {
    const data = await this.request<RemnawaveResponse<RemnawaveConfigProfile>>(
      '/api/config-profiles',
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ uuid, config }),
      },
    );
    return this.unwrapResponse(data, 'update config profile');
  }

  async getNodes(): Promise<RemnawaveNode[]> {
    const data =
      await this.request<RemnawaveResponse<RemnawaveNode[]>>('/api/nodes');
    return this.unwrapResponse(data, 'get nodes');
  }

  async getAllHosts(): Promise<RemnawaveHost[]> {
    const data =
      await this.request<RemnawaveResponse<RemnawaveHost[]>>('/api/hosts');
    return this.unwrapResponse(data, 'get hosts');
  }

  async updateHost(
    uuid: string,
    body: UpdateRemnawaveHostBody,
  ): Promise<RemnawaveHost> {
    const data = await this.request<RemnawaveResponse<RemnawaveHost>>(
      '/api/hosts',
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ...body, uuid }),
      },
    );
    return this.unwrapResponse(data, 'update host');
  }

  async getX25519Keys(): Promise<{ publicKey: string; privateKey: string }> {
    const data = await this.request<
      RemnawaveResponse<{
        keypairs: Array<{ publicKey: string; privateKey: string }>;
      }>
    >('/api/system/tools/x25519/generate');
    const keypair = this.unwrapResponse(data, 'generate X25519 keys')
      .keypairs[0];

    if (!keypair) throw new Error('No keypair returned from Remnawave');
    return { publicKey: keypair.publicKey, privateKey: keypair.privateKey };
  }

  async checkConnectionDetailed(
    url: string,
    apiKey: string,
  ): Promise<RemnawaveConnectionCheckResult> {
    try {
      const apiUrl = await this.buildApiUrl(url, '/api/config-profiles');
      const res = await fetchWithTimeout(
        apiUrl,
        {
          headers: { Authorization: `Bearer ${apiKey}` },
        },
        10_000,
      );
      if (res.ok) return { success: true };
      return {
        success: false,
        status: res.status,
        message: this.describeConnectionResponse(res.status),
      };
    } catch (e) {
      return { success: false, message: this.describeConnectionError(e) };
    }
  }

  async checkConnection(url: string, apiKey: string): Promise<boolean> {
    return (await this.checkConnectionDetailed(url, apiKey)).success;
  }

  private describeConnectionResponse(status: number): string {
    if (status === 401) {
      return `Remnawave rejected the API token (HTTP ${status}).`;
    }
    if (status === 403) {
      return 'Remnawave API token cannot access config profiles (HTTP 403). Check the token scopes.';
    }
    if (status === 404) {
      return 'Remnawave API endpoint was not found. Check the panel URL.';
    }
    return `Remnawave responded with HTTP ${status}.`;
  }

  private describeConnectionError(error: unknown): string {
    const message =
      error instanceof Error
        ? error.message
        : typeof error === 'string'
          ? error
          : 'Unknown error';
    if (message.includes('Requests to internal addresses are forbidden')) {
      return (
        'Remnawave URL resolves to a private IP. ' +
        'Set RWM_ALLOW_PRIVATE_REMNAWAVE=true for trusted internal panels and restart the backend.'
      );
    }
    if (error instanceof Error && error.name === 'AbortError') {
      return 'Connection to Remnawave timed out.';
    }
    return `Remnawave connection failed: ${message}`;
  }

  async createConfigProfile(
    name: string,
    config?: RemnawaveXrayConfig,
  ): Promise<RemnawaveConfigProfile> {
    const tmpTag = `init-${Date.now().toString(36)}-rwm`;
    const defaultConfig = buildInitialXrayConfigFromTemplate(
      DEFAULT_XRAY_CONFIG_TEMPLATE,
      tmpTag,
      randomId(),
    );
    const body = { name, config: config ?? defaultConfig };
    this.logger.log(`createConfigProfile request: ${JSON.stringify(body)}`);

    const data = await this.request<RemnawaveResponse<RemnawaveConfigProfile>>(
      '/api/config-profiles',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    );
    return this.unwrapResponse(data, 'create config profile');
  }

  async deleteConfigProfile(uuid: string): Promise<void> {
    await this.request<void>(
      `/api/config-profiles/${encodeURIComponent(uuid)}`,
      {
        method: 'DELETE',
      },
    );
  }

  async renameConfigProfile(
    uuid: string,
    name: string,
  ): Promise<RemnawaveConfigProfile> {
    const data = await this.request<RemnawaveResponse<RemnawaveConfigProfile>>(
      '/api/config-profiles',
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uuid, name }),
      },
    );
    return this.unwrapResponse(data, 'rename config profile');
  }

  async createHost(body: CreateRemnawaveHostBody): Promise<RemnawaveHost> {
    const data = await this.request<RemnawaveResponse<RemnawaveHost>>(
      '/api/hosts',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    );
    return this.unwrapResponse(data, 'create host');
  }

  async applyProfileToNode(
    nodeUuid: string,
    profileUuid: string,
    inboundUuids: string[],
  ): Promise<void> {
    if (!inboundUuids.length)
      throw new Error('applyProfileToNode: inboundUuids must not be empty');

    await this.request<void>('/api/nodes/bulk-actions/profile-modification', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        uuids: [nodeUuid],
        configProfile: {
          activeConfigProfileUuid: profileUuid,
          activeInbounds: inboundUuids,
        },
      }),
    });
  }

  async getNodeSecretKey(): Promise<string> {
    const data =
      await this.request<RemnawaveResponse<{ secretKey: string }>>(
        '/api/keygen',
      );
    const { secretKey } = this.unwrapResponse(data, 'generate node secret key');
    if (!secretKey)
      throw new Error('No node secret key returned from Remnawave');
    return secretKey;
  }

  async createNode(body: CreateRemnawaveNodeBody): Promise<RemnawaveNode> {
    const data = await this.request<RemnawaveResponse<RemnawaveNode>>(
      '/api/nodes',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    );
    return this.unwrapResponse(data, 'create node');
  }

  async deleteNode(uuid: string): Promise<void> {
    await this.request<void>(`/api/nodes/${encodeURIComponent(uuid)}`, {
      method: 'DELETE',
    });
  }

  async enableNode(uuid: string): Promise<RemnawaveNode> {
    const data = await this.request<RemnawaveResponse<RemnawaveNode>>(
      `/api/nodes/${encodeURIComponent(uuid)}/actions/enable`,
      { method: 'POST' },
    );
    return this.unwrapResponse(data, 'enable node');
  }

  async disableNode(uuid: string): Promise<RemnawaveNode> {
    const data = await this.request<RemnawaveResponse<RemnawaveNode>>(
      `/api/nodes/${encodeURIComponent(uuid)}/actions/disable`,
      { method: 'POST' },
    );
    return this.unwrapResponse(data, 'disable node');
  }

  async restartNode(uuid: string, forceRestart = false): Promise<void> {
    await this.request<void>(
      `/api/nodes/${encodeURIComponent(uuid)}/actions/restart`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ forceRestart }),
      },
    );
  }
}
