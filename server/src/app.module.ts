import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';

import { Setting } from './settings/entities/setting.entity';
import { Domain } from './domains/entities/domain.entity';

import { RemnavaveModule } from './remnawave/remnawave.module';
import { InboundsModule } from './inbounds/inbounds.module';
import { RotationModule } from './rotation/rotation.module';
import { DomainsModule } from './domains/domains.module';
import { SettingsModule } from './settings/settings.module';
import { AuthModule } from './auth/auth.module';
import { NodesModule } from './nodes/nodes.module';
import { TelegramModule } from './telegram/telegram.module';
import { ScriptsModule } from './scripts/scripts.module';
import { TerminalModule } from './terminal/terminal.module';
import { SecretsModule } from './secrets/secrets.module';
import { HealthModule } from './health/health.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { APP_GUARD } from '@nestjs/core';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([{
      name: 'default',
      ttl: 60000,
      limit: 60,
    }]),
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.DB_HOST,
      port: parseInt(process.env.DB_PORT || '5432', 10),
      username: process.env.DB_USERNAME,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      entities: [Setting, Domain],
      synchronize: true,
    }),
    RemnavaveModule,
    InboundsModule,
    RotationModule,
    DomainsModule,
    SettingsModule,
    AuthModule,
    NodesModule,
    TelegramModule,
    ScriptsModule,
    TerminalModule,
    SecretsModule,
    HealthModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
