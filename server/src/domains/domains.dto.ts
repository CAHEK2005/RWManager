import { IsArray, IsString, IsUrl, MinLength } from 'class-validator';

export class CreateDomainDto {
  @IsString()
  @MinLength(1)
  name: string;
}

export class UploadDomainsDto {
  @IsArray()
  @IsString({ each: true })
  domains: string[];
}

export class PreviewUrlDto {
  @IsUrl({ require_protocol: true, protocols: ['http', 'https'] })
  url: string;
}
