import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { MembersService } from './members.service';

@Controller('members')
export class MembersController {
  constructor(private readonly membersService: MembersService) {}

  @Get()
  findPublic(@Query('limit') limit?: string) {
    return this.membersService.findPublic(limit);
  }

  // TODO(IAM): proteger este endpoint antes de habilitarlo en producción.
  @Post()
  create(@Body() body: unknown) {
    return this.membersService.create(body);
  }
}
