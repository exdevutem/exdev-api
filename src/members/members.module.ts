import { Module } from '@nestjs/common';
import { SharedModule } from '../shared/shared.module';
import { MembersController } from './members.controller';
import { MembersService } from './members.service';

@Module({
  imports: [SharedModule],
  controllers: [MembersController],
  providers: [MembersService],
})
export class MembersModule {}
