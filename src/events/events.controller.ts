import { Controller, Get, Query } from '@nestjs/common';
import { EventsService } from './events.service';

@Controller('events')
export class EventsController {
  constructor(private readonly events: EventsService) {}
  @Get()
  findPublic(@Query('limit') limit?: string, @Query('upcoming') upcoming?: string, @Query('offset') offset?: string) {
    return this.events.findPublic(limit, upcoming, offset);
  }
}
