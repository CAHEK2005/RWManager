import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ScriptsModule } from '../scripts/scripts.module';
import { TerminalService } from './terminal.service';
import { TerminalController } from './terminal.controller';

@Module({
  imports: [
    ScriptsModule,
    JwtModule.register({ secret: process.env.JWT_SECRET || 'SECRET_KEY_CHANGE_ME' }),
  ],
  providers: [TerminalService],
  controllers: [TerminalController],
})
export class TerminalModule {}
