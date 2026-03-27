import { Module } from '@nestjs/common';
import { InboundBuilderService } from './inbound-builder.service';

@Module({
  providers: [InboundBuilderService],
  exports: [InboundBuilderService],
})
export class InboundsModule {}
