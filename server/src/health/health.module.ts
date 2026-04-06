import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Setting } from '../settings/entities/setting.entity';
import { HealthService } from './health.service';
import { HealthController } from './health.controller';
import { TelegramModule } from '../telegram/telegram.module';
import { ScriptsModule } from '../scripts/scripts.module';

@Module({
  imports: [TypeOrmModule.forFeature([Setting]), TelegramModule, ScriptsModule],
  controllers: [HealthController],
  providers: [HealthService],
  exports: [HealthService],
})
export class HealthModule {}
