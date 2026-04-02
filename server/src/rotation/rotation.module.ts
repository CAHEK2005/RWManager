import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';

import { RotationService } from './rotation.service';
import { RotationController } from './rotation.controller';
import { RemnavaveModule } from '../remnawave/remnawave.module';
import { InboundsModule } from '../inbounds/inbounds.module';
import { TelegramModule } from '../telegram/telegram.module';

import { Domain } from '../domains/entities/domain.entity';
import { Setting } from '../settings/entities/setting.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Domain, Setting]),
    ScheduleModule.forRoot(),
    RemnavaveModule,
    InboundsModule,
    TelegramModule,
  ],
  providers: [RotationService],
  controllers: [RotationController],
  exports: [RotationService],
})
export class RotationModule {}
