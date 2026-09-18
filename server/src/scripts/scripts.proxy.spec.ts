import { ScriptsService } from './scripts.service';
import { encryptProxyUrl } from '../common/proxy-crypto';

function harness(initial: Record<string, string> = {}) {
  const rows = new Map(Object.entries(initial));
  const repo = {
    findOne: jest.fn(async ({ where: { key } }: { where: { key: string } }) => {
      const value = rows.get(key);
      return value === undefined ? null : { key, value };
    }),
    save: jest.fn(async ({ key, value }: { key: string; value: string }) => {
      rows.set(key, value);
      return { key, value };
    }),
    create: jest.fn((value) => value),
  };
  const secrets = {
    getValue: jest.fn(async (id: string) =>
      id === 'selected-key' ? 'private-key' : null,
    ),
    create: jest.fn(),
  };
  return {
    rows,
    secrets,
    service: new ScriptsService(repo as never, {} as never, secrets as never),
  };
}

describe('SSH node proxy and secret references', () => {
  const previousKey = process.env.SECRET_ENCRYPTION_KEY;
  beforeEach(() => {
    process.env.SECRET_ENCRYPTION_KEY = 'ab'.repeat(32);
  });
  afterEach(() => {
    if (previousKey === undefined) delete process.env.SECRET_ENCRYPTION_KEY;
    else process.env.SECRET_ENCRYPTION_KEY = previousKey;
  });

  it('reuses a selected SSH key secret without creating a duplicate', async () => {
    const { service, rows, secrets } = harness();
    await service.upsertSshNode({
      name: 'node',
      ip: 'node.example',
      authType: 'key',
      sshKey: 'private-key',
      sshKeySecretId: 'selected-key',
    });
    const stored = JSON.parse(rows.get('ssh_nodes') || '[]')[0];
    expect(stored.sshKeySecretId).toBe('selected-key');
    expect(stored.sshKey).toBeUndefined();
    expect(secrets.create).not.toHaveBeenCalled();
  });

  it('uses a node proxy before the global proxy and decrypts both', async () => {
    const globalProxy = 'socks5://global:secret@global.example:1080';
    const nodeProxy = 'socks5://node:secret@node-proxy.example:1081';
    const { service, rows } = harness({
      ssh_proxy_url: encryptProxyUrl(globalProxy),
      ssh_nodes: JSON.stringify([
        {
          id: 'a',
          name: 'A',
          ip: 'a.example',
          authType: 'password',
          proxyUrl: encryptProxyUrl(nodeProxy),
        },
        { id: 'b', name: 'B', ip: 'b.example', authType: 'password' },
        {
          id: 'c',
          name: 'C',
          ip: 'c.example',
          authType: 'password',
          proxyUrl: encryptProxyUrl(nodeProxy),
          disableProxy: true,
        },
      ]),
    });
    expect(await service.getSshProxyUrlForNode('a')).toBe(nodeProxy);
    expect(await service.getSshProxyUrlForNode('b')).toBe(globalProxy);
    expect(await service.getSshProxyUrlForNode('c')).toBeUndefined();
    expect((await service.getSshNodeForConnection('a'))?.proxyUrl).toBe(
      nodeProxy,
    );
    expect((await service.getSshNodeForConnection('b'))?.proxyUrl).toBe(
      globalProxy,
    );
    expect(
      (await service.getSshNodeForConnection('c'))?.proxyUrl,
    ).toBeUndefined();
    const publicNodes = await service.getSshNodes();
    expect(publicNodes[0].hasProxyUrl).toBe(true);
    expect(publicNodes[0].proxyUrl).toBeUndefined();
    expect(JSON.stringify(publicNodes)).not.toContain('secret');
    expect(rows.get('ssh_nodes')).not.toContain('node:secret');
  });

  it('persists direct connection mode and restores the saved node proxy when disabled', async () => {
    const nodeProxy = 'socks5://node:secret@node-proxy.example:1081';
    const { service, rows } = harness({
      ssh_proxy_url: encryptProxyUrl(
        'socks5://global:secret@global.example:1080',
      ),
      ssh_nodes: JSON.stringify([
        {
          id: 'c',
          name: 'C',
          ip: 'c.example',
          authType: 'password',
          proxyUrl: encryptProxyUrl(nodeProxy),
        },
      ]),
    });
    await service.upsertSshNode({
      id: 'c',
      name: 'C',
      ip: 'c.example',
      authType: 'password',
      disableProxy: true,
    });
    expect(await service.getSshProxyUrlForNode('c')).toBeUndefined();
    expect(JSON.parse(rows.get('ssh_nodes') || '[]')[0].disableProxy).toBe(
      true,
    );
    await service.upsertSshNode({
      id: 'c',
      name: 'C',
      ip: 'c.example',
      authType: 'password',
      disableProxy: false,
    });
    expect(await service.getSshProxyUrlForNode('c')).toBe(nodeProxy);
  });

  it('connects a direct node without decrypting an unusable global proxy', async () => {
    const { service } = harness({
      ssh_proxy_url: 'enc:invalid:invalid:invalid',
      ssh_nodes: JSON.stringify([
        {
          id: 'direct',
          name: 'Direct',
          ip: 'direct.example',
          authType: 'password',
          disableProxy: true,
        },
        {
          id: 'other',
          name: 'Other',
          ip: 'other.example',
          authType: 'password',
          proxyUrl: 'enc:invalid:invalid:invalid',
        },
      ]),
    });
    expect(
      (await service.getSshNodeForConnection('direct'))?.proxyUrl,
    ).toBeUndefined();
  });
});
