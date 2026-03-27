import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SettingsController } from './settings.controller';
import { Setting } from './entities/setting.entity';
import { RemnavaveModule } from '../remnawave/remnawave.module';

@Module({
  imports: [TypeOrmModule.forFeature([Setting]), RemnavaveModule],
  controllers: [SettingsController],
})
export class SettingsModule {}
