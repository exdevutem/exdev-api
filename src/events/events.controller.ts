import { Public, Permissions } from '../auth/iam.service';
import {
  Body,
  Controller,
  Get,
  Query,
  Post,
  Patch,
  Param,
} from '@nestjs/common';
import { EventsService } from './events.service';

@Controller('events')
export class EventsController {
  constructor(private readonly events: EventsService) {}
  @Permissions('events.read')
  @Get('admin')
  findAdmin() {
    return this.events.findAdmin();
  }
  @Permissions('events.manage')
  @Post()
  create(@Body() body: unknown) {
    return this.events.create(body);
  }
  @Permissions('events.manage')
  @Patch(':id')
  update(@Param('id') id: string, @Body() body: unknown) {
    return this.events.update(id, body);
  }
  @Public()
  @Get()
  findPublic(
    @Query('limit') limit?: string,
    @Query('upcoming') upcoming?: string,
    @Query('offset') offset?: string,
  ) {
    return this.events.findPublic(limit, upcoming, offset);
  }
}
