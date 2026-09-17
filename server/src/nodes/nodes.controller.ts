import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { NodesService } from './nodes.service';
import type { InstallNodeDto } from './nodes.service';
import { RemnavaveService } from '../remnawave/remnawave.service';
import { InstallNodeRequestDto } from './nodes.dto';
import { BulkNodeActionDto } from './nodes-bulk.dto';

@Controller('nodes')
export class NodesController {
  private readonly logger = new Logger(NodesController.name);

  constructor(
    private nodesService: NodesService,
    private remnavaveService: RemnavaveService,
  ) {}

  @Get()
  async getNodes() {
    try {
      return await this.remnavaveService.getNodes();
    } catch (e) {
      throw new HttpException(e.message, HttpStatus.BAD_REQUEST);
    }
  }

  @Post('install')
  async install(@Body() dto: InstallNodeRequestDto) {
    try {
      return await this.nodesService.startInstall(dto as InstallNodeDto);
    } catch (e) {
      this.logger.error(`install error: ${e.message}`);
      throw new HttpException(e.message, HttpStatus.BAD_REQUEST);
    }
  }

  @Get('install/:jobId')
  getInstallStatus(@Param('jobId') jobId: string) {
    const job = this.nodesService.getJobStatus(jobId);
    if (!job) throw new HttpException('Job not found', HttpStatus.NOT_FOUND);
    return job;
  }

  @Post('bulk-action')
  async bulkAction(@Body() body: BulkNodeActionDto) {
    const results: { uuid: string; success: boolean; error?: string }[] = [];
    for (const uuid of new Set(body.uuids)) {
      try {
        switch (body.action) {
          case 'enable':
            await this.remnavaveService.enableNode(uuid);
            break;
          case 'disable':
            await this.remnavaveService.disableNode(uuid);
            break;
          case 'restart':
            await this.remnavaveService.restartNode(uuid);
            break;
          case 'delete':
            await this.remnavaveService.deleteNode(uuid);
            break;
        }
        results.push({ uuid, success: true });
      } catch (error) {
        results.push({
          uuid,
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return { results };
  }

  @Post(':uuid/enable')
  async enable(@Param('uuid') uuid: string) {
    try {
      return await this.remnavaveService.enableNode(uuid);
    } catch (e) {
      throw new HttpException(e.message, HttpStatus.BAD_REQUEST);
    }
  }

  @Post(':uuid/disable')
  async disable(@Param('uuid') uuid: string) {
    try {
      return await this.remnavaveService.disableNode(uuid);
    } catch (e) {
      throw new HttpException(e.message, HttpStatus.BAD_REQUEST);
    }
  }

  @Post(':uuid/restart')
  async restart(@Param('uuid') uuid: string) {
    try {
      return await this.remnavaveService.restartNode(uuid);
    } catch (e) {
      throw new HttpException(e.message, HttpStatus.BAD_REQUEST);
    }
  }

  @Delete(':uuid')
  async deleteNode(@Param('uuid') uuid: string) {
    try {
      return await this.remnavaveService.deleteNode(uuid);
    } catch (e) {
      throw new HttpException(e.message, HttpStatus.BAD_REQUEST);
    }
  }
}
