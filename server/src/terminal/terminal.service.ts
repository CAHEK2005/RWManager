import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ScriptsService } from '../scripts/scripts.service';
import * as WebSocket from 'ws';
import { Client } from 'ssh2';
import * as http from 'http';

@Injectable()
export class TerminalService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TerminalService.name);
  private wss: WebSocket.Server;

  constructor(
    private httpAdapterHost: HttpAdapterHost,
    private jwtService: JwtService,
    private scriptsService: ScriptsService,
  ) {}

  onModuleInit() {
    const httpServer: http.Server = this.httpAdapterHost.httpAdapter.getHttpServer();
    this.wss = new WebSocket.Server({ server: httpServer, path: '/api/terminal' });
    this.wss.on('connection', (ws, req) => this.handleConnection(ws as any, req));
    this.logger.log('WebSocket terminal server started at /api/terminal');
  }

  onModuleDestroy() {
    this.wss?.close();
  }

  private async handleConnection(ws: WebSocket.WebSocket, req: http.IncomingMessage) {
    const params = new URL(req.url!, 'http://x').searchParams;
    const token = params.get('token') ?? '';
    const nodeId = params.get('nodeId') ?? '';
    const cols = parseInt(params.get('cols') ?? '80', 10);
    const rows = parseInt(params.get('rows') ?? '24', 10);

    // Verify JWT
    try {
      this.jwtService.verify(token);
    } catch {
      this.logger.warn(`Terminal: invalid token for nodeId=${nodeId}`);
      ws.close(1008, 'Unauthorized');
      return;
    }

    // Find node
    const nodes = await this.scriptsService.getSshNodes();
    const node = nodes.find(n => n.id === nodeId);
    if (!node) {
      this.logger.warn(`Terminal: node not found: ${nodeId}`);
      ws.close(1008, 'Node not found');
      return;
    }

    this.logger.log(`Terminal: connecting to ${node.name} (${node.ip})`);

    const conn = new Client();

    conn.on('ready', () => {
      conn.shell({ term: 'xterm-256color', cols, rows } as any, (err, stream) => {
        if (err) {
          ws.send(`\r\n[ERROR] ${err.message}\r\n`);
          ws.close(1011);
          conn.end();
          return;
        }

        // SSH data → WebSocket
        stream.on('data', (data: Buffer) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(data);
          }
        });

        stream.stderr.on('data', (data: Buffer) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(data);
          }
        });

        // WebSocket data → SSH
        ws.on('message', (msg: Buffer | string) => {
          const text = msg.toString();
          // Check for resize event
          if (text.startsWith('{')) {
            try {
              const parsed = JSON.parse(text);
              if (parsed.type === 'resize' && parsed.cols && parsed.rows) {
                (stream as any).setWindow(parsed.rows, parsed.cols, 0, 0);
                return;
              }
            } catch {
              // not JSON, send as-is
            }
          }
          stream.write(msg);
        });

        stream.on('close', () => {
          conn.end();
          if (ws.readyState === WebSocket.OPEN) ws.close();
        });

        ws.on('close', () => {
          stream.end();
          conn.end();
        });

        ws.on('error', () => {
          stream.end();
          conn.end();
        });
      });
    });

    conn.on('error', (err) => {
      this.logger.error(`Terminal SSH error: ${err.message}`);
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(`\r\n[SSH ERROR] ${err.message}\r\n`);
        ws.close(1011);
      }
    });

    const connectOptions: any = {
      host: node.ip,
      port: node.sshPort || 22,
      username: node.sshUser || 'root',
      readyTimeout: 30000,
    };
    if (node.authType === 'key' && node.sshKey) {
      connectOptions.privateKey = node.sshKey;
    } else {
      connectOptions.password = node.password || '';
    }

    conn.connect(connectOptions);
  }
}
