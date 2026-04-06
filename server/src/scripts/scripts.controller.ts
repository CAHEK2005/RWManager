import {
  Controller, Get, Post, Patch, Delete,
  Body, Param, Query, HttpException, HttpStatus,
} from '@nestjs/common';
import { ScriptsService } from './scripts.service';

@Controller('scripts')
export class ScriptsController {
  constructor(private scriptsService: ScriptsService) {}

  // ── SSH Nodes ────────────────────────────────────────────────────────────────

  @Get('ssh-nodes')
  getSshNodes() {
    return this.scriptsService.getSshNodes();
  }

  @Post('ssh-nodes')
  async addSshNode(@Body() body: any) {
    try {
      return await this.scriptsService.upsertSshNode(body);
    } catch (e) {
      throw new HttpException(e.message, HttpStatus.BAD_REQUEST);
    }
  }

  @Patch('ssh-nodes/:id')
  async updateSshNode(@Param('id') id: string, @Body() body: any) {
    try {
      return await this.scriptsService.upsertSshNode({ ...body, id });
    } catch (e) {
      throw new HttpException(e.message, HttpStatus.BAD_REQUEST);
    }
  }

  @Delete('ssh-nodes/:id')
  async deleteSshNode(@Param('id') id: string) {
    try {
      await this.scriptsService.deleteSshNode(id);
      return { success: true };
    } catch (e) {
      throw new HttpException(e.message, HttpStatus.BAD_REQUEST);
    }
  }

  // ── Categories ───────────────────────────────────────────────────────────────

  @Get('categories')
  getCategories() {
    return this.scriptsService.getCategories();
  }

  @Post('categories')
  async addCategory(@Body() body: { name: string }) {
    try {
      return await this.scriptsService.upsertCategory(body.name);
    } catch (e) {
      throw new HttpException(e.message, HttpStatus.BAD_REQUEST);
    }
  }

  @Delete('categories/:name')
  async deleteCategory(@Param('name') name: string) {
    try {
      return await this.scriptsService.deleteCategory(decodeURIComponent(name));
    } catch (e) {
      throw new HttpException(e.message, HttpStatus.BAD_REQUEST);
    }
  }

  // ── Scripts ──────────────────────────────────────────────────────────────────

  @Get('scripts')
  getScripts() {
    return this.scriptsService.getScripts();
  }

  @Post('scripts')
  async createScript(@Body() body: any) {
    try {
      return await this.scriptsService.upsertScript(body);
    } catch (e) {
      throw new HttpException(e.message, HttpStatus.BAD_REQUEST);
    }
  }

  @Post('scripts/:id/revert')
  async revertScript(@Param('id') id: string) {
    try {
      return await this.scriptsService.revertScript(id);
    } catch (e) {
      throw new HttpException(e.message, HttpStatus.BAD_REQUEST);
    }
  }

  @Patch('scripts/:id')
  async updateScript(@Param('id') id: string, @Body() body: any) {
    try {
      return await this.scriptsService.upsertScript({ ...body, id });
    } catch (e) {
      throw new HttpException(e.message, HttpStatus.BAD_REQUEST);
    }
  }

  @Delete('scripts/:id')
  async deleteScript(@Param('id') id: string) {
    try {
      await this.scriptsService.deleteScript(id);
      return { success: true };
    } catch (e) {
      throw new HttpException(e.message, HttpStatus.BAD_REQUEST);
    }
  }

  // ── Fetch URL ────────────────────────────────────────────────────────────────

  @Post('fetch-url')
  async fetchUrl(@Body() body: { url: string }) {
    if (!body.url) throw new HttpException('URL обязателен', HttpStatus.BAD_REQUEST);

    let url = body.url.trim();
    const ghMatch = url.match(/^https?:\/\/github\.com\/([^/]+\/[^/]+)\/blob\/(.+)$/);
    if (ghMatch) {
      url = `https://raw.githubusercontent.com/${ghMatch[1]}/${ghMatch[2]}`;
    }

    // SSRF protection: block requests to private/loopback addresses
    try {
      const parsed = new URL(url);
      const hostname = parsed.hostname.toLowerCase();
      const privatePatterns = [
        /^localhost$/,
        /^127\./,
        /^10\./,
        /^172\.(1[6-9]|2\d|3[01])\./,
        /^192\.168\./,
        /^169\.254\./,
        /^::1$/,
        /^fc00:/,
        /^fe80:/,
      ];
      if (privatePatterns.some(p => p.test(hostname))) {
        throw new HttpException('Запрос к внутренним адресам запрещён', HttpStatus.FORBIDDEN);
      }
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new HttpException('Разрешены только HTTP/HTTPS URL', HttpStatus.BAD_REQUEST);
      }
    } catch (e) {
      if (e instanceof HttpException) throw e;
      throw new HttpException('Некорректный URL', HttpStatus.BAD_REQUEST);
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // Limit response size to 1MB
      const reader = res.body?.getReader();
      if (!reader) throw new Error('Нет тела ответа');
      const chunks: Uint8Array[] = [];
      let totalSize = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        totalSize += value.length;
        if (totalSize > 1_048_576) {
          reader.cancel();
          throw new Error('Файл превышает 1MB');
        }
        chunks.push(value);
      }
      const content = new TextDecoder().decode(
        chunks.reduce((acc, chunk) => {
          const merged = new Uint8Array(acc.length + chunk.length);
          merged.set(acc);
          merged.set(chunk, acc.length);
          return merged;
        }, new Uint8Array(0)),
      );
      return { content, resolvedUrl: url };
    } catch (e) {
      if (e instanceof HttpException) throw e;
      throw new HttpException(`Не удалось загрузить: ${e.message}`, HttpStatus.BAD_REQUEST);
    }
  }

  // ── Execute ──────────────────────────────────────────────────────────────────

  @Post('execute')
  async execute(@Body() body: {
    scriptId: string;
    nodeIds: string[];
    variables?: Record<string, string>;
    variablesPerNode?: Record<string, Record<string, string>>;
  }) {
    try {
      return await this.scriptsService.executeScript(body.scriptId, body.nodeIds, body.variables, body.variablesPerNode);
    } catch (e) {
      throw new HttpException(e.message, HttpStatus.BAD_REQUEST);
    }
  }

  @Post('execute-sequence')
  async executeSequence(@Body() body: {
    scriptIds: string[];
    nodeIds: string[];
    variablesPerScript: Record<string, Record<string, string>>;
    variablesPerScriptPerNode?: Record<string, Record<string, Record<string, string>>>;
  }) {
    try {
      return await this.scriptsService.executeSequence(
        body.scriptIds, body.nodeIds, body.variablesPerScript ?? {}, body.variablesPerScriptPerNode,
      );
    } catch (e) {
      throw new HttpException(e.message, HttpStatus.BAD_REQUEST);
    }
  }

  @Get('execute/:jobId')
  getExecuteStatus(@Param('jobId') jobId: string) {
    const job = this.scriptsService.getJobStatus(jobId);
    if (!job) throw new HttpException('Job not found', HttpStatus.NOT_FOUND);
    return job;
  }

  // ── History ──────────────────────────────────────────────────────────────────

  @Get('history')
  async getHistory(@Query('page') page?: string, @Query('limit') limit?: string) {
    return this.scriptsService.getHistory(Number(page) || 1, Number(limit) || 20);
  }

  @Get('history/by-script/:scriptId')
  async getHistoryByScript(
    @Param('scriptId') scriptId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.scriptsService.getHistoryByScript(scriptId, Number(page) || 1, Number(limit) || 10);
  }

  @Get('history/:id')
  async getHistoryEntry(@Param('id') id: string) {
    const entry = await this.scriptsService.getHistoryEntry(id);
    if (!entry) throw new HttpException('Запись не найдена', HttpStatus.NOT_FOUND);
    return entry;
  }

  @Delete('history')
  async clearHistory() {
    await this.scriptsService.clearHistory();
    return { success: true };
  }
}
