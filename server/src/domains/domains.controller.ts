import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  Query,
} from '@nestjs/common';
import { DomainsService } from './domains.service';
import {
  CreateDomainDto,
  PreviewUrlDto,
  UploadDomainsDto,
} from './domains.dto';

@Controller('domains')
export class DomainsController {
  constructor(private readonly domainsService: DomainsService) {}

  @Post()
  create(@Body() body: CreateDomainDto) {
    return this.domainsService.create(body);
  }

  @Post('upload')
  uploadMany(@Body() body: UploadDomainsDto) {
    return this.domainsService.createMany(body.domains);
  }

  @Post('preview-url')
  previewUrl(@Body() body: PreviewUrlDto) {
    return this.domainsService.previewUrl(body.url);
  }

  @Get('all')
  findAllWithoutPagination() {
    return this.domainsService.findAllUnpaginated();
  }

  @Get()
  findAll(@Query('page') page: number, @Query('limit') limit: number) {
    const pageNum = page ? +page : 1;
    const limitNum = limit ? +limit : 10;

    return this.domainsService.findAll(pageNum, limitNum);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.domainsService.findOne(+id);
  }

  @Delete('all')
  removeAll() {
    return this.domainsService.removeAll();
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.domainsService.remove(+id);
  }
}
