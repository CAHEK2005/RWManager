import { IsString, MinLength } from 'class-validator';

export class CreateTerminalTicketDto {
  @IsString()
  @MinLength(1)
  nodeId: string;
}
