import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';

export class InstallNodeRequestDto {
  @IsString()
  @MinLength(3)
  @MaxLength(30)
  name: string;

  @IsString()
  @MinLength(2)
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
  @MinLength(2)
  @MaxLength(30)
  @Matches(/^[A-Za-z0-9_\s-]+$/)
  profileName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2)
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
