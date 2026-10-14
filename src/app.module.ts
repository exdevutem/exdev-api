import { WorkflowsModule } from './workflows/workflows.module';
import { AuthModule } from './auth/auth.module';
import { SponsorsModule } from './sponsors/sponsors.module';
import { CatalogsModule } from './catalogs/catalogs.module';
import { PeriodsModule } from './periods/periods.module';
import { Module } from '@nestjs/common';
import { ApplicationsModule } from './applications/applications.module';
import { SharedModule } from './shared/shared.module';
import { MembersModule } from './members/members.module';
import { ProjectsModule } from './projects/projects.module';
import { EventsModule } from './events/events.module';

@Module({
  imports: [
    AuthModule,
    WorkflowsModule,
    SponsorsModule,
    CatalogsModule,
    PeriodsModule,
    SharedModule,
    ApplicationsModule,
    MembersModule,
    ProjectsModule,
    EventsModule,
  ],
})
export class AppModule {}
