import { IsOptional, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @IsString()
  @MinLength(1)
  login: string;

  @IsString()
  @MinLength(1)
  password: string;
}

export class ChangePasswordDto {
  @IsString()
  @MinLength(1)
  password: string;
}

export class UpdateProfileDto {
  @IsString()
  @MinLength(1)
  login: string;

  @IsOptional()
  @IsString()
  password?: string;
}
