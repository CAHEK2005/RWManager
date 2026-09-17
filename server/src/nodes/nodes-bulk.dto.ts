import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsString,
} from 'class-validator';

export class BulkNodeActionDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(1000)
  @IsString({ each: true })
  uuids: string[];

  @IsIn(['enable', 'disable', 'restart', 'delete'])
  action: 'enable' | 'disable' | 'restart' | 'delete';
}
