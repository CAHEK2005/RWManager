import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ScriptsService } from './scripts.service';
import {
  assertSafePublicHttpUrl,
  fetchWithTimeout,
  normalizeGithubBlobUrl,
  readLimitedResponseText,
} from '../security/url-safety';
import {
  CategoryDto,
  ExecuteScriptDto,
  ExecuteSequenceDto,
  FetchUrlDto,
  ScriptDto,
  SshNodeDto,
} from './scripts.dto';

@Controller('scripts')
export class ScriptsController {
  constructor(private scriptsService: ScriptsService) {}

  // ── SSH Nodes ────────────────────────────────────────────────────────────────

  @Get('ssh-nodes')
  getSshNodes() {
    return this.scriptsService.getSshNodes();
  }

  @Post('ssh-nodes')
  async addSshNode(@Body() body: SshNodeDto) {
    try {
      return await this.scriptsService.upsertSshNode(body);
    } catch (e) {
      throw new HttpException(e.message, HttpStatus.BAD_REQUEST);
    }
  }

  @Patch('ssh-nodes/:id')
  async updateSshNode(@Param('id') id: string, @Body() body: SshNodeDto) {
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
  async addCategory(@Body() body: CategoryDto) {
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
  async createScript(@Body() body: ScriptDto) {
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
  async updateScript(@Param('id') id: string, @Body() body: ScriptDto) {
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
  async fetchUrl(@Body() body: FetchUrlDto) {
    if (!body.url)
      throw new HttpException('URL обязателен', HttpStatus.BAD_REQUEST);

    const url = normalizeGithubBlobUrl(body.url.trim());
    const safeUrl = await assertSafePublicHttpUrl(url);

    try {
      const res = await fetchWithTimeout(safeUrl, {}, 10_000);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const content = await readLimitedResponseText(res, 1_048_576);
      return { content, resolvedUrl: url };
    } catch (e) {
      if (e instanceof HttpException) throw e;
      throw new HttpException(
        `Не удалось загрузить: ${e.message}`,
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  // ── Execute ──────────────────────────────────────────────────────────────────

  @Post('execute')
  async execute(@Body() body: ExecuteScriptDto) {
    try {
      return await this.scriptsService.executeScript(
        body.scriptId,
        body.nodeIds,
        body.variables,
        body.variablesPerNode,
      );
    } catch (e) {
      throw new HttpException(e.message, HttpStatus.BAD_REQUEST);
    }
  }

  @Post('execute-sequence')
  async executeSequence(@Body() body: ExecuteSequenceDto) {
    try {
      return await this.scriptsService.executeSequence(
        body.scriptIds,
        body.nodeIds,
        body.variablesPerScript ?? {},
        body.variablesPerScriptPerNode,
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
  async getHistory(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.scriptsService.getHistory(
      Number(page) || 1,
      Number(limit) || 20,
    );
  }

  @Get('history/by-script/:scriptId')
  async getHistoryByScript(
    @Param('scriptId') scriptId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.scriptsService.getHistoryByScript(
      scriptId,
      Number(page) || 1,
      Number(limit) || 10,
    );
  }

  @Get('history/:id')
  async getHistoryEntry(@Param('id') id: string) {
    const entry = await this.scriptsService.getHistoryEntry(id);
    if (!entry)
      throw new HttpException('Запись не найдена', HttpStatus.NOT_FOUND);
    return entry;
  }

  @Delete('history')
  async clearHistory() {
    await this.scriptsService.clearHistory();
    return { success: true };
  }
}
