import { Module } from '@nestjs/common';
import { SharedModule } from '../shared/shared.module';
import { SponsorsController } from './sponsors.controller';
import { SponsorsService } from './sponsors.service';
@Module({
  imports: [SharedModule],
  controllers: [SponsorsController],
  providers: [SponsorsService],
})
export class SponsorsModule {}
