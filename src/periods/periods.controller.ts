import { Permissions } from '../auth/iam.service';
import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { PeriodsService } from './periods.service';
@Controller('periods')
export class PeriodsController {
  constructor(private readonly periods: PeriodsService) {}
  @Permissions('application_periods.read')
  @Get()
  findAll() {
    return this.periods.findAll();
  }
  @Permissions('application_periods.manage')
  @Post()
  create(@Body() body: unknown) {
    return this.periods.create(body);
  }
  @Permissions('application_periods.manage')
  @Patch(':id')
  update(@Param('id') id: string, @Body() body: unknown) {
    return this.periods.update(id, body);
  }
}
