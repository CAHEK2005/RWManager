import { IsBoolean } from 'class-validator';
import { BulkStringIdsDto } from '../common/bulk.dto';

export class BulkRotationStateDto extends BulkStringIdsDto {
  @IsBoolean()
  enabled: boolean;
}
