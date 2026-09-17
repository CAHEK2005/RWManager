import * as net from 'node:net';
import type { Client, ConnectConfig } from 'ssh2';

interface SocksProxy {
  host: string;
  port: number;
  username: string;
  password: string;
}

export function parseSocks5ProxyUrl(value: string): SocksProxy {
  let url: URL;
  try {
    // A backslash before @ is often pasted from Markdown or shell examples.
    url = new URL(value.trim().replace(/\\@/g, '@'));
  } catch {
    throw new Error('Invalid SOCKS5 proxy URL');
  }
  const port = Number(url.port);
  if (
    url.protocol !== 'socks5:' ||
    !url.hostname ||
    !url.port ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535 ||
    (url.pathname !== '' && url.pathname !== '/') ||
    url.search ||
    url.hash
  ) {
    throw new Error('Expected socks5://user:password@address:port');
  }
  let username: string;
  let password: string;
  try {
    username = decodeURIComponent(url.username);
    password = decodeURIComponent(url.password);
  } catch {
    throw new Error('Invalid SOCKS5 proxy credentials');
  }
  if (Buffer.byteLength(username) > 255 || Buffer.byteLength(password) > 255) {
    throw new Error('SOCKS5 proxy credentials are too long');
  }
  return {
    host: url.hostname.replace(/^\[|\]$/g, ''),
    port,
    username,
    password,
  };
}

function targetAddress(host: string, port: number): Buffer {
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('Invalid SSH destination');
  }
  let normalized = host.replace(/^\[|\]$/g, '');
  const ipVersion = net.isIP(normalized);
  let address: Buffer;
  let type: number;
  if (ipVersion === 4) {
    address = Buffer.from(normalized.split('.').map(Number));
    type = 1;
  } else if (ipVersion === 6) {
    // IPv4-mapped IPv6 addresses end in dotted decimal notation.
    const dottedTail = normalized.match(/(\d+\.\d+\.\d+\.\d+)$/)?.[1];
    if (dottedTail) {
      const bytes = dottedTail.split('.').map(Number);
      normalized =
        normalized.slice(0, -dottedTail.length) +
        `${((bytes[0] << 8) | bytes[1]).toString(16)}:${((bytes[2] << 8) | bytes[3]).toString(16)}`;
    }
    const [left, right] = normalized.split('::');
    if (right === undefined) {
      address = Buffer.from(
        normalized
          .split(':')
          .flatMap((part) => [
            parseInt(part, 16) >> 8,
            parseInt(part, 16) & 255,
          ]),
      );
    } else {
      const before = left ? left.split(':') : [];
      const after = right ? right.split(':') : [];
      const parts = [
        ...before,
        ...Array<string>(8 - before.length - after.length).fill('0'),
        ...after,
      ];
      address = Buffer.from(
        parts.flatMap((part) => [
          parseInt(part, 16) >> 8,
          parseInt(part, 16) & 255,
        ]),
      );
    }
    type = 4;
  } else {
    address = Buffer.from(normalized, 'utf8');
    if (!address.length || address.length > 255)
      throw new Error('Invalid SSH destination');
    type = 3;
    address = Buffer.concat([Buffer.from([address.length]), address]);
  }
  const result = Buffer.concat([
    Buffer.from([5, 1, 0, type]),
    address,
    Buffer.alloc(2),
  ]);
  result.writeUInt16BE(port, result.length - 2);
  return result;
}

export async function openSocks5Socket(
  proxyUrl: string,
  targetHost: string,
  targetPort: number,
  timeoutMs = 30_000,
): Promise<net.Socket> {
  const proxy = parseSocks5ProxyUrl(proxyUrl);
  const request = targetAddress(targetHost, targetPort);
  const socket = net.createConnection({ host: proxy.host, port: proxy.port });
  socket.setTimeout(timeoutMs);

  let buffer = Buffer.alloc(0);
  let terminalError: Error | undefined;
  let pending:
    | {
        length: number;
        resolve: (value: Buffer) => void;
        reject: (error: Error) => void;
      }
    | undefined;
  const fail = (error: Error) => {
    terminalError = error;
    if (pending) {
      const current = pending;
      pending = undefined;
      current.reject(error);
    }
  };
  const onData = (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    if (pending && buffer.length >= pending.length) {
      const current = pending;
      pending = undefined;
      const result = buffer.subarray(0, current.length);
      buffer = buffer.subarray(current.length);
      current.resolve(result);
    }
  };
  const onError = (error: Error) => fail(error);
  const onClose = () => fail(new Error('SOCKS5 proxy closed the connection'));
  const onTimeout = () => {
    fail(new Error('SOCKS5 proxy timed out'));
    socket.destroy();
  };
  socket.on('data', onData);
  socket.on('error', onError);
  socket.on('close', onClose);
  socket.on('timeout', onTimeout);

  const read = (length: number) =>
    new Promise<Buffer>((resolve, reject) => {
      if (terminalError) return reject(terminalError);
      if (buffer.length >= length) {
        const result = buffer.subarray(0, length);
        buffer = buffer.subarray(length);
        resolve(result);
      } else {
        pending = { length, resolve, reject };
      }
    });
  try {
    await new Promise<void>((resolve, reject) => {
      if (socket.readyState === 'open') return resolve();
      const connected = () => {
        socket.off('error', failed);
        resolve();
      };
      const failed = (error: Error) => {
        socket.off('connect', connected);
        reject(error);
      };
      socket.once('connect', connected);
      socket.once('error', failed);
    });
    const authenticated = Boolean(proxy.username || proxy.password);
    socket.write(Buffer.from(authenticated ? [5, 1, 2] : [5, 1, 0]));
    const greeting = await read(2);
    if (greeting[0] !== 5 || greeting[1] !== (authenticated ? 2 : 0)) {
      throw new Error('SOCKS5 proxy rejected authentication method');
    }
    if (authenticated) {
      const user = Buffer.from(proxy.username, 'utf8');
      const pass = Buffer.from(proxy.password, 'utf8');
      socket.write(
        Buffer.concat([
          Buffer.from([1, user.length]),
          user,
          Buffer.from([pass.length]),
          pass,
        ]),
      );
      const auth = await read(2);
      if (auth[0] !== 1 || auth[1] !== 0)
        throw new Error('SOCKS5 proxy authentication failed');
    }
    socket.write(request);
    const response = await read(4);
    if (response[0] !== 5 || response[1] !== 0) {
      throw new Error(`SOCKS5 proxy connection failed (code ${response[1]})`);
    }
    let addressLength: number;
    if (response[3] === 1) addressLength = 4;
    else if (response[3] === 4) addressLength = 16;
    else if (response[3] === 3) addressLength = (await read(1))[0];
    else throw new Error('Invalid SOCKS5 proxy response');
    await read(addressLength + 2);
    socket.pause();
    if (buffer.length) socket.unshift(buffer);
    socket.setTimeout(0);
    socket.off('data', onData);
    socket.off('error', onError);
    socket.off('close', onClose);
    socket.off('timeout', onTimeout);
    return socket;
  } catch (error) {
    socket.destroy();
    throw error;
  }
}

export function connectSsh(
  client: Client,
  options: ConnectConfig,
  proxyUrl?: string | null,
): void {
  if (!proxyUrl) {
    client.connect(options);
    return;
  }
  void openSocks5Socket(proxyUrl, options.host, options.port || 22)
    .then((socket) => client.connect({ ...options, sock: socket }))
    .catch((error: Error) => client.emit('error', error));
}
