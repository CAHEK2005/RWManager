import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateSecretDto {
  @IsString()
  @MinLength(1)
  name: string;

  @IsIn(['password', 'ssh-key', 'token', 'custom'])
  type: 'password' | 'ssh-key' | 'token' | 'custom';

  @IsString()
  @MinLength(1)
  value: string;

  @IsOptional()
  @IsString()
  description?: string;
}

export class UpdateSecretDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsIn(['password', 'ssh-key', 'token', 'custom'])
  type?: 'password' | 'ssh-key' | 'token' | 'custom';

  @IsOptional()
  @IsString()
  value?: string;

  @IsOptional()
  @IsString()
  description?: string;
}
