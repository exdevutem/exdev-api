import { OutboxService } from './outbox.service';
import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { DatabaseModule } from '../shared/connections/database.module';
import { IamGuard, IamService } from './iam.service';

@Global()
@Module({
  imports: [DatabaseModule],
  providers: [
    OutboxService,
    IamService,
    IamGuard,
    { provide: APP_GUARD, useExisting: IamGuard },
  ],
  exports: [IamService],
})
export class AuthModule {}
