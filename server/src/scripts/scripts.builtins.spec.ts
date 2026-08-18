import { ScriptsService, type Script } from './scripts.service';
import {
  HYSTERIA2_CADDY_HELPER_SCRIPT,
  HYSTERIA2_DEPLOY_SCRIPT,
  HYSTERIA2_RENEW_SCRIPT,
  HYSTERIA2_SCRIPT_ID,
} from './hysteria2-script';

describe('ScriptsService built-in scripts', () => {
  function createRepo(initial: Record<string, string> = {}) {
    const rows = new Map(Object.entries(initial));
    const repo = {
      findOne: jest.fn(({ where: { key } }: { where: { key: string } }) => {
        const value = rows.get(key);
        return Promise.resolve(value === undefined ? null : { key, value });
      }),
      save: jest.fn(({ key, value }: { key: string; value: string }) => {
        rows.set(key, value);
        return Promise.resolve({ key, value });
      }),
      create: jest.fn((value: { key: string }) => value),
    };
    return { repo, rows };
  }

  function createService(initial: Record<string, string> = {}) {
    const { repo, rows } = createRepo(initial);
    const service = new ScriptsService(
      repo as never,
      { notifyScriptExecution: jest.fn() } as never,
      {
        getValue: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      } as never,
    );
    return { service, repo, rows };
  }

  async function seedHysteria2Script(service: ScriptsService) {
    await service.onModuleInit();
    const script = (await service.getScripts()).find(
      (item) => item.id === HYSTERIA2_SCRIPT_ID,
    );
    if (!script) throw new Error('Hysteria2 built-in was not seeded');
    return script;
  }

  it('seeds one idempotent Hysteria2 setup script', async () => {
    const { service, repo } = createService();

    const script = await seedHysteria2Script(service);
    const firstSaveCount = repo.save.mock.calls.length;
    await service.onModuleInit();
    const scripts = await service.getScripts();

    expect(script).toMatchObject({
      id: HYSTERIA2_SCRIPT_ID,
      name: 'Настройка Hysteria2',
      isBuiltIn: true,
    });
    expect(
      scripts.filter((item) => item.id === HYSTERIA2_SCRIPT_ID),
    ).toHaveLength(1);
    expect(repo.save).toHaveBeenCalledTimes(firstSaveCount);
  });

  it('declares the expected variables and provisioning invariants', async () => {
    const { service } = createService();
    const script = await seedHysteria2Script(service);
    const variableRegex = /\{\{\s*(\w+)(?:\s*\|\s*([^}]*?))?\s*\}\}/g;
    const variables = [...script.content.matchAll(variableRegex)].map(
      (match) => match[1],
    );

    expect(variables).toEqual(['hysteria_domain', 'certbot_email']);
    expect(script.content).toContain('certbot certonly');
    expect(script.content).toContain('--webroot');
    expect(script.content).toContain('--webroot-path /var/www/certbot');
    expect(script.content).toContain(
      '--resolve "$HYSTERIA_DOMAIN:80:127.0.0.1"',
    );
    expect(script.content).toContain(
      '/opt/hysteria2-certs/current:/etc/hysteria2:ro',
    );
    expect(script.content).not.toContain(
      '/opt/certbot/certs:/etc/letsencrypt:ro',
    );
    expect(script.content).toContain('docker-compose.override.yml');
    expect(script.content).toContain('certbot reconfigure');
    expect(script.content).toContain('--authenticator webroot');
    expect(script.content).toContain(
      'backup_file "$CERTBOT_RENEWAL_CONF" certbot-renewal-conf',
    );
    expect(script.content).toContain(
      'cp -p "$STAGE_DIR/backup-certbot-renewal-conf" "$CERTBOT_RENEWAL_CONF"',
    );
    expect(HYSTERIA2_RENEW_SCRIPT).toContain(
      'renew --quiet --cert-name "$HYSTERIA_DOMAIN"',
    );
    expect(HYSTERIA2_RENEW_SCRIPT).toContain('ensure-caddy-webroot.sh');
    expect(
      HYSTERIA2_RENEW_SCRIPT.indexOf('ensure-caddy-webroot.sh'),
    ).toBeLessThan(HYSTERIA2_RENEW_SCRIPT.indexOf('renew --quiet'));
    expect(HYSTERIA2_DEPLOY_SCRIPT).toContain(
      'DEPLOY_DIR="${HYSTERIA_DEPLOY_DIR:-/opt/hysteria2-certs}"',
    );
    expect(HYSTERIA2_DEPLOY_SCRIPT).toContain('cmp -s');
    expect(HYSTERIA2_DEPLOY_SCRIPT).toContain(
      'mv -Tf "$CURRENT_LINK_TMP" "$CURRENT_LINK"',
    );
    expect(HYSTERIA2_DEPLOY_SCRIPT).toContain('touch "$RESTART_MARKER"');
    expect(
      HYSTERIA2_DEPLOY_SCRIPT.indexOf('touch "$RESTART_MARKER"'),
    ).toBeLessThan(
      HYSTERIA2_DEPLOY_SCRIPT.indexOf(
        'mv -Tf "$CURRENT_LINK_TMP" "$CURRENT_LINK"',
      ),
    );
    expect(HYSTERIA2_DEPLOY_SCRIPT).toContain('CERT_PUBLIC_KEY=$(');
    expect(script.content).toContain('--dry-run');
    expect(script.content).toContain('--no-directory-hooks');
    expect(script.content).toContain('PENDING_RESTART=1');
    expect(HYSTERIA2_CADDY_HELPER_SCRIPT).toContain(
      'cat "$CADDY_TMP" > "$CADDY_FILE"',
    );
    expect(script.content).toContain('17 3,15 * * * root');
    expect(script.content).not.toContain('docker compose stop caddy');
    expect(script.content).toContain('if ! PRUNE_GENERATIONS=1');
    expect(script.content.lastIndexOf('TRANSACTION_ACTIVE=0')).toBeLessThan(
      script.content.indexOf('if ! PRUNE_GENERATIONS=1'),
    );

    const rendered = (
      service as unknown as {
        renderScript(target: Script, variables: Record<string, string>): string;
      }
    ).renderScript(script, {
      hysteria_domain: 'vpn.example.com',
      certbot_email: 'admin+acme@example.com',
    });
    expect(rendered).toContain('HYSTERIA_DOMAIN="vpn.example.com"');
    expect(rendered).toContain('CERTBOT_EMAIL="admin+acme@example.com"');
  });

  it('bounds the Certbot dry-run and keeps Docker Compose non-interactive', async () => {
    const { service } = createService();
    const script = await seedHysteria2Script(service);
    const dryRunStart = script.content.indexOf(
      'if [ "$RENEWAL_TESTED" -eq 0 ]; then',
    );
    const dryRunEnd = script.content.indexOf('\nfi', dryRunStart);

    expect(dryRunStart).toBeGreaterThanOrEqual(0);
    expect(dryRunEnd).toBeGreaterThan(dryRunStart);

    const dryRunBlock = script.content.slice(dryRunStart, dryRunEnd);
    expect(dryRunBlock).toContain('timeout ');
    expect(dryRunBlock).toContain('--progress plain');
    expect(dryRunBlock).toContain('run --rm -T certbot renew');
    expect(dryRunBlock).toContain('--dry-run');
    expect(dryRunBlock).toContain('--no-random-sleep-on-renew');
    expect(dryRunBlock).toContain('</dev/null');
    expect(dryRunBlock).toContain('5 минут');
    expect(dryRunBlock.indexOf('timeout ')).toBeLessThan(
      dryRunBlock.indexOf('docker compose'),
    );
    expect(dryRunBlock.indexOf('docker compose')).toBeLessThan(
      dryRunBlock.indexOf('run --rm -T certbot renew'),
    );
    expect(script.content).toContain('down --remove-orphans --timeout 10');
  });

  it('rejects unsafe per-node values before starting a script job', async () => {
    const { service, rows } = createService();
    await seedHysteria2Script(service);
    rows.set(
      'ssh_nodes',
      JSON.stringify([
        {
          id: 'node-1',
          name: 'node-1',
          ip: '192.0.2.10',
          authType: 'password',
          password: 'test',
        },
      ]),
    );

    await expect(
      service.executeScript(HYSTERIA2_SCRIPT_ID, ['node-1'], undefined, {
        'node-1': {
          hysteria_domain: 'vpn.example.com$(id)',
          certbot_email: 'admin@example.com',
        },
      }),
    ).rejects.toThrow('Некорректный домен Hysteria2');
  });

  it('rejects ambiguous domain casing and invalid email dot-atoms', async () => {
    const { service } = createService();
    const script = await seedHysteria2Script(service);
    const renderable = service as unknown as {
      renderScript(target: Script, variables: Record<string, string>): string;
    };

    expect(() =>
      renderable.renderScript(script, {
        hysteria_domain: 'VPN.example.com',
        certbot_email: 'admin@example.com',
      }),
    ).toThrow('Некорректный домен Hysteria2');
    expect(() =>
      renderable.renderScript(script, {
        hysteria_domain: 'vpn.example.com',
        certbot_email: 'admin..acme@example.com',
      }),
    ).toThrow("Некорректный email для Let's Encrypt");
    expect(() =>
      renderable.renderScript(script, {
        hysteria_domain: 'vpn.example.com',
        certbot_email: 'admin$PATH@example.com',
      }),
    ).toThrow("Некорректный email для Let's Encrypt");
  });

  it('rejects unsafe per-node values before starting a script sequence', async () => {
    const { service, rows } = createService();
    await seedHysteria2Script(service);
    rows.set(
      'ssh_nodes',
      JSON.stringify([
        {
          id: 'node-1',
          name: 'node-1',
          ip: '192.0.2.10',
          authType: 'password',
          password: 'test',
        },
      ]),
    );

    await expect(
      service.executeSequence(
        [HYSTERIA2_SCRIPT_ID],
        ['node-1'],
        {},
        {
          [HYSTERIA2_SCRIPT_ID]: {
            'node-1': {
              hysteria_domain: 'vpn.example.com',
              certbot_email: 'admin@example.com\n$(id)',
            },
          },
        },
      ),
    ).rejects.toThrow("Некорректный email для Let's Encrypt");
  });

  it('merges global variables with partial per-node overrides', async () => {
    const { service, rows } = createService();
    await seedHysteria2Script(service);
    rows.set(
      'ssh_nodes',
      JSON.stringify([
        {
          id: 'node-1',
          name: 'node-1',
          ip: '192.0.2.10',
          authType: 'password',
          password: 'test',
        },
      ]),
    );
    const runner = jest
      .spyOn(
        service as unknown as {
          runScriptOnNode(
            node: unknown,
            content: string,
            result: unknown,
            mask: string[],
          ): Promise<void>;
        },
        'runScriptOnNode',
      )
      .mockImplementation(() => new Promise<void>(() => undefined));

    await service.executeScript(
      HYSTERIA2_SCRIPT_ID,
      ['node-1'],
      {
        hysteria_domain: 'global.example.com',
        certbot_email: 'global@example.com',
      },
      {
        'node-1': {
          hysteria_domain: 'node.example.com',
        },
      },
    );

    expect(runner).toHaveBeenCalledTimes(1);
    const rendered = runner.mock.calls[0][1];
    expect(rendered).toContain('HYSTERIA_DOMAIN="node.example.com"');
    expect(rendered).toContain('CERTBOT_EMAIL="global@example.com"');
    expect(rendered).not.toContain('{{ hysteria_domain');
    expect(rendered).not.toContain('{{ certbot_email');
  });

  it('merges per-script variables with partial per-node sequence overrides', async () => {
    const { service, rows } = createService();
    await seedHysteria2Script(service);
    rows.set(
      'ssh_nodes',
      JSON.stringify([
        {
          id: 'node-1',
          name: 'node-1',
          ip: '192.0.2.10',
          authType: 'password',
          password: 'test',
        },
      ]),
    );
    const runner = jest
      .spyOn(
        service as unknown as {
          runScriptOnNode(
            node: unknown,
            content: string,
            result: unknown,
            mask: string[],
          ): Promise<void>;
        },
        'runScriptOnNode',
      )
      .mockImplementation(() => new Promise<void>(() => undefined));

    await service.executeSequence(
      [HYSTERIA2_SCRIPT_ID],
      ['node-1'],
      {
        [HYSTERIA2_SCRIPT_ID]: {
          hysteria_domain: 'global.example.com',
          certbot_email: 'global@example.com',
        },
      },
      {
        [HYSTERIA2_SCRIPT_ID]: {
          'node-1': {
            certbot_email: 'node@example.com',
          },
        },
      },
    );

    expect(runner).toHaveBeenCalledTimes(1);
    const rendered = runner.mock.calls[0][1];
    expect(rendered).toContain('HYSTERIA_DOMAIN="global.example.com"');
    expect(rendered).toContain('CERTBOT_EMAIL="node@example.com"');
    expect(rendered).not.toContain('{{ hysteria_domain');
    expect(rendered).not.toContain('{{ certbot_email');
  });
});
