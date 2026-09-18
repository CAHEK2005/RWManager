import { ScriptsService } from './scripts.service';
import {
  WARP_NATIVE_SCRIPT_ID,
  WARP_NATIVE_SETUP_SCRIPT,
  WARP_NATIVE_STATUS_SCRIPT,
  WARP_NATIVE_STATUS_SCRIPT_ID,
} from './warp-native-script';

describe('WARP Native built-in scripts', () => {
  function createService() {
    const rows = new Map<string, string>();
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
    const service = new ScriptsService(
      repo as never,
      { notifyScriptExecution: jest.fn() } as never,
      { getValue: jest.fn(), create: jest.fn(), update: jest.fn() } as never,
    );
    return { service, repo };
  }

  it('seeds setup and status once without replacing the legacy warp-cli scripts', async () => {
    const { service, repo } = createService();
    await service.onModuleInit();
    const initialSaveCount = repo.save.mock.calls.length;
    await service.onModuleInit();

    const scripts = await service.getScripts();
    const setup = scripts.filter(
      (script) => script.id === WARP_NATIVE_SCRIPT_ID,
    );
    const status = scripts.filter(
      (script) => script.id === WARP_NATIVE_STATUS_SCRIPT_ID,
    );

    expect(setup).toHaveLength(1);
    expect(setup[0]).toMatchObject({
      isBuiltIn: true,
      content: WARP_NATIVE_SETUP_SCRIPT,
    });
    expect(status).toHaveLength(1);
    expect(status[0]).toMatchObject({
      isBuiltIn: true,
      content: WARP_NATIVE_STATUS_SCRIPT,
    });
    expect(scripts.map((script) => script.id)).toContain('builtin-setup-warp');
    expect(scripts.map((script) => script.id)).toContain('builtin-warp-status');
    expect(repo.save).toHaveBeenCalledTimes(initialSaveCount);
  });

  it('requires no UI variables and uses the native WireGuard interface', () => {
    expect(WARP_NATIVE_SETUP_SCRIPT).not.toMatch(/\{\{\s*\w+/);
    expect(WARP_NATIVE_SETUP_SCRIPT).not.toContain('warp-cli');
    expect(WARP_NATIVE_SETUP_SCRIPT).toContain('wg-quick@warp');
    expect(WARP_NATIVE_SETUP_SCRIPT).toContain('wg show warp');
    expect(WARP_NATIVE_STATUS_SCRIPT).toContain('wg show warp');
    expect(WARP_NATIVE_STATUS_SCRIPT).not.toContain('warp-cli');
  });

  it('downloads a pinned installer and verifies its SHA-256 before execution', () => {
    const url =
      'https://raw.githubusercontent.com/distillium/warp-native/bc31dadd048d89031350cdbeadf325a249f3cfd7/install.sh';
    const sha256 =
      'eb5cacdd9752c74b34b58d853b8bdf95c7d11be60b8fdc6bb7ace7b3cd5ec963';

    expect(WARP_NATIVE_SETUP_SCRIPT).toContain(url);
    expect(WARP_NATIVE_SETUP_SCRIPT).toContain(sha256);
    expect(WARP_NATIVE_SETUP_SCRIPT).toContain('sha256sum --check --status');
    expect(WARP_NATIVE_SETUP_SCRIPT).not.toContain('/main/install.sh');
    expect(WARP_NATIVE_SETUP_SCRIPT.indexOf(url)).toBeLessThan(
      WARP_NATIVE_SETUP_SCRIPT.indexOf('sha256sum --check --status'),
    );
    expect(
      WARP_NATIVE_SETUP_SCRIPT.indexOf('sha256sum --check --status'),
    ).toBeLessThan(WARP_NATIVE_SETUP_SCRIPT.indexOf('bash "$installer"'));
  });

  it('answers all three upstream prompts without interactive input', () => {
    expect(WARP_NATIVE_SETUP_SCRIPT).toMatch(
      /timeout [^\n]*bash "\$installer" <<'WARP_NATIVE_INPUT'\r?\n2\r?\n\r?\n\r?\nWARP_NATIVE_INPUT/,
    );
    expect(WARP_NATIVE_SETUP_SCRIPT).not.toContain('read -p');
    expect(WARP_NATIVE_SETUP_SCRIPT).not.toContain('bash <(curl');
  });
});
