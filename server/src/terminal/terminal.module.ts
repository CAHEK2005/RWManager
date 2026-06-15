import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ScriptsModule } from '../scripts/scripts.module';
import { TerminalService } from './terminal.service';
import { TerminalController } from './terminal.controller';
import { getJwtSecret } from '../auth/jwt-secret';

@Module({
  imports: [ScriptsModule, JwtModule.register({ secret: getJwtSecret() })],
  providers: [TerminalService],
  controllers: [TerminalController],
})
export class TerminalModule {}
