import { Module } from '@nestjs/common';
import { ApplicationsModule } from './applications/applications.module';
import { SharedModule } from './shared/shared.module';
import { MembersModule } from './members/members.module';
import { ProjectsModule } from './projects/projects.module';
import { EventsModule } from './events/events.module';

@Module({
  imports: [SharedModule, ApplicationsModule, MembersModule, ProjectsModule, EventsModule],
})
export class AppModule {}
