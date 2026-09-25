import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ProjectsService } from './projects.service';

@Controller('projects')
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Get()
  findPublic(@Query('limit') limit?: string, @Query('featured') featured?: string) {
    return this.projectsService.findPublic(limit, featured);
  }

  // TODO(IAM): proteger este endpoint antes de habilitarlo en producción.
  @Post()
  create(@Body() body: unknown) {
    return this.projectsService.create(body);
  }
}
