import { XRAY_INBOUNDS_PLACEHOLDER } from '../settings/xray-template';
import { ManagedProfile, RotationService } from './rotation.service';

describe('RotationService xray config template', () => {
  it('updates Remnawave profile with rendered Xray template config', async () => {
    const storedSettings = new Map<string, string>([
      [
        'xray_config_template',
        JSON.stringify({
          inbounds: XRAY_INBOUNDS_PLACEHOLDER,
          dns: { servers: ['1.1.1.1'] },
          outbounds: [{ tag: 'CUSTOM', protocol: 'freedom' }],
          routing: { rules: [{ type: 'field', outboundTag: 'CUSTOM' }] },
        }),
      ],
    ]);
    const settingRepo = {
      findOne: jest.fn(async ({ where: { key } }) => {
        if (!storedSettings.has(key)) return null;
        return { key, value: storedSettings.get(key) };
      }),
      create: jest.fn(({ key }) => ({ key, value: '' })),
      save: jest.fn(async (setting) => {
        storedSettings.set(setting.key, setting.value);
        return setting;
      }),
    };
    const remnawave = {
      getX25519Keys: jest.fn().mockResolvedValue({
        publicKey: 'public-key',
        privateKey: 'private-key',
      }),
      updateConfigProfile: jest.fn().mockResolvedValue({
        inbounds: [{ tag: 'vless-ws-rwm', uuid: 'rw-inbound', port: 443 }],
      }),
    };
    const inboundBuilder = {
      buildVlessWs: jest.fn().mockReturnValue({
        tag: 'vless-ws-rwm',
        port: 443,
        protocol: 'vless',
        settings: {},
        streamSettings: { network: 'ws', security: 'none' },
      }),
    };

    const service = new RotationService(
      { find: jest.fn().mockResolvedValue([{ name: 'example.com' }]) } as any,
      settingRepo as any,
      remnawave as any,
      inboundBuilder as any,
      { notifyRotation: jest.fn().mockResolvedValue(undefined) } as any,
    );
    const profile: ManagedProfile = {
      uuid: 'profile-1',
      name: 'Profile',
      inboundsConfig: [
        {
          type: 'vless-ws',
          port: 443,
          sni: 'example.com',
          security: 'none',
        },
      ],
      excludedPorts: [],
      nodeUuid: '',
      nodeAddress: '',
      applyToNode: false,
      hostMappings: [],
      rotationEnabled: true,
      rotationMode: 'interval',
      rotationInterval: 1440,
      rotationScheduleTime: '03:00',
      rotationTimezone: 'Europe/Moscow',
      lastRotationTimestamp: 0,
      lastRotationStatus: null,
      lastRotationError: '',
    };

    await expect(service.performRotation(profile)).resolves.toEqual(
      expect.objectContaining({ success: true }),
    );

    expect(remnawave.updateConfigProfile).toHaveBeenCalledWith('profile-1', {
      inbounds: [
        expect.objectContaining({
          tag: 'vless-ws-rwm',
          protocol: 'vless',
          port: 443,
        }),
      ],
      dns: { servers: ['1.1.1.1'] },
      outbounds: [{ tag: 'CUSTOM', protocol: 'freedom' }],
      routing: { rules: [{ type: 'field', outboundTag: 'CUSTOM' }] },
    });
  });
});
