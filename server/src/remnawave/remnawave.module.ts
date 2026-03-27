import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RemnavaveService } from './remnawave.service';
import { Setting } from '../settings/entities/setting.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Setting])],
  providers: [RemnavaveService],
  exports: [RemnavaveService],
})
export class RemnavaveModule {}
