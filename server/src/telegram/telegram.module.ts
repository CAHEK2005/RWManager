import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Setting } from '../settings/entities/setting.entity';
import { TelegramService } from './telegram.service';

@Module({
  imports: [TypeOrmModule.forFeature([Setting])],
  providers: [TelegramService],
  exports: [TelegramService],
})
export class TelegramModule {}
