import {
  IsArray,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { IsInt, Min, Max } from 'class-validator';

export class SshNodeDto {
  @IsOptional()
  @IsString()
  id?: string;

  @IsOptional()
  @IsString()
  rwNodeUuid?: string;

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
  @IsArray()
  @IsString({ each: true })
  categoryIds?: string[];
}

export class CategoryDto {
  @IsString()
  @MinLength(1)
  name: string;
}

export class ScriptDto {
  @IsOptional()
  @IsString()
  id?: string;

  @IsString()
  @MinLength(1)
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsString()
  content: string;
}

export class FetchUrlDto {
  @IsUrl({ require_protocol: true, protocols: ['http', 'https'] })
  url: string;
}

export class ExecuteScriptDto {
  @IsString()
  scriptId: string;

  @IsArray()
  @IsString({ each: true })
  nodeIds: string[];

  @IsOptional()
  @IsObject()
  variables?: Record<string, string>;

  @IsOptional()
  @IsObject()
  variablesPerNode?: Record<string, Record<string, string>>;
}

export class ExecuteSequenceDto {
  @IsArray()
  @IsString({ each: true })
  scriptIds: string[];

  @IsArray()
  @IsString({ each: true })
  nodeIds: string[];

  @IsOptional()
  @IsObject()
  variablesPerScript?: Record<string, Record<string, string>>;

  @IsOptional()
  @IsObject()
  variablesPerScriptPerNode?: Record<
    string,
    Record<string, Record<string, string>>
  >;
}
