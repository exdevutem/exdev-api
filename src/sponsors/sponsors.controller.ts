import { Public, Permissions } from '../auth/iam.service';
import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { SponsorsService } from './sponsors.service';
@Controller('sponsors')
export class SponsorsController {
  constructor(private readonly sponsors: SponsorsService) {}
  @Public()
  @Get()
  findPublic() {
    return this.sponsors.findAll();
  }
  @Permissions('sponsors.read')
  @Get('admin')
  findAdmin() {
    return this.sponsors.findAll(true);
  }
  @Permissions('sponsors.manage')
  @Post()
  create(@Body() body: unknown) {
    return this.sponsors.create(body);
  }
  @Permissions('sponsors.manage')
  @Patch(':id')
  update(@Param('id') id: string, @Body() body: unknown) {
    return this.sponsors.update(id, body);
  }
}
