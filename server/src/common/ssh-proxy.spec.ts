import * as net from 'node:net';
import { openSocks5Socket, parseSocks5ProxyUrl } from './ssh-proxy';

describe('SOCKS5 SSH transport', () => {
  it('parses credentials, including a pasted escaped delimiter', () => {
    expect(
      parseSocks5ProxyUrl('socks5://user:p%40ss\\@127.0.0.1:1080'),
    ).toEqual({
      host: '127.0.0.1',
      port: 1080,
      username: 'user',
      password: 'p@ss',
    });
    expect(
      parseSocks5ProxyUrl('socks5://user:p\\@ss@127.0.0.1:1080').password,
    ).toBe('p@ss');
  });

  it.each([
    'http://user:pass@proxy.example:1080',
    'socks5://proxy.example',
    'socks5://proxy.example:1080/path',
    'socks5://proxy.example:1080?x=1',
    'socks5://proxy.example:0',
  ])('rejects an invalid proxy URL: %s', (url) => {
    expect(() => parseSocks5ProxyUrl(url)).toThrow();
  });

  it('authenticates and sends the destination hostname to the proxy', async () => {
    let request = Buffer.alloc(0);
    const sockets = new Set<net.Socket>();
    const server = net.createServer((peer) => {
      sockets.add(peer);
      peer.on('close', () => sockets.delete(peer));
      let step = 0;
      peer.on('data', (chunk: Buffer) => {
        if (step === 0) {
          expect([...chunk]).toEqual([5, 1, 2]);
          step = 1;
          peer.write(Buffer.from([5, 2]));
        } else if (step === 1) {
          expect(chunk[0]).toBe(1);
          expect(chunk.subarray(2, 2 + chunk[1]).toString()).toBe('user');
          const passwordOffset = 2 + chunk[1];
          expect(chunk.subarray(passwordOffset + 1).toString()).toBe('p@ss');
          step = 2;
          peer.write(Buffer.from([1, 0]));
        } else {
          request = Buffer.concat([request, chunk]);
          peer.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 22]));
        }
      });
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const address = server.address() as net.AddressInfo;
    try {
      const socket = await openSocks5Socket(
        `socks5://user:p%40ss@127.0.0.1:${address.port}`,
        'node.example',
        2222,
      );
      expect(request.subarray(0, 5)).toEqual(Buffer.from([5, 1, 0, 3, 12]));
      expect(request.subarray(5, 17).toString()).toBe('node.example');
      expect(request.readUInt16BE(17)).toBe(2222);
      socket.destroy();
    } finally {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
