import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Setting } from '../settings/entities/setting.entity';
import { ScriptsController } from './scripts.controller';
import { ScriptsService } from './scripts.service';
import { TelegramModule } from '../telegram/telegram.module';
import { SecretsModule } from '../secrets/secrets.module';

@Module({
  imports: [TypeOrmModule.forFeature([Setting]), TelegramModule, SecretsModule],
  controllers: [ScriptsController],
  providers: [ScriptsService],
  exports: [ScriptsService],
})
export class ScriptsModule {}
