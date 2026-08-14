import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { HYSTERIA2_DEPLOY_SCRIPT } from './hysteria2-script';

interface DeployFixture {
  certSource: string;
  currentLink: string;
  deployDir: string;
  dockerLog: string;
  dockerState: string;
  envFile: string;
  fakeBin: string;
  generationsDir: string;
  marker: string;
  mvLog: string;
  remnanodeDir: string;
  root: string;
  scriptFile: string;
}

interface DeployResult {
  status: number | null;
  stderr: string;
  stdout: string;
}

const roots: string[] = [];

function shellPath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const drive = normalized.match(/^([A-Za-z]):\/(.*)$/);
  return drive ? `/mnt/${drive[1].toLowerCase()}/${drive[2]}` : normalized;
}

function bashInvocation(
  scriptFile: string,
  variables: Record<string, string>,
): {
  args: string[];
  executable: string;
} {
  if (process.platform !== 'win32') {
    return {
      args: [scriptFile],
      executable: process.env.BASH || 'bash',
    };
  }

  const wsl = join(
    process.env.SystemRoot || 'C:\\Windows',
    'System32',
    'wsl.exe',
  );
  if (!existsSync(wsl)) {
    throw new Error(
      'WSL2 is required to execute this Linux deploy-script test on Windows',
    );
  }
  return {
    args: [
      'env',
      ...Object.entries(variables).map(([name, value]) => `${name}=${value}`),
      'bash',
      shellPath(scriptFile),
    ],
    executable: wsl,
  };
}

function writeExecutable(filePath: string, content: string): void {
  writeFileSync(filePath, content, 'utf8');
  chmodSync(filePath, 0o755);
}

function createFixture(): DeployFixture {
  const root = mkdtempSync(join(tmpdir(), 'rwm-hysteria2-deploy-'));
  roots.push(root);
  const fakeBin = join(root, 'fake-bin');
  const certSource = join(root, 'cert-source');
  const deployDir = join(root, 'deploy');
  const generationsDir = join(deployDir, 'generations');
  const remnanodeDir = join(root, 'remnanode');
  const envFile = join(root, 'hysteria2.env');
  const marker = join(root, 'restart-required');
  const dockerLog = join(root, 'docker.log');
  const dockerState = join(root, 'docker.state');
  const mvLog = join(root, 'mv.log');
  const scriptFile = join(root, 'deploy.sh');

  mkdirSync(fakeBin, { recursive: true });
  mkdirSync(certSource, { recursive: true });
  mkdirSync(generationsDir, { recursive: true });
  mkdirSync(remnanodeDir, { recursive: true });
  writeFileSync(envFile, 'HYSTERIA_DOMAIN=vpn.example.com\n', 'utf8');

  writeExecutable(
    join(fakeBin, 'openssl'),
    `#!/usr/bin/env bash
set -Eeuo pipefail
if [ "\${1:-}" = "x509" ] && [[ " $* " == *" -checkend "* ]]; then
  exit 0
fi
if [ "\${1:-}" = "x509" ] && [[ " $* " == *" -pubkey "* ]]; then
  printf 'fixture-public-key'
  exit 0
fi
if [ "\${1:-}" = "pkey" ] && [[ " $* " == *" -pubin "* ]]; then
  cat >/dev/null
  printf 'fixture-public-key'
  exit 0
fi
if [ "\${1:-}" = "pkey" ] && [[ " $* " == *" -pubout "* ]]; then
  printf 'fixture-public-key'
  exit 0
fi
exit 64
`,
  );
  writeExecutable(
    join(fakeBin, 'install'),
    `#!/usr/bin/env bash
set -Eeuo pipefail
directory=0
mode=''
while [ "$#" -gt 0 ]; do
  case "$1" in
    -d)
      directory=1
      shift
      ;;
    -m)
      mode="$2"
      shift 2
      ;;
    -o|-g)
      shift 2
      ;;
    --)
      shift
      break
      ;;
    -*)
      exit 64
      ;;
    *)
      break
      ;;
  esac
done

if [ "$directory" -eq 1 ]; then
  for target in "$@"; do
    mkdir -p "$target"
    [ -z "$mode" ] || chmod "$mode" "$target"
  done
  exit 0
fi

[ "$#" -eq 2 ] || exit 64
source_file="$1"
target_file="$2"
if [ "\${FAKE_INSTALL_FAIL_PRIVKEY:-0}" -eq 1 ] \\
  && [[ "$source_file" == */privkey.pem ]] \\
  && [[ "$target_file" == */.rwm-generation.*/privkey.pem ]]; then
  exit 71
fi
cp "$source_file" "$target_file"
[ -z "$mode" ] || chmod "$mode" "$target_file"
`,
  );
  writeExecutable(
    join(fakeBin, 'docker'),
    `#!/usr/bin/env bash
set -Eeuo pipefail
printf '%s\n' "$*" >> "$FAKE_DOCKER_LOG"
if [ "\${FAKE_DOCKER_FAIL_FIRST_UP:-0}" -eq 1 ] \\
  && [ "$*" = "compose up -d --force-recreate remnanode" ]; then
  up_count=0
  [ ! -f "$FAKE_DOCKER_STATE" ] || up_count=$(cat "$FAKE_DOCKER_STATE")
  up_count=$((up_count + 1))
  printf '%s\n' "$up_count" > "$FAKE_DOCKER_STATE"
  [ "$up_count" -ne 1 ] || exit 72
fi
`,
  );
  writeExecutable(
    join(fakeBin, 'mv'),
    `#!/usr/bin/env bash
set -Eeuo pipefail
printf '%s\n' "$*" >> "$FAKE_MV_LOG"
exec /usr/bin/mv "$@"
`,
  );

  const testPath = `${shellPath(fakeBin)}:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`;
  const runnableScript = HYSTERIA2_DEPLOY_SCRIPT.replace(
    'export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"',
    `export PATH="${testPath}"`,
  );
  writeExecutable(scriptFile, runnableScript);

  return {
    certSource,
    currentLink: join(deployDir, 'current'),
    deployDir,
    dockerLog,
    dockerState,
    envFile,
    fakeBin,
    generationsDir,
    marker,
    mvLog,
    remnanodeDir,
    root,
    scriptFile,
  };
}

function writeCertificatePair(directory: string, value: string): void {
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'fullchain.pem'), `cert-${value}\n`, 'utf8');
  writeFileSync(join(directory, 'privkey.pem'), `key-${value}\n`, 'utf8');
}

function addGeneration(
  fixture: DeployFixture,
  name: string,
  value: string,
): string {
  const generation = join(fixture.generationsDir, `.rwm-generation.${name}`);
  writeCertificatePair(generation, value);
  return generation;
}

function pointCurrentAt(fixture: DeployFixture, generation: string): void {
  symlinkSync(
    join('generations', basename(generation)),
    fixture.currentLink,
    'dir',
  );
}

function runDeploy(
  fixture: DeployFixture,
  options: {
    failFirstRecreate?: boolean;
    failPrivkey?: boolean;
    restart?: boolean;
  } = {},
): DeployResult {
  const deployEnvironment = {
    FAKE_DOCKER_LOG: shellPath(fixture.dockerLog),
    FAKE_DOCKER_FAIL_FIRST_UP: options.failFirstRecreate ? '1' : '0',
    FAKE_DOCKER_STATE: shellPath(fixture.dockerState),
    FAKE_INSTALL_FAIL_PRIVKEY: options.failPrivkey ? '1' : '0',
    FAKE_MV_LOG: shellPath(fixture.mvLog),
    HYSTERIA_CERT_SOURCE: shellPath(fixture.certSource),
    HYSTERIA_DEPLOY_DIR: shellPath(fixture.deployDir),
    HYSTERIA_ENV_FILE: shellPath(fixture.envFile),
    HYSTERIA_REMNANODE_DIR: shellPath(fixture.remnanodeDir),
    HYSTERIA_RESTART_MARKER: shellPath(fixture.marker),
    RESTART_REMNANODE: options.restart === false ? '0' : '1',
  };
  const invocation = bashInvocation(fixture.scriptFile, deployEnvironment);
  const result = spawnSync(invocation.executable, invocation.args, {
    cwd: fixture.root,
    encoding: 'utf8',
    env: {
      ...process.env,
      ...deployEnvironment,
    },
  });

  if (result.error) throw result.error;
  return {
    status: result.status,
    stderr: result.stderr,
    stdout: result.stdout,
  };
}

function generationNames(fixture: DeployFixture): string[] {
  return readdirSync(fixture.generationsDir)
    .filter((name) => name.startsWith('.rwm-generation.'))
    .sort();
}

afterEach(() => {
  while (roots.length > 0) {
    const root = roots.pop();
    const expectedPrefix = `${resolve(tmpdir())}${sep}rwm-hysteria2-deploy-`;
    if (!resolve(root).startsWith(expectedPrefix)) {
      throw new Error(`Refusing to clean unexpected fixture path: ${root}`);
    }
    if (process.platform === 'win32') {
      const cleanup = spawnSync(
        join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'wsl.exe'),
        ['rm', '-rf', '--', shellPath(root)],
        { encoding: 'utf8' },
      );
      if (!cleanup.error && cleanup.status === 0) continue;
    }
    rmSync(root, {
      force: true,
      maxRetries: 3,
      recursive: true,
      retryDelay: 50,
    });
  }
});

describe('HYSTERIA2_DEPLOY_SCRIPT runtime state transitions', () => {
  it('removes an incomplete generation and preserves current when privkey copy fails', () => {
    const fixture = createFixture();
    writeCertificatePair(fixture.certSource, 'new');
    const oldGeneration = addGeneration(fixture, 'old', 'old');
    pointCurrentAt(fixture, oldGeneration);

    const result = runDeploy(fixture, { failPrivkey: true, restart: false });

    expect(result.status).toBe(71);
    expect(result.stderr).toBe('');
    expect(realpathSync(fixture.currentLink)).toBe(realpathSync(oldGeneration));
    expect(generationNames(fixture)).toEqual(['.rwm-generation.old']);
    expect(existsSync(fixture.marker)).toBe(false);
  });

  it('atomically switches current and keeps only current plus previous', () => {
    const fixture = createFixture();
    writeCertificatePair(fixture.certSource, 'new');
    const staleA = addGeneration(fixture, 'stale-a', 'stale-a');
    const staleB = addGeneration(fixture, 'stale-b', 'stale-b');
    const previousGeneration = addGeneration(fixture, 'previous', 'old');
    const timestamp = Date.now() / 1000;
    utimesSync(staleA, timestamp - 300, timestamp - 300);
    utimesSync(staleB, timestamp - 200, timestamp - 200);
    utimesSync(previousGeneration, timestamp - 100, timestamp - 100);
    pointCurrentAt(fixture, previousGeneration);
    const previousGenerationReal = realpathSync(previousGeneration);

    const result = runDeploy(fixture);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('deploy_changed=1');
    expect(lstatSync(fixture.currentLink).isSymbolicLink()).toBe(true);
    const activeGeneration = realpathSync(fixture.currentLink);
    expect(activeGeneration).not.toBe(previousGenerationReal);
    expect(readFileSync(join(activeGeneration, 'fullchain.pem'), 'utf8')).toBe(
      'cert-new\n',
    );
    expect(generationNames(fixture)).toHaveLength(2);
    expect(generationNames(fixture)).toEqual(
      expect.arrayContaining([
        basename(activeGeneration),
        basename(previousGenerationReal),
      ]),
    );
    expect(readFileSync(fixture.mvLog, 'utf8')).toContain(
      `-Tf ${shellPath(fixture.deployDir)}/.current.`,
    );
    expect(readFileSync(fixture.dockerLog, 'utf8')).toContain(
      'compose up -d --force-recreate remnanode',
    );
    expect(readlinkSync(fixture.currentLink).replace(/\\/g, '/')).toContain(
      'generations/',
    );
  });

  it('restores previous current and retries recreate when the first recreate fails', () => {
    const fixture = createFixture();
    writeCertificatePair(fixture.certSource, 'new');
    const previousGeneration = addGeneration(fixture, 'previous', 'old');
    pointCurrentAt(fixture, previousGeneration);
    const previousGenerationReal = realpathSync(previousGeneration);

    const result = runDeploy(fixture, { failFirstRecreate: true });

    expect(result.status).toBe(72);
    expect(result.stderr).toContain('[ROLLBACK]');
    expect(realpathSync(fixture.currentLink)).toBe(previousGenerationReal);
    expect(existsSync(fixture.marker)).toBe(true);

    const dockerCalls = readFileSync(fixture.dockerLog, 'utf8')
      .trim()
      .split('\n');
    expect(
      dockerCalls.filter(
        (call) => call === 'compose up -d --force-recreate remnanode',
      ),
    ).toHaveLength(2);
    expect(
      dockerCalls.filter((call) =>
        call.startsWith(
          'compose exec -T --interactive=false remnanode test -r /etc/hysteria2/',
        ),
      ),
    ).toHaveLength(2);
    expect(
      readFileSync(fixture.mvLog, 'utf8')
        .trim()
        .split('\n')
        .filter((call) => call.startsWith('-Tf ')),
    ).toHaveLength(2);
  });

  it('does not create a generation or recreate remnanode for unchanged files', () => {
    const fixture = createFixture();
    writeCertificatePair(fixture.certSource, 'same');
    const currentGeneration = addGeneration(fixture, 'current', 'same');
    pointCurrentAt(fixture, currentGeneration);

    const result = runDeploy(fixture);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('deploy_changed=0');
    expect(realpathSync(fixture.currentLink)).toBe(
      realpathSync(currentGeneration),
    );
    expect(generationNames(fixture)).toEqual(['.rwm-generation.current']);
    expect(existsSync(fixture.dockerLog)).toBe(false);
    expect(existsSync(fixture.mvLog)).toBe(false);
  });
});
