import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Setting } from '../settings/entities/setting.entity';
import { RemnavaveModule } from '../remnawave/remnawave.module';
import { NodesController } from './nodes.controller';
import { NodesService } from './nodes.service';
import { ScriptsModule } from '../scripts/scripts.module';
import { SecretsModule } from '../secrets/secrets.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Setting]),
    RemnavaveModule,
    ScriptsModule,
    SecretsModule,
  ],
  controllers: [NodesController],
  providers: [NodesService],
  exports: [NodesService],
})
export class NodesModule {}
