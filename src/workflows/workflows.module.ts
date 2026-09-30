import { Module } from '@nestjs/common';
import { DatabaseModule } from '../shared/connections/database.module';
import { WorkflowsService } from './workflows.service';
import {
  AnnouncementsController,
  ReviewController,
} from './workflows.controller';
@Module({
  imports: [DatabaseModule],
  providers: [WorkflowsService],
  controllers: [AnnouncementsController, ReviewController],
})
export class WorkflowsModule {}
