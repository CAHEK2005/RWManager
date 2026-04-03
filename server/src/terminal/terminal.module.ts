import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ScriptsModule } from '../scripts/scripts.module';
import { TerminalService } from './terminal.service';

@Module({
  imports: [
    ScriptsModule,
    JwtModule.register({ secret: 'SECRET_KEY_CHANGE_ME' }),
  ],
  providers: [TerminalService],
})
export class TerminalModule {}
