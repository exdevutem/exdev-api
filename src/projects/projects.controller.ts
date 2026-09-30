import { Public, Permissions } from '../auth/iam.service';
import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Patch,
  Param,
} from '@nestjs/common';
import { ProjectsService } from './projects.service';

@Controller('projects')
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Permissions('projects.read')
  @Get('admin')
  findAdmin() {
    return this.projectsService.findAdmin();
  }

  @Permissions('projects.manage')
  @Patch(':id')
  update(@Param('id') id: string, @Body() body: unknown) {
    return this.projectsService.update(id, body);
  }

  @Public()
  @Get()
  findPublic(
    @Query('limit') limit?: string,
    @Query('featured') featured?: string,
  ) {
    return this.projectsService.findPublic(limit, featured);
  }

  @Permissions('projects.manage')
  @Post()
  create(@Body() body: unknown) {
    return this.projectsService.create(body);
  }
}
