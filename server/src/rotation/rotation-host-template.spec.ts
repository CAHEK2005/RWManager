import { RotationService, ManagedProfile } from './rotation.service';

describe('RotationService host template sync', () => {
  it('updates host remark during rotation using the active template', async () => {
    const remnawave = {
      getNodes: jest.fn().mockResolvedValue([
        {
          uuid: 'node-1',
          name: 'Berlin-01',
          address: '203.0.113.10',
          countryCode: 'DE',
        },
      ]),
      updateHost: jest.fn().mockResolvedValue({}),
    };

    const service = new RotationService(
      {} as any,
      {
        findOne: jest.fn().mockResolvedValue({
          value: '{countryCode} {nodeName} {inboundType} #{index}',
        }),
      } as any,
      remnawave as any,
      {} as any,
      {} as any,
    );

    const profile: ManagedProfile & {
      hostTemplateMode?: 'inherit' | 'custom';
    } = {
      uuid: 'profile-1',
      name: 'Profile',
      inboundsConfig: [],
      excludedPorts: [],
      nodeUuid: 'node-1',
      nodeAddress: '203.0.113.10',
      applyToNode: false,
      hostMappings: [{ tag: 'vless-tcp-reality-rwm-a1', hostUuid: 'host-1' }],
      hostTemplate: '{nodeName}',
      hostTemplateMode: 'inherit',
      hostIndexStart: 5,
      rotationEnabled: true,
      rotationMode: 'interval',
      rotationInterval: 1440,
      rotationScheduleTime: '03:00',
      rotationTimezone: 'Europe/Moscow',
      lastRotationTimestamp: 0,
      lastRotationStatus: null,
      lastRotationError: '',
    };

    await (service as any).syncHosts(
      'profile-1',
      [{ tag: 'vless-tcp-reality-rwm-a1', uuid: 'inbound-1', port: 443 }],
      profile,
    );

    expect(remnawave.updateHost).toHaveBeenCalledWith(
      'host-1',
      expect.objectContaining({
        remark: 'DE Berlin-01 vless-tcp-reality #5',
      }),
    );
  });
});
