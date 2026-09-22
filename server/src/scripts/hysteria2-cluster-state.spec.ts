import {
  HYSTERIA2_CLUSTER_STATE_VERSION,
  Hysteria2ClusterStateError,
  chooseHysteriaCoordinator,
  createEmptyHysteria2ClusterState,
  normalizeAndSortIpAddresses,
  normalizeHysteriaDomain,
  normalizeHysteriaEmail,
  normalizeIpAddress,
  upsertHysteria2ReconfigureGroup,
  upsertHysteria2SetupGroup,
  validateHysteria2ClusterDns,
  type Hysteria2ClusterState,
} from './hysteria2-cluster-state';

const CREATED_AT = '2026-09-21T10:00:00.000Z';
const UPDATED_AT = '2026-09-21T11:00:00.000Z';

function expectStateError(action: () => unknown, code: string): void {
  try {
    action();
    throw new Error(`Expected Hysteria2ClusterStateError: ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(Hysteria2ClusterStateError);
    expect(error).toMatchObject({ code });
  }
}

function stateWithTwoGroups(): Hysteria2ClusterState {
  return {
    version: HYSTERIA2_CLUSTER_STATE_VERSION,
    groups: [
      {
        version: HYSTERIA2_CLUSTER_STATE_VERSION,
        id: 'group-a',
        domain: 'a.example.com',
        email: 'admin@example.com',
        nodeIds: ['node-a', 'node-b'],
        coordinatorNodeId: 'node-b',
        certificateFingerprint: 'fingerprint-a',
        certificateNotAfter: '2026-12-20T00:00:00.000Z',
        lastRenewalAt: '2026-09-20T00:00:00.000Z',
        createdAt: CREATED_AT,
        updatedAt: CREATED_AT,
      },
      {
        version: HYSTERIA2_CLUSTER_STATE_VERSION,
        id: 'group-b',
        domain: 'b.example.com',
        email: 'ops@example.com',
        nodeIds: ['node-c'],
        coordinatorNodeId: 'node-c',
        createdAt: CREATED_AT,
        updatedAt: CREATED_AT,
      },
    ],
  };
}

describe('Hysteria2 cluster state utilities', () => {
  it('canonicalizes, deduplicates and numerically sorts IPv4 and IPv6', () => {
    expect(normalizeIpAddress('[2001:0DB8:0:0:0:0:0:1]')).toBe('2001:db8::1');
    expect(normalizeIpAddress('::FFFF:192.0.2.128')).toBe('::ffff:c000:280');
    expect(
      normalizeAndSortIpAddresses([
        '2001:db8::10',
        '192.0.2.10',
        '192.0.2.2',
        '2001:0db8::2',
        '192.0.2.2',
      ]),
    ).toEqual(['192.0.2.2', '192.0.2.10', '2001:db8::2', '2001:db8::10']);

    expectStateError(
      () => normalizeIpAddress('192.0.002.1'),
      'invalid_ip_address',
    );
    expectStateError(
      () => normalizeIpAddress('fe80::1%eth0'),
      'invalid_ip_address',
    );
  });

  it('requires the complete A and AAAA set to equal selected node endpoints', () => {
    const result = validateHysteria2ClusterDns({
      domain: 'balancer.example.com',
      resolvedIpv4: ['192.0.2.10', '192.0.2.2', '192.0.2.10'],
      resolvedIpv6: ['2001:0db8::1'],
      nodes: [
        { nodeId: 'node-v6', address: '[2001:db8:0:0::1]' },
        { nodeId: 'node-10', address: '192.0.2.10' },
        { nodeId: 'node-2', address: '192.0.2.2' },
      ],
    });

    expect(result.resolvedIpv4).toEqual(['192.0.2.2', '192.0.2.10']);
    expect(result.resolvedIpv6).toEqual(['2001:db8::1']);
    expect(result.nodeAddresses).toEqual([
      '192.0.2.2',
      '192.0.2.10',
      '2001:db8::1',
    ]);
    expect(result.nodes.map((node) => node.nodeId)).toEqual([
      'node-10',
      'node-2',
      'node-v6',
    ]);
  });

  it('reports uncovered DNS addresses and selected addresses absent from DNS', () => {
    try {
      validateHysteria2ClusterDns({
        domain: 'balancer.example.com',
        resolvedIpv4: ['192.0.2.1', '192.0.2.2'],
        resolvedIpv6: ['2001:db8::1'],
        nodes: [
          { nodeId: 'node-a', address: '192.0.2.1' },
          { nodeId: 'node-x', address: '192.0.2.99' },
        ],
      });
      throw new Error('Expected DNS mismatch');
    } catch (error) {
      expect(error).toMatchObject({
        code: 'dns_node_mismatch',
        details: {
          uncoveredDnsAddresses: ['192.0.2.2', '2001:db8::1'],
          nonDnsNodeAddresses: ['192.0.2.99'],
        },
      });
    }
  });

  it('rejects wrong DNS families and ambiguous selected endpoints', () => {
    expectStateError(
      () =>
        validateHysteria2ClusterDns({
          domain: 'balancer.example.com',
          resolvedIpv4: ['2001:db8::1'],
          nodes: [{ nodeId: 'node-a', address: '2001:db8::1' }],
        }),
      'invalid_dns_family',
    );
    expectStateError(
      () =>
        validateHysteria2ClusterDns({
          domain: 'balancer.example.com',
          resolvedIpv4: ['192.0.2.1'],
          nodes: [
            { nodeId: 'node-a', address: '192.0.2.1' },
            { nodeId: 'node-b', address: '192.0.2.1' },
          ],
        }),
      'duplicate_node_endpoint',
    );
  });

  it('validates unambiguous lowercase domains and safe email dot-atoms', () => {
    expect(normalizeHysteriaDomain('vpn.xn--e1afmkfd.example')).toBe(
      'vpn.xn--e1afmkfd.example',
    );
    expect(normalizeHysteriaEmail('admin+acme@example.com')).toBe(
      'admin+acme@example.com',
    );

    for (const domain of [
      'VPN.example.com',
      '*.example.com',
      'https://vpn.example.com',
      'vpn.example.com.',
      '192.0.2.1',
    ]) {
      expectStateError(() => normalizeHysteriaDomain(domain), 'invalid_domain');
    }
    for (const email of [
      'admin..acme@example.com',
      'admin$path@example.com',
      'admin@Example.com',
    ]) {
      expectStateError(() => normalizeHysteriaEmail(email), 'invalid_email');
    }
  });

  it('chooses a deterministic coordinator for a new selection', () => {
    expect(
      chooseHysteriaCoordinator(['node-z', 'node-a', 'node-m', 'node-a']),
    ).toBe('node-a');
    expectStateError(
      () => chooseHysteriaCoordinator([]),
      'empty_node_selection',
    );
  });

  it('creates and idempotently updates setup groups while keeping a live coordinator', () => {
    const empty = createEmptyHysteria2ClusterState();
    const created = upsertHysteria2SetupGroup(empty, {
      groupId: 'group-main',
      domain: 'vpn.example.com',
      email: 'admin@example.com',
      nodeIds: ['node-c', 'node-b'],
      now: CREATED_AT,
    });

    expect(created.created).toBe(true);
    expect(created.group).toMatchObject({
      id: 'group-main',
      nodeIds: ['node-b', 'node-c'],
      coordinatorNodeId: 'node-b',
      createdAt: CREATED_AT,
    });
    expect(empty.groups).toEqual([]);

    const expanded = upsertHysteria2SetupGroup(created.state, {
      domain: 'vpn.example.com',
      email: 'new-admin@example.com',
      nodeIds: ['node-a', 'node-b', 'node-c'],
      now: UPDATED_AT,
    });
    expect(expanded.created).toBe(false);
    expect(expanded.group.coordinatorNodeId).toBe('node-b');
    expect(expanded.group.email).toBe('new-admin@example.com');

    const withoutCoordinator = upsertHysteria2SetupGroup(expanded.state, {
      groupId: 'group-main',
      domain: 'vpn.example.com',
      email: 'new-admin@example.com',
      nodeIds: ['node-a', 'node-c'],
      now: '2026-09-21T12:00:00Z',
    });
    expect(withoutCoordinator.group.coordinatorNodeId).toBe('node-a');
  });

  it('enforces one cluster per node and requires reconfigure for domain changes', () => {
    const state = stateWithTwoGroups();
    expectStateError(
      () =>
        upsertHysteria2SetupGroup(state, {
          groupId: 'group-new',
          domain: 'new.example.com',
          email: 'admin@example.com',
          nodeIds: ['node-b', 'node-z'],
          now: UPDATED_AT,
        }),
      'setup_requires_reconfigure',
    );
    expectStateError(
      () =>
        upsertHysteria2SetupGroup(state, {
          domain: 'a.example.com',
          email: 'admin@example.com',
          nodeIds: ['node-a', 'node-c'],
          now: UPDATED_AT,
        }),
      'group_conflict',
    );
  });

  it('reconfigures exactly one complete group and clears old-domain certificate metadata', () => {
    const state = stateWithTwoGroups();
    const changed = upsertHysteria2ReconfigureGroup(state, {
      newDomain: 'new.example.com',
      email: 'new-admin@example.com',
      nodeIds: ['node-b', 'node-a'],
      now: UPDATED_AT,
    });

    expect(changed.group).toMatchObject({
      id: 'group-a',
      domain: 'new.example.com',
      previousDomain: 'a.example.com',
      email: 'new-admin@example.com',
      coordinatorNodeId: 'node-b',
    });
    expect(changed.group.certificateFingerprint).toBeUndefined();
    expect(changed.group.certificateNotAfter).toBeUndefined();
    expect(changed.group.lastRenewalAt).toBeUndefined();

    const repeated = upsertHysteria2ReconfigureGroup(changed.state, {
      groupId: 'group-a',
      newDomain: 'new.example.com',
      email: 'new-admin@example.com',
      nodeIds: ['node-a', 'node-b'],
      now: '2026-09-21T12:00:00Z',
    });
    expect(repeated.group.previousDomain).toBe('a.example.com');

    expectStateError(
      () =>
        upsertHysteria2ReconfigureGroup(changed.state, {
          groupId: 'group-a',
          newDomain: 'new.example.com',
          email: 'not-an-email',
          nodeIds: ['node-a', 'node-b'],
          now: '2026-09-21T12:00:00Z',
        }),
      'invalid_email',
    );
  });

  it('preserves certificate metadata for an idempotent same-domain reconfigure', () => {
    const unchanged = upsertHysteria2ReconfigureGroup(stateWithTwoGroups(), {
      groupId: 'group-a',
      newDomain: 'a.example.com',
      email: 'new-admin@example.com',
      nodeIds: ['node-a', 'node-b'],
      now: UPDATED_AT,
    });

    expect(unchanged.group).toMatchObject({
      email: 'new-admin@example.com',
      certificateFingerprint: 'fingerprint-a',
      certificateNotAfter: '2026-12-20T00:00:00.000Z',
      lastRenewalAt: '2026-09-20T00:00:00.000Z',
    });
    expect(unchanged.group.previousDomain).toBeUndefined();
  });

  it('rejects partial, missing and conflicting reconfigure targets', () => {
    const state = stateWithTwoGroups();
    expectStateError(
      () =>
        upsertHysteria2ReconfigureGroup(state, {
          groupId: 'group-a',
          newDomain: 'new.example.com',
          email: 'admin@example.com',
          nodeIds: ['node-a'],
          now: UPDATED_AT,
        }),
      'partial_group_selection',
    );
    expectStateError(
      () =>
        upsertHysteria2ReconfigureGroup(state, {
          groupId: 'missing',
          newDomain: 'new.example.com',
          email: 'admin@example.com',
          nodeIds: ['node-a', 'node-b'],
          now: UPDATED_AT,
        }),
      'group_not_found',
    );
    expectStateError(
      () =>
        upsertHysteria2ReconfigureGroup(state, {
          groupId: 'group-a',
          newDomain: 'b.example.com',
          email: 'admin@example.com',
          nodeIds: ['node-a', 'node-b'],
          now: UPDATED_AT,
        }),
      'group_conflict',
    );
  });
});
