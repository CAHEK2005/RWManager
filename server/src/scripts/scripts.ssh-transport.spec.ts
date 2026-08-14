import { EventEmitter } from 'node:events';
import { Client } from 'ssh2';
import { ScriptsService, type SshNode } from './scripts.service';

jest.mock('ssh2', () => ({ Client: jest.fn() }));

type ExecCallback = (error: Error | undefined, stream: FakeSshStream) => void;

class FakeReadable extends EventEmitter {
  readonly resume = jest.fn(() => this);
}

class FakeSshStream extends EventEmitter {
  readonly stderr = new FakeReadable();
  readonly written: Array<string | Buffer> = [];
  readonly resume = jest.fn(() => this);

  constructor(private readonly closeAfterEnd: boolean) {
    super();
  }

  write = jest.fn((data: string | Buffer) => {
    this.written.push(data);
    return true;
  });

  end = jest.fn((...args: Array<string | Buffer | (() => void)>) => {
    const data = args.find(
      (arg): arg is string | Buffer =>
        typeof arg === 'string' || Buffer.isBuffer(arg),
    );
    if (data !== undefined) this.written.push(data);

    const callback = args.find(
      (arg): arg is () => void => typeof arg === 'function',
    );
    callback?.();

    if (this.closeAfterEnd) queueMicrotask(() => this.emit('close', 0));
    return this;
  });

  uploadedText(): string {
    return this.written
      .map((chunk) => (Buffer.isBuffer(chunk) ? chunk.toString('utf8') : chunk))
      .join('');
  }
}

interface ExecCall {
  command: string;
  options: Record<string, unknown>;
  stream: FakeSshStream;
}

class FakeSshClient extends EventEmitter {
  readonly calls: ExecCall[] = [];
  readonly connect = jest.fn(() => queueMicrotask(() => this.emit('ready')));
  readonly end = jest.fn();

  deferUploadCallback = false;
  executionCallbackError: Error | undefined;
  executionOutput = '';
  executionError = '';
  executionExitCode = 0;
  private deferredUploadCallback: (() => void) | undefined;

  releaseUploadCallback(): void {
    if (!this.deferredUploadCallback)
      throw new Error('No deferred upload callback');
    const callback = this.deferredUploadCallback;
    this.deferredUploadCallback = undefined;
    callback();
  }

  readonly exec = jest.fn(
    (
      command: string,
      optionsOrCallback: Record<string, unknown> | ExecCallback,
      optionalCallback?: ExecCallback,
    ) => {
      const options =
        typeof optionsOrCallback === 'function' ? {} : optionsOrCallback;
      const callback =
        typeof optionsOrCallback === 'function'
          ? optionsOrCallback
          : optionalCallback;
      if (!callback) throw new Error('Missing SSH exec callback in test fake');

      const callIndex = this.calls.length;
      const stream = new FakeSshStream(callIndex === 0);
      this.calls.push({ command, options, stream });

      if (callIndex === 0 && this.deferUploadCallback) {
        this.deferredUploadCallback = () => callback(undefined, stream);
        return;
      }

      if (callIndex === 1 && this.executionCallbackError) {
        callback(this.executionCallbackError, stream);
        return;
      }

      callback(undefined, stream);

      if (callIndex === 1) {
        queueMicrotask(() => {
          if (this.executionOutput)
            stream.emit('data', Buffer.from(this.executionOutput));
          if (this.executionError)
            stream.stderr.emit('data', Buffer.from(this.executionError));
          stream.emit('close', this.executionExitCode);
        });
      }
    },
  );
}

interface TestNodeResult {
  nodeId: string;
  nodeName: string;
  logs: string[];
  status: 'running' | 'success' | 'error';
}

type RunScriptOnNode = (
  node: SshNode,
  content: string,
  result: TestNodeResult,
  mask: string[],
) => Promise<void>;

function createHarness(overrides: Partial<SshNode> = {}) {
  const client = new FakeSshClient();
  jest
    .mocked(Client)
    .mockImplementation(() => client as unknown as InstanceType<typeof Client>);

  const service = new ScriptsService({} as never, {} as never, {} as never);
  const serviceWithRunner = service as unknown as {
    runScriptOnNode: RunScriptOnNode;
  };
  const runScriptOnNode: RunScriptOnNode = (node, content, result, mask) =>
    serviceWithRunner.runScriptOnNode(node, content, result, mask);
  const node: SshNode = {
    id: 'node-1',
    name: 'test-node',
    ip: '192.0.2.10',
    sshUser: 'root',
    authType: 'password',
    password: 'password',
    ...overrides,
  };
  const result: TestNodeResult = {
    nodeId: node.id,
    nodeName: node.name,
    logs: [],
    status: 'running',
  };

  return { client, node, result, runScriptOnNode };
}

function expectFileTransport(
  client: FakeSshClient,
  content: string,
): { upload: ExecCall; execution: ExecCall } {
  expect(client.calls).toHaveLength(2);
  const [upload, execution] = client.calls;
  const selfDeletePrefix = 'rm -f -- "$0"\n';
  const expectedPayload = `${selfDeletePrefix}${content}`;

  expect(upload.options).not.toHaveProperty('pty');
  const uploadedPath = upload.command.match(/\/tmp\/[^\s'"]+\.sh/)?.[0];
  if (!uploadedPath) throw new Error('Upload command has no temporary path');
  expect(upload.command).toMatch(/cat\s*>/);
  expect(upload.command).toContain('wc -c');
  expect(upload.command).toContain(
    String(Buffer.byteLength(expectedPayload, 'utf8')),
  );
  expect(upload.command).not.toContain(content);
  expect(upload.stream.end).toHaveBeenCalledWith(expectedPayload, 'utf8');
  const uploadedText = upload.stream.uploadedText();
  expect(uploadedText.startsWith(selfDeletePrefix)).toBe(true);
  expect(uploadedText.slice(selfDeletePrefix.length)).toBe(content);

  expect(execution.options).toMatchObject({
    pty: { term: 'xterm', cols: 200, rows: 50 },
  });
  expect(execution.command).toContain('bash');
  expect(execution.command).toContain('-e');
  expect(execution.command).toContain(uploadedPath);
  expect(execution.command).toMatch(/rm\s+-f/);
  expect(execution.command).not.toContain('bash -e <<');
  expect(execution.command).not.toContain('SCRIPT_EOF');
  expect(execution.command).not.toContain(content);
  expect(execution.stream.uploadedText()).toBe('');

  return { upload, execution };
}

describe('ScriptsService SSH script transport', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const scriptContent = [
    'echo before',
    'docker compose exec -T caddy cat /etc/caddy/Caddyfile',
    'echo after',
    'SCRIPT_EOF',
    'echo "$PATH"',
  ].join('\n');

  it('uploads the script through a separate exec stream before root execution', async () => {
    const { client, node, result, runScriptOnNode } = createHarness();
    client.executionOutput = 'deploy TOP_SECRET\n';
    client.executionError = 'warning TOP_SECRET\n';

    await runScriptOnNode(node, scriptContent, result, ['TOP_SECRET']);

    const { execution } = expectFileTransport(client, scriptContent);
    expect(execution.command).not.toMatch(/\bsudo\b/);
    expect(result.logs).toContain('[SSH] Подключено');
    expect(result.logs).toContain('deploy ***');
    expect(result.logs).toContain('[stderr] warning ***');
    expect(result.logs).toContain('[SSH] Выполнено успешно');
    expect(client.connect).toHaveBeenCalledWith(
      expect.objectContaining({
        host: node.ip,
        port: 22,
        username: 'root',
        password: 'password',
      }),
    );
    expect(client.end).toHaveBeenCalledTimes(1);
  });

  it('keeps the sudo execution branch for a non-root SSH user', async () => {
    const { client, node, result, runScriptOnNode } = createHarness({
      sshUser: 'deployer',
    });

    await runScriptOnNode(node, scriptContent, result, []);

    const { execution } = expectFileTransport(client, scriptContent);
    expect(execution.command).toMatch(/\bsudo(?:\s+--)?\s+bash\s+-e\b/);
    expect(result.logs).toContain('[SSH] Подключено (sudo)');
    expect(result.logs).toContain('[SSH] Выполнено успешно');
  });

  it('propagates the execution exit code, ends SSH, and omits success log', async () => {
    const { client, node, result, runScriptOnNode } = createHarness();
    client.executionOutput = 'failed TOP_SECRET\n';
    client.executionExitCode = 23;

    await expect(
      runScriptOnNode(node, scriptContent, result, ['TOP_SECRET']),
    ).rejects.toThrow('23');

    expectFileTransport(client, scriptContent);
    expect(result.logs).toContain('failed ***');
    expect(result.logs).not.toContain('[SSH] Выполнено успешно');
    expect(client.end).toHaveBeenCalledTimes(1);
  });

  it('does not send the payload when the upload callback arrives after its timeout', async () => {
    jest.useFakeTimers({ doNotFake: ['queueMicrotask'] });
    try {
      const { client, node, result, runScriptOnNode } = createHarness();
      client.deferUploadCallback = true;

      const runPromise = runScriptOnNode(node, scriptContent, result, []);
      const rejection = expect(runPromise).rejects.toThrow(
        'Таймаут загрузки скрипта на ноду',
      );
      await Promise.resolve();
      expect(client.calls).toHaveLength(1);

      await jest.advanceTimersByTimeAsync(30_000);
      await rejection;

      const upload = client.calls[0];
      client.releaseUploadCallback();
      await Promise.resolve();

      expect(upload.stream.end.mock.calls).toEqual([[]]);
      expect(upload.stream.uploadedText()).toBe('');
      expect(client.calls).toHaveLength(1);
      expect(client.end).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('keeps detached TTL cleanup when starting the uploaded script fails', async () => {
    const { client, node, result, runScriptOnNode } = createHarness();
    client.executionCallbackError = new Error('execution channel refused');

    await expect(
      runScriptOnNode(node, scriptContent, result, []),
    ).rejects.toThrow('execution channel refused');

    const { upload } = expectFileTransport(client, scriptContent);
    expect(upload.command).toMatch(
      /nohup sh -c 'sleep \d+; rm -f -- "\$1"' sh "\$RWM_SCRIPT_FILE"/,
    );
    expect(upload.command).toMatch(
      /<\s*\/dev\/null\s+>\s*\/dev\/null\s+2>&1\s*&/,
    );
    expect(result.logs).toContain('[ERROR] execution channel refused');
    expect(result.logs).not.toContain('[SSH] Выполнено успешно');
    expect(client.end).toHaveBeenCalledTimes(1);
  });
});
