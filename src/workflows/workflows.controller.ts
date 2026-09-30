import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { AuthRequest, Permissions, Public } from '../auth/iam.service';
import { WorkflowsService } from './workflows.service';

@Controller('announcements')
export class AnnouncementsController {
  constructor(private readonly service: WorkflowsService) {}
  @Permissions('announcements.read_all') @Get('admin') admin(
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.service.announcements(true, limit, offset);
  }
  @Public()
  @Get()
  list(
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.service.announcements(false, limit, offset);
  }
  @Permissions('announcements.create') @Post() create(
    @Req() req: AuthRequest,
    @Body() body: unknown,
  ) {
    return this.service.saveAnnouncement(req.actor, body);
  }
  @Permissions() @Patch(':id') edit(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('if-match') version?: string,
  ) {
    return this.service.saveAnnouncement(req.actor, body, id, version);
  }
  @Permissions('announcements.publish') @Patch(':id/publication') publish(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('if-match') version?: string,
  ) {
    return this.service.saveAnnouncement(req.actor, body, id, version, true);
  }
}

@Controller('applications')
export class ReviewController {
  constructor(private readonly service: WorkflowsService) {}
  @Permissions()
  @Get('voting-results')
  overview(@Query('offset') offset?: string) {
    return this.service.resultsOverview(offset);
  }
  @Permissions('votes.read_own') @Get(':id/my-vote') own(
    @Req() req: AuthRequest,
    @Param('id') id: string,
  ) {
    return this.service.myVote(req.actor, id);
  }
  @Permissions('votes.write_own') @Post(':id/my-vote') vote(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.service.vote(req.actor, id, body, false);
  }
  @Permissions('votes.write_own') @Patch(':id/my-vote') editVote(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('if-match') version?: string,
  ) {
    return this.service.vote(req.actor, id, body, true, version);
  }
  @Permissions()
  @Get(':id/votes')
  results(@Param('id') id: string) {
    return this.service.results(id);
  }
  @Permissions('applications.resolve') @Post(':id/resolution') resolve(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.service.resolve(req.actor, id, body, key);
  }
  @Permissions('applications.convert', 'members.manage')
  @Post(':id/member-conversion')
  convert(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.service.convert(req.actor, id, body, key);
  }
}
