import { Module } from '@nestjs/common';
import { SharedModule } from '../shared/shared.module';
import { PeriodsController } from './periods.controller';
import { PeriodsService } from './periods.service';
@Module({
  imports: [SharedModule],
  controllers: [PeriodsController],
  providers: [PeriodsService],
  exports: [PeriodsService],
})
export class PeriodsModule {}
