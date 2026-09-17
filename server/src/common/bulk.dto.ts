import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsInt,
  IsString,
} from 'class-validator';

export class BulkStringIdsDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(1000)
  @IsString({ each: true })
  ids: string[];
}

export class BulkNumberIdsDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(1000)
  @IsInt({ each: true })
  ids: number[];
}
