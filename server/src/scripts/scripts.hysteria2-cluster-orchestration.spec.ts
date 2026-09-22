import { ScriptsService, type SshNode } from './scripts.service';
import {
  HYSTERIA2_RECONFIGURE_SCRIPT_ID,
  HYSTERIA2_SCRIPT_ID,
} from './hysteria2-script';
import type { Hysteria2ClusterDnsValidation } from './hysteria2-cluster-state';

interface MutableNodeResult {
  logs: string[];
}

interface ValidatedCertificateFixture {
  fullchain: Buffer;
  privateKey: Buffer;
  fullchainPem: Buffer;
  privateKeyPem: Buffer;
  fingerprint: string;
  certificateFingerprint: string;
  notAfter: string;
  certificateNotAfter: string;
}

interface ScriptsServiceInternals {
  runScriptOnNode(
    node: SshNode,
    content: string,
    result: MutableNodeResult,
    mask: string[],
  ): Promise<void>;
  resolveHysteria2ClusterDns(
    domain: string,
    nodes: SshNode[],
  ): Promise<Hysteria2ClusterDnsValidation>;
  readAndValidateHysteria2Certificate(
    node: SshNode,
    domain: string,
  ): Promise<ValidatedCertificateFixture>;
  readRemoteFiles(
    node: SshNode,
    paths: string[],
    maxTotalBytes?: number,
  ): Promise<Map<string, Buffer>>;
}

const DOMAIN = 'cluster.example.com';
const EMAIL = 'acme@example.com';
const NOT_AFTER = '2099-01-01T00:00:00.000Z';
const FULLCHAIN = Buffer.from(`-----BEGIN CERTIFICATE-----
cluster-certificate-material
-----END CERTIFICATE-----
`);
const PRIVATE_KEY = Buffer.from(`-----BEGIN PRIVATE KEY-----
cluster-private-material
-----END PRIVATE KEY-----
`);
const PRIVATE_KEY_BASE64 = PRIVATE_KEY.toString('base64');

const NODES: SshNode[] = [
  {
    id: 'node-a',
    name: 'node-a',
    ip: '192.0.2.10',
    sshUser: 'root',
    authType: 'password',
    password: 'test-password-a',
  },
  {
    id: 'node-b',
    name: 'node-b',
    ip: '192.0.2.20',
    sshUser: 'root',
    authType: 'password',
    password: 'test-password-b',
  },
];

function createService() {
  const rows = new Map<string, string>();
  const repo = {
    findOne: jest.fn(async ({ where: { key } }: { where: { key: string } }) => {
      const value = rows.get(key);
      return value === undefined ? null : { key, value };
    }),
    save: jest.fn(async ({ key, value }: { key: string; value: string }) => {
      rows.set(key, value);
      return { key, value };
    }),
    create: jest.fn((value: { key: string }) => value),
  };
  const telegram = {
    notifyScriptExecution: jest.fn(async () => undefined),
  };
  const service = new ScriptsService(
    repo as never,
    telegram as never,
    {
      getValue: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    } as never,
  );
  rows.set('ssh_nodes', JSON.stringify(NODES));
  return {
    service,
    internal: service as unknown as ScriptsServiceInternals,
    rows,
  };
}

function dnsValidation(): Hysteria2ClusterDnsValidation {
  return {
    domain: DOMAIN,
    resolvedIpv4: NODES.map((node) => node.ip),
    resolvedIpv6: [],
    resolvedAddresses: NODES.map((node) => node.ip),
    nodeAddresses: NODES.map((node) => node.ip),
    nodes: NODES.map((node) => ({ nodeId: node.id, address: node.ip })),
  };
}

function certificateFixture(): ValidatedCertificateFixture {
  return {
    fullchain: FULLCHAIN,
    privateKey: PRIVATE_KEY,
    fullchainPem: FULLCHAIN,
    privateKeyPem: PRIVATE_KEY,
    fingerprint: 'AA:BB:CC',
    certificateFingerprint: 'AA:BB:CC',
    notAfter: NOT_AFTER,
    certificateNotAfter: NOT_AFTER,
  };
}

function scriptPhase(
  content: string,
): 'prepare' | 'probe' | 'monolithic' | 'deploy' | 'unknown' {
  if (content.includes('ROLE=') && content.includes('INNER_FRAGMENT_B64=')) {
    return 'prepare';
  }
  if (content.includes('PROBE_NAME="rwm-cluster-')) return 'probe';
  if (content.includes('PRIVATE_KEY_B64=')) return 'deploy';
  if (content.includes('HYSTERIA_CLUSTER_MANAGED=1')) return 'monolithic';
  return 'unknown';
}

async function waitForJob(
  service: ScriptsService,
  jobId: string,
): Promise<NonNullable<ReturnType<ScriptsService['getJobStatus']>>> {
  for (let attempt = 0; attempt < 200; attempt++) {
    const job = service.getJobStatus(jobId);
    if (job && job.status !== 'running') return job;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error(`Job ${jobId} did not finish`);
}

async function waitForHistory(rows: Map<string, string>): Promise<string> {
  for (let attempt = 0; attempt < 200; attempt++) {
    const history = rows.get('script_history');
    if (history) return history;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error('Script history was not saved');
}

function mockClusterDependencies(
  internal: ScriptsServiceInternals,
  implementation?: ScriptsServiceInternals['runScriptOnNode'],
) {
  jest
    .spyOn(internal, 'readRemoteFiles')
    .mockResolvedValue(new Map<string, Buffer>());
  const resolver = jest
    .spyOn(internal, 'resolveHysteria2ClusterDns')
    .mockResolvedValue(dnsValidation());
  const certificateReader = jest
    .spyOn(internal, 'readAndValidateHysteria2Certificate')
    .mockResolvedValue(certificateFixture());
  const runner = jest.spyOn(internal, 'runScriptOnNode').mockImplementation(
    implementation ??
      (async (_node, _content, result) => {
        result.logs.push('[SSH] test phase completed');
      }),
  );
  return { resolver, certificateReader, runner };
}

describe('ScriptsService Hysteria2 cluster orchestration', () => {
  it.each([
    {
      scriptId: HYSTERIA2_SCRIPT_ID,
      variables: {
        hysteria_domain: DOMAIN,
        certbot_email: EMAIL,
      },
    },
    {
      scriptId: HYSTERIA2_RECONFIGURE_SCRIPT_ID,
      variables: {
        hysteria_new_domain: DOMAIN,
        certbot_email: EMAIL,
      },
    },
  ])(
    'rejects cluster built-in $scriptId in executeSequence',
    async ({ scriptId, variables }) => {
      const { service, internal } = createService();
      await service.onModuleInit();
      const runner = jest
        .spyOn(internal, 'runScriptOnNode')
        .mockResolvedValue(undefined);

      await expect(
        service.executeSequence(
          [scriptId],
          NODES.map((node) => node.id),
          { [scriptId]: variables },
        ),
      ).rejects.toThrow(/Hysteria2|кластер/i);

      expect(runner).not.toHaveBeenCalled();
    },
  );

  it('prepares every node, probes once, then runs setup only on the coordinator', async () => {
    const { service, internal } = createService();
    await service.onModuleInit();
    const events: string[] = [];
    const { runner } = mockClusterDependencies(
      internal,
      async (node, content, result) => {
        const phase = scriptPhase(content);
        events.push(`${phase}:${node.id}`);
        result.logs.push(`[TEST] ${phase}`);
      },
    );

    const { jobId } = await service.executeScript(
      HYSTERIA2_SCRIPT_ID,
      NODES.map((node) => node.id),
      { hysteria_domain: DOMAIN, certbot_email: EMAIL },
    );
    const job = await waitForJob(service, jobId);

    expect(job.status).toBe('success');
    const prepareIndexes = events
      .map((event, index) => ({ event, index }))
      .filter(({ event }) => event.startsWith('prepare:'))
      .map(({ index }) => index);
    const probeIndex = events.findIndex((event) => event.startsWith('probe:'));
    const monolithicIndexes = events
      .map((event, index) => ({ event, index }))
      .filter(({ event }) => event.startsWith('monolithic:'))
      .map(({ index }) => index);

    expect(prepareIndexes).toHaveLength(NODES.length);
    expect(
      events
        .filter((event) => event.startsWith('prepare:'))
        .map((event) => event.split(':')[1])
        .sort(),
    ).toEqual(['node-a', 'node-b']);
    expect(probeIndex).toBeGreaterThan(Math.max(...prepareIndexes));
    expect(monolithicIndexes).toHaveLength(1);
    expect(monolithicIndexes[0]).toBeGreaterThan(probeIndex);
    expect(events[monolithicIndexes[0]]).toBe('monolithic:node-a');
    expect(
      runner.mock.calls.filter(([, content]) =>
        content.includes('HYSTERIA_CLUSTER_MANAGED=1'),
      ),
    ).toHaveLength(1);
  });

  it('rejects different per-node domain and email values before remote work', async () => {
    const { service, internal } = createService();
    await service.onModuleInit();
    const { resolver, certificateReader, runner } =
      mockClusterDependencies(internal);

    await expect(
      service.executeScript(
        HYSTERIA2_SCRIPT_ID,
        NODES.map((node) => node.id),
        { hysteria_domain: DOMAIN, certbot_email: EMAIL },
        {
          'node-b': {
            hysteria_domain: 'other.example.com',
            certbot_email: 'other@example.com',
          },
        },
      ),
    ).rejects.toThrow(/одинаков|совпад/i);

    expect(resolver).not.toHaveBeenCalled();
    expect(certificateReader).not.toHaveBeenCalled();
    expect(runner).not.toHaveBeenCalled();
  });

  it('masks certificate private material in job logs and persisted history', async () => {
    const { service, internal, rows } = createService();
    await service.onModuleInit();
    const { runner } = mockClusterDependencies(
      internal,
      async (_node, content, result, mask) => {
        if (scriptPhase(content) !== 'deploy') {
          result.logs.push('[SSH] test phase completed');
          return;
        }

        let simulatedRemoteOutput = `debug ${PRIVATE_KEY.toString('utf8')} ${PRIVATE_KEY_BASE64}`;
        for (const secret of mask) {
          simulatedRemoteOutput = simulatedRemoteOutput
            .split(secret)
            .join('***');
        }
        result.logs.push(simulatedRemoteOutput);
      },
    );

    const { jobId } = await service.executeScript(
      HYSTERIA2_SCRIPT_ID,
      NODES.map((node) => node.id),
      { hysteria_domain: DOMAIN, certbot_email: EMAIL },
    );
    const job = await waitForJob(service, jobId);
    const history = await waitForHistory(rows);
    const serializedJob = JSON.stringify(job);

    expect(job.status).toBe('success');
    expect(serializedJob).not.toContain('cluster-private-material');
    expect(serializedJob).not.toContain(PRIVATE_KEY_BASE64);
    expect(history).not.toContain('cluster-private-material');
    expect(history).not.toContain(PRIVATE_KEY_BASE64);

    const deployCalls = runner.mock.calls.filter(([, content]) =>
      content.includes('PRIVATE_KEY_B64='),
    );
    expect(deployCalls.length).toBeGreaterThan(0);
    for (const [, , , mask] of deployCalls) {
      expect(mask).toContain(PRIVATE_KEY.toString('utf8'));
      expect(mask).toContain(PRIVATE_KEY_BASE64);
    }
  });
});
