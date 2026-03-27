import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class InboundBuilderService {
  private flag = process.env.COUNTRY_FLAG ?? '%F0%9F%92%AF';

  buildVlessRealityTcp(params: { port: number; uuid: string; sni: string; privateKey: string; publicKey: string }) {
    const { port, uuid, sni, privateKey, publicKey } = params;
    return {
      tag: `vless-tcp-reality-rw-manager`,
      port,
      protocol: 'vless',
      settings: {
        clients: [{ id: uuid, flow: 'xtls-rprx-vision', email: uuid }],
        decryption: 'none',
        fallbacks: [],
      },
      streamSettings: {
        network: 'tcp',
        security: 'reality',
        realitySettings: {
          show: false,
          xver: 0,
          target: `${sni}:443`,
          dest: `${sni}:443`,
          serverNames: [sni],
          privateKey,
          shortIds: [crypto.randomBytes(4).toString('hex'), crypto.randomBytes(4).toString('hex')],
          settings: { publicKey, fingerprint: 'random', serverName: '', spiderX: '/' },
        },
        tcpSettings: { acceptProxyProtocol: false, header: { type: 'none' } },
      },
      sniffing: { enabled: false, destOverride: ['http', 'tls', 'quic', 'fakedns'] },
    };
  }

  buildVlessRealityXhttp(params: { port: number; uuid: string; sni: string; privateKey: string; publicKey: string }) {
    const { port, uuid, sni, privateKey, publicKey } = params;
    return {
      tag: `vless-xhttp-reality-rw-manager`,
      port,
      protocol: 'vless',
      settings: {
        clients: [{ id: uuid, flow: '', email: uuid }],
        decryption: 'none',
        fallbacks: [],
      },
      streamSettings: {
        network: 'xhttp',
        security: 'reality',
        realitySettings: {
          show: false,
          xver: 0,
          target: `${sni}:443`,
          dest: `${sni}:443`,
          serverNames: [sni],
          privateKey,
          shortIds: [crypto.randomBytes(4).toString('hex'), crypto.randomBytes(4).toString('hex')],
          settings: { publicKey, fingerprint: 'random', serverName: '', spiderX: '/' },
        },
        xhttpSettings: {
          host: sni,
          path: '/',
          mode: 'auto',
          noSSEHeader: false,
          scMaxBufferedPosts: 30,
          scMaxEachPostBytes: '1000000',
          scStreamUpServerSecs: '20-80',
          xPaddingBytes: '100-1000',
        },
      },
      sniffing: { enabled: false, destOverride: ['http', 'tls', 'quic', 'fakedns'] },
    };
  }

  buildVlessRealityGrpc(params: { port: number; uuid: string; sni: string; privateKey: string; publicKey: string }) {
    const { port, uuid, sni, privateKey, publicKey } = params;
    return {
      tag: `vless-grpc-reality-rw-manager`,
      port,
      protocol: 'vless',
      settings: {
        clients: [{ id: uuid, email: uuid, flow: '' }],
        decryption: 'none',
        fallbacks: [],
      },
      streamSettings: {
        network: 'grpc',
        security: 'reality',
        realitySettings: {
          show: false,
          xver: 0,
          target: `${sni}:443`,
          dest: `${sni}:443`,
          serverNames: [sni],
          privateKey,
          shortIds: [crypto.randomBytes(4).toString('hex')],
          settings: { publicKey, fingerprint: 'random', serverName: '', spiderX: '/' },
        },
        grpcSettings: {
          serviceName: 'myservice',
          authority: sni,
          multiMode: false,
        },
      },
      sniffing: { enabled: false, destOverride: ['http', 'tls', 'quic', 'fakedns'] },
    };
  }

  buildVlessWs(params: { port: number; uuid: string; sni: string }) {
    const { port, uuid, sni } = params;
    return {
      tag: `vless-ws-rw-manager`,
      port,
      protocol: 'vless',
      settings: {
        clients: [{ id: uuid, email: uuid, flow: '' }],
        decryption: 'none',
        fallbacks: [],
      },
      streamSettings: {
        network: 'ws',
        security: 'none',
        wsSettings: {
          host: sni,
          path: '/',
          acceptProxyProtocol: false,
        },
      },
      sniffing: { enabled: false, destOverride: ['http', 'tls', 'quic', 'fakedns'] },
    };
  }

  buildVmessTcp(params: { port: number; uuid: string }) {
    const { port, uuid } = params;
    return {
      tag: 'vmess-tcp',
      port,
      protocol: 'vmess',
      settings: {
        clients: [{ id: uuid, email: uuid, alterId: 0 }],
      },
      streamSettings: {
        network: 'tcp',
        security: 'none',
        tcpSettings: {
          acceptProxyProtocol: false,
          header: { type: 'none' },
        },
      },
      sniffing: { enabled: false, destOverride: ['http', 'tls', 'quic', 'fakedns'] },
    };
  }

  buildShadowsocksTcp(params: { port: number; uuid: string }) {
    const { port, uuid } = params;
    return {
      tag: `shadowsocks-tcp-rw-manager`,
      port,
      protocol: 'shadowsocks',
      settings: {
        method: 'chacha20-ietf-poly1305',
        clients: [{
          email: uuid,
          password: crypto.randomBytes(32).toString('base64'),
          method: 'chacha20-ietf-poly1305',
        }],
        network: 'tcp',
      },
      streamSettings: {
        network: 'tcp',
        security: 'none',
        tcpSettings: {
          acceptProxyProtocol: false,
          header: { type: 'none' },
        },
      },
      sniffing: { enabled: false, destOverride: ['http', 'tls', 'quic', 'fakedns'] },
    };
  }

  buildTrojanRealityTcp(params: { port: number; uuid: string; sni: string; privateKey: string; publicKey: string }) {
    const { port, uuid, sni, privateKey, publicKey } = params;
    return {
      tag: `trojan-tcp-reality-rw-manager`,
      port,
      protocol: 'trojan',
      settings: {
        clients: [{
          email: uuid,
          password: crypto.randomBytes(8).toString('hex'),
          flow: '',
        }],
        fallbacks: [],
      },
      streamSettings: {
        network: 'tcp',
        security: 'reality',
        realitySettings: {
          show: false,
          xver: 0,
          target: `${sni}:443`,
          dest: `${sni}:443`,
          serverNames: [sni],
          privateKey,
          shortIds: [
            crypto.randomBytes(4).toString('hex'),
            crypto.randomBytes(3).toString('hex'),
            crypto.randomBytes(8).toString('hex'),
            crypto.randomBytes(2).toString('hex'),
          ],
          settings: { publicKey, fingerprint: 'random', serverName: '', spiderX: '/' },
        },
        tcpSettings: {
          acceptProxyProtocol: false,
          header: { type: 'none' },
        },
      },
      sniffing: { enabled: false, destOverride: ['http', 'tls', 'quic', 'fakedns'] },
    };
  }

  generateUuid() {
    return uuidv4();
  }

  buildInboundLink(inbound: any, serverAddress: string, idOrPass: string, flagEmoji: string): string {
    this.flag = flagEmoji;
    let link = '';

    switch (inbound.protocol) {
      case 'vless':
        link = this.buildVlessLink(inbound, serverAddress, idOrPass);
        break;
      case 'vmess':
        link = this.buildVmessLink(inbound, serverAddress, idOrPass);
        break;
      case 'shadowsocks':
        link = this.buildSsLink(inbound, serverAddress);
        break;
      case 'trojan':
        link = this.buildTrojanLink(inbound, serverAddress, idOrPass);
        break;
    }

    return link;
  }

  private buildVlessLink(inbound: any, serverAddress: string, uuid: string) {
    const stream = inbound.streamSettings;
    const settings = inbound.settings;
    const network = stream.network;
    const security = stream.security || 'none';
    const params = new URLSearchParams();

    params.set('type', network);
    params.set('encryption', 'none');
    params.set('security', security);

    if (security === 'reality') {
      const r = stream.realitySettings;
      params.set('pbk', r.settings.publicKey);
      params.set('fp', r.settings.fingerprint || 'random');
      params.set('sni', r.serverNames?.[0] || '');
      params.set('sid', r.shortIds?.[0] || '');
      params.set('spx', '/');

      if (network === 'tcp') {
        const client = settings.clients?.[0];
        if (client?.flow) params.set('flow', client.flow);
      }

      if (network === 'xhttp') {
        const x = stream.xhttpSettings || {};
        params.set('path', x.path || '/');
        params.set('host', x.host || r.serverNames?.[0]);
        params.set('mode', x.mode || 'auto');
      }

      if (network === 'grpc') {
        const g = stream.grpcSettings || {};
        params.set('serviceName', g.serviceName || 'grpc');
        params.set('authority', g.authority || r.serverNames?.[0]);
      }
    }

    if (network === 'ws') {
      const ws = stream.wsSettings || {};
      params.set('path', ws.path || '/');
      if (ws.host) params.set('host', ws.host);
    }

    return (
      `vless://${uuid}@${serverAddress}:${inbound.port}` +
      `?${params.toString()}` +
      `#${this.flag}%20${encodeURIComponent(inbound.tag)}`
    );
  }

  private buildVmessLink(inbound: any, serverAddress: string, uuid: string) {
    const stream = inbound.streamSettings;
    const vmessObj = {
      add: serverAddress,
      aid: '0',
      alpn: '',
      fp: '',
      host: '',
      id: uuid,
      net: stream.network || 'tcp',
      path: '/',
      port: inbound.port.toString(),
      ps: decodeURIComponent(this.flag) + ' ' + inbound.tag,
      scy: '',
      sni: '',
      tls: stream.security || 'none',
      type: 'none',
      v: '2',
    };
    const base64 = Buffer.from(JSON.stringify(vmessObj), 'utf8').toString('base64');
    return `vmess://${base64}`;
  }

  private buildSsLink(inbound: any, serverAddress: string) {
    const settings = inbound.settings;
    const method = settings.clients?.[0]?.method || settings.method;
    const password = settings.clients?.[0]?.password || settings.password;
    const userInfo = `${method}:${password}`;
    const base64 = Buffer.from(userInfo, 'utf8').toString('base64');
    return `ss://${base64}@${serverAddress}:${inbound.port}?type=tcp#${this.flag}%20${inbound.tag}`;
  }

  private buildTrojanLink(inbound: any, serverAddress: string, password: string) {
    const stream = inbound.streamSettings;
    const reality = stream.realitySettings;
    const pbk = reality.settings.publicKey;
    const SNI = reality.serverNames?.[0] || serverAddress;
    const sid = reality.shortIds?.[0] || '';

    return (
      `trojan://${password}@${SNI}:${inbound.port}` +
      `?type=tcp` +
      `&security=reality` +
      `&pbk=${pbk}` +
      `&fp=random` +
      `&sni=${SNI}` +
      `&sid=${sid}` +
      `&spx=%2F` +
      `#${this.flag}%20${inbound.tag}`
    );
  }
}
