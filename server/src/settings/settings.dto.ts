import {
  IsBoolean,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  MinLength,
} from 'class-validator';

export class AddManagedProfileDto {
  @IsOptional()
  @IsString()
  uuid?: string;

  @IsString()
  @MinLength(1)
  name: string;

  @IsOptional()
  @IsBoolean()
  createNew?: boolean;
}

export class RenameManagedProfileDto {
  @IsString()
  @MinLength(1)
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
