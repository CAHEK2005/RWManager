import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';

export class InstallNodeRequestDto {
  @IsString()
  @MinLength(1)
  name: string;

  @IsString()
  @MinLength(1)
  ip: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65_535)
  sshPort?: number;

  @IsOptional()
  @IsString()
  sshUser?: string;

  @IsIn(['password', 'key'])
  authType: 'password' | 'key';

  @IsOptional()
  @IsString()
  password?: string;

  @IsOptional()
  @IsString()
  sshKey?: string;

  @IsOptional()
  @IsString()
  profileUuid?: string;

  @IsOptional()
  @IsBoolean()
  createNewProfile?: boolean;

  @IsOptional()
  @IsString()
  profileName?: string;

  @IsOptional()
  @IsString()
  countryCode?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65_535)
  nodePort?: number;

  @IsOptional()
  @IsBoolean()
  enableOptimization?: boolean;
}
