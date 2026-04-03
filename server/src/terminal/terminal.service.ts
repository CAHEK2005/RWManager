import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ScriptsService } from '../scripts/scripts.service';
import * as WebSocket from 'ws';
import { Client } from 'ssh2';
import * as http from 'http';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class TerminalService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TerminalService.name);
  private wss: WebSocket.Server;
  private readonly tickets = new Map<string, { nodeId: string; expiresAt: number }>();

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

    // Cleanup expired tickets every minute to prevent memory leak
    setInterval(() => {
      const now = Date.now();
      for (const [ticket, entry] of this.tickets.entries()) {
        if (entry.expiresAt < now) this.tickets.delete(ticket);
      }
    }, 60_000);
  }

  onModuleDestroy() {
    this.wss?.close();
  }

  // ── Ticket API ────────────────────────────────────────────────────────────────

  createTicket(nodeId: string): string {
    const ticket = uuidv4();
    this.tickets.set(ticket, { nodeId, expiresAt: Date.now() + 60_000 });
    return ticket;
  }

  // ── WebSocket handler ─────────────────────────────────────────────────────────

  private async handleConnection(ws: WebSocket.WebSocket, req: http.IncomingMessage) {
    const params = new URL(req.url!, 'http://x').searchParams;
    const cols = parseInt(params.get('cols') ?? '80', 10);
    const rows = parseInt(params.get('rows') ?? '24', 10);

    // Auth: ticket (popup) or JWT+nodeId (floating window)
    let resolvedNodeId: string;
    const ticket = params.get('ticket');

    if (ticket) {
      const entry = this.tickets.get(ticket);
      if (!entry || Date.now() > entry.expiresAt) {
        this.logger.warn(`Terminal: invalid or expired ticket`);
        ws.close(1008, 'Invalid or expired ticket');
        return;
      }
      resolvedNodeId = entry.nodeId;
      this.tickets.delete(ticket); // one-time use
    } else {
      const token = params.get('token') ?? '';
      const nodeId = params.get('nodeId') ?? '';
      try {
        this.jwtService.verify(token);
      } catch {
        this.logger.warn(`Terminal: invalid token for nodeId=${nodeId}`);
        ws.close(1008, 'Unauthorized');
        return;
      }
      resolvedNodeId = nodeId;
    }

    // Find node
    const nodes = await this.scriptsService.getSshNodes();
    const node = nodes.find(n => n.id === resolvedNodeId);
    if (!node) {
      this.logger.warn(`Terminal: node not found: ${resolvedNodeId}`);
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
          if (ws.readyState === WebSocket.OPEN) ws.send(data);
        });

        stream.stderr.on('data', (data: Buffer) => {
          if (ws.readyState === WebSocket.OPEN) ws.send(data);
        });

        // WebSocket data → SSH
        ws.on('message', (msg: Buffer | string) => {
          const text = msg.toString();
          if (text.startsWith('{')) {
            try {
              const parsed = JSON.parse(text);
              if (parsed.type === 'ping') return;                            // heartbeat — ignore
              if (parsed.type === 'resize' && parsed.cols && parsed.rows) { // PTY resize
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

        ws.on('close', () => { stream.end(); conn.end(); });
        ws.on('error', () => { stream.end(); conn.end(); });
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
      keepaliveInterval: 30000,  // SSH keepalive — prevents idle disconnect
      keepaliveCountMax: 3,
    };
    if (node.authType === 'key' && node.sshKey) {
      connectOptions.privateKey = node.sshKey;
    } else {
      connectOptions.password = node.password || '';
    }

    conn.connect(connectOptions);
  }
}
