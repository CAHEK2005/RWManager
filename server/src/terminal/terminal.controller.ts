import {
  Controller,
  Post,
  Body,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { TerminalService } from './terminal.service';
import { CreateTerminalTicketDto } from './terminal.dto';

@Controller('terminal')
export class TerminalController {
  constructor(private terminalService: TerminalService) {}

  @Post('ticket')
  createTicket(@Body() body: CreateTerminalTicketDto) {
    if (!body.nodeId)
      throw new HttpException('nodeId required', HttpStatus.BAD_REQUEST);
    const ticket = this.terminalService.createTicket(body.nodeId);
    return { ticket };
  }
}
