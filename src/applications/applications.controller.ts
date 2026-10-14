import { Public, Permissions } from '../auth/iam.service';
import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApplicationsService } from './applications.service';
@Controller('applications')
export class ApplicationsController {
  constructor(private readonly applicationsService: ApplicationsService) {}
  @Public()
  @Post()
  create(@Body() body: unknown) {
    return this.applicationsService.create(body);
  }
  @Permissions('applications.read')
  @Get()
  findAll(
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('estado') state?: string,
    @Query('periodo_id') period?: string,
    @Query('search') search?: string,
  ) {
    return this.applicationsService.findAll(
      limit,
      offset,
      state,
      period,
      search,
    );
  }
}
