import {
  buildHysteria2ClusterCaddyPrepareScript,
  buildHysteria2ClusterCertificateDeployScript,
  buildHysteria2ClusterProbeScript,
} from './hysteria2-cluster-script';

function assignment(script: string, name: string): string {
  const match = script.match(new RegExp(`^${name}='([^']*)'$`, 'm'));
  if (!match) throw new Error(`Assignment ${name} was not found`);
  return match[1];
}

function decodedAssignment(script: string, name: string): string {
  return Buffer.from(assignment(script, name), 'base64').toString('utf8');
}

const certificatePem = `-----BEGIN CERTIFICATE-----
MA==
-----END CERTIFICATE-----
`;
const privateKeyPem = `-----BEGIN PRIVATE KEY-----
MA==
-----END PRIVATE KEY-----
`;

describe('Hysteria2 cluster shell builders', () => {
  it('builds a transactional coordinator Caddy route with a local webroot', () => {
    const script = buildHysteria2ClusterCaddyPrepareScript({
      domain: 'edge.example.com',
      role: 'coordinator',
    });
    const inner = decodedAssignment(script, 'INNER_FRAGMENT_B64');
    const site = decodedAssignment(script, 'SITE_FRAGMENT_B64');

    expect(inner).toContain(
      '# BEGIN RWM HYSTERIA CLUSTER ACME: edge.example.com',
    );
    expect(inner).toContain('root * /var/www/html');
    expect(inner).toContain('file_server');
    expect(inner).not.toContain('reverse_proxy');
    expect(site).toContain('http://edge.example.com');
    expect(site).toContain('respond 404');
    expect(site).not.toMatch(/handle \{\s*\}/);
    expect(script).toContain('cat "$BACKUP" > "$CADDY_FILE"');
    expect(script).toContain('caddy validate --config /etc/caddy/Caddyfile');
    expect(script).toContain('if ! cmp -s "$CANDIDATE" "$CADDY_FILE"');
    expect(script).toContain('COMMITTED=1');
  });

  it('builds a one-hop follower route to a literal IPv4 coordinator', () => {
    const script = buildHysteria2ClusterCaddyPrepareScript({
      domain: 'edge.example.com',
      role: 'follower',
      coordinatorAddress: '192.0.2.10',
    });
    const inner = decodedAssignment(script, 'INNER_FRAGMENT_B64');

    expect(inner).toContain('reverse_proxy 192.0.2.10:80');
    expect(inner).toContain('header_up Host edge.example.com');
    expect(inner).toContain('header_up X-RWM-ACME-Hop "1"');
    expect(inner).toContain('header X-RWM-ACME-Hop *');
    expect(inner).toContain('respond 508');
    expect(inner.indexOf('respond 508')).toBeLessThan(
      inner.indexOf('reverse_proxy'),
    );
  });

  it('brackets a literal IPv6 coordinator upstream', () => {
    const script = buildHysteria2ClusterCaddyPrepareScript({
      domain: 'edge.example.com',
      role: 'follower',
      coordinatorAddress: '2001:db8::10',
    });

    expect(decodedAssignment(script, 'INNER_FRAGMENT_B64')).toContain(
      'reverse_proxy [2001:db8::10]:80',
    );
  });

  it('builds a cluster barrier probe with deduplicated IPv4 and IPv6 endpoints', () => {
    const script = buildHysteria2ClusterProbeScript({
      domain: 'edge.example.com',
      addresses: ['192.0.2.10', '2001:db8::10', '192.0.2.10'],
    });

    expect(script).toContain("ADDRESSES=('192.0.2.10' '2001:db8::10')");
    expect(script).toContain("--noproxy '*'");
    expect(script).toContain('--resolve "$DOMAIN:80:$resolve_address"');
    expect(script).toContain('resolve_address="[$address]"');
    expect(script).toContain('[ "$response" = "$PROBE_BODY" ]');
    expect(script).toContain('rm -f -- "$PROBE_FILE"');
  });

  it('builds a validating, transactional and idempotent follower deploy', () => {
    const script = buildHysteria2ClusterCertificateDeployScript({
      domain: 'edge.example.com',
      fullchainBase64: Buffer.from(certificatePem).toString('base64'),
      privateKeyBase64: Buffer.from(privateKeyPem).toString('base64'),
    });

    expect(script).toContain('certificate_has_exact_dns_san');
    expect(script).toContain('-checkhost "$DOMAIN"');
    expect(script).toContain('-checkend 86400');
    expect(script).toContain('Private key не соответствует сертификату');
    expect(script).toContain('CERT_CHANGED=0');
    expect(script).toContain('COMPOSE_CHANGED=0');
    expect(script).toContain('LIVE_MOUNT_OK=0');
    expect(script).toContain('PENDING_RESTART=0');
    expect(script).toContain('Сертификат и read-only mount уже актуальны');
    expect(script).toContain('/opt/hysteria2-certs/current:/etc/hysteria2:ro');
    expect(script).toContain('.RW == false');
    expect(script).toContain('restore_previous_state');
    expect(script).toContain('rm -f -- "$CRON_FILE"');
    expect(script).toContain('configure_follower_caddy');
    expect(script).toContain('./certs:/etc/caddy/certs:ro');
    expect(script).toContain('tls = f');
    expect(script).toContain('/etc/caddy/certs/{domain}.crt');
    expect(script).toContain('docker compose -f "$caddy_compose" up -d --force-recreate caddy');
  });

  it('rejects unsafe domains, non-literal coordinators and malformed payloads', () => {
    expect(() =>
      buildHysteria2ClusterCaddyPrepareScript({
        domain: 'edge.example.com;id',
        role: 'coordinator',
      }),
    ).toThrow(/Некорректный домен/);
    expect(() =>
      buildHysteria2ClusterCaddyPrepareScript({
        domain: 'edge.example.com',
        role: 'follower',
        coordinatorAddress: 'coordinator.example.com',
      }),
    ).toThrow(/literal IPv4 или IPv6/);
    expect(() =>
      buildHysteria2ClusterProbeScript({
        domain: 'edge.example.com',
        addresses: [],
      }),
    ).toThrow(/пуст или слишком велик/);
    expect(() =>
      buildHysteria2ClusterCertificateDeployScript({
        domain: 'edge.example.com',
        fullchainBase64: 'not-base64',
        privateKeyBase64: Buffer.from(privateKeyPem).toString('base64'),
      }),
    ).toThrow(/некорректный base64/);
  });
});
