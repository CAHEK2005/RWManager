import {
  IsBoolean,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class AddManagedProfileDto {
  @IsOptional()
  @IsString()
  uuid?: string;

  @IsString()
  @MinLength(2)
  @MaxLength(30)
  @Matches(/^[A-Za-z0-9_\s-]+$/)
  name: string;

  @IsOptional()
  @IsBoolean()
  createNew?: boolean;
}

export class RenameManagedProfileDto {
  @IsString()
  @MinLength(2)
  @MaxLength(30)
  @Matches(/^[A-Za-z0-9_\s-]+$/)
  name: string;
}

export class CheckConnectionDto {
  @IsUrl({ require_protocol: true, protocols: ['http', 'https'] })
  remnawave_url: string;

  @IsString()
  @MinLength(1)
  remnawave_api_key: string;
}

export class UpdateHostTemplateDto {
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  template: string;
}

export class UpdateXrayConfigTemplateDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200_000)
  template: string;
}
