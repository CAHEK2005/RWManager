import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SettingsController } from './settings.controller';
import { Setting } from './entities/setting.entity';
import { Domain } from '../domains/entities/domain.entity';
import { RemnavaveModule } from '../remnawave/remnawave.module';
import { RotationModule } from '../rotation/rotation.module';
import { TelegramModule } from '../telegram/telegram.module';

@Module({
  imports: [TypeOrmModule.forFeature([Setting, Domain]), RemnavaveModule, RotationModule, TelegramModule],
  controllers: [SettingsController],
})
export class SettingsModule {}
