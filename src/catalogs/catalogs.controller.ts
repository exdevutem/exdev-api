import { Permissions } from '../auth/iam.service';
import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { CatalogsService } from './catalogs.service';
@Controller('roles')
export class RolesController {
  constructor(private readonly catalogs: CatalogsService) {}
  @Permissions('club_roles.read')
  @Get()
  findAll() {
    return this.catalogs.findAll('roles');
  }
  @Permissions('club_roles.manage')
  @Post()
  create(@Body() body: unknown) {
    return this.catalogs.save('roles', body);
  }
  @Permissions('club_roles.manage')
  @Patch(':id')
  update(@Param('id') id: string, @Body() body: unknown) {
    return this.catalogs.save('roles', body, id);
  }
}
@Controller('specialties')
export class SpecialtiesController {
  constructor(private readonly catalogs: CatalogsService) {}
  @Permissions('specialties.read')
  @Get()
  findAll() {
    return this.catalogs.findAll('specialties');
  }
  @Permissions('specialties.manage')
  @Post()
  create(@Body() body: unknown) {
    return this.catalogs.save('specialties', body);
  }
  @Permissions('specialties.manage')
  @Patch(':id')
  update(@Param('id') id: string, @Body() body: unknown) {
    return this.catalogs.save('specialties', body, id);
  }
}
