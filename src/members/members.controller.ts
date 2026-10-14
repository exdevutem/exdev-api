import { bodyObject } from '../common/admin-data';
import { Public, Permissions, AuthRequest } from '../auth/iam.service';
import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Patch,
  Param,
  Req,
} from '@nestjs/common';
import { MembersService } from './members.service';

@Controller('members')
export class MembersController {
  constructor(private readonly membersService: MembersService) {}

  @Permissions()
  @Get('me')
  async self(@Req() req: AuthRequest) {
    const result = await this.membersService.findAdmin(req.actor.memberId);
    return { data: result.data[0] };
  }
  @Permissions('profile.write_own')
  @Patch('me')
  updateSelf(@Req() req: AuthRequest, @Body() raw: unknown) {
    const body = bodyObject(
      raw,
      [
        'nombre',
        'carrera',
        'anioIngresoCarrera',
        'perfilPublico',
        'fotoPublica',
        'specialtyIds',
      ],
      true,
    );
    return this.membersService.update(
      req.actor.memberId,
      body,
      req.actor.memberId,
    );
  }

  @Permissions('members.read')
  @Get('admin')
  findAdmin() {
    return this.membersService.findAdmin();
  }

  @Permissions('members.manage')
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: AuthRequest,
  ) {
    return this.membersService.update(id, body, req.actor.memberId, req.actor);
  }

  @Public()
  @Get()
  findPublic(@Query('limit') limit?: string) {
    return this.membersService.findPublic(limit);
  }

  @Permissions('members.manage')
  @Post()
  create(@Body() body: unknown, @Req() req: AuthRequest) {
    return this.membersService.create(body, req.actor);
  }
}
