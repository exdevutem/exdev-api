import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { PG_POOL } from '../shared/connections/database.module';
@Injectable()
export class OutboxService implements OnModuleInit, OnModuleDestroy {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private readonly logger = new Logger(OutboxService.name);
  onModuleInit() {
    this.timer = setInterval(() => void this.tick(), 30000);
    this.timer.unref();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
  async tick() {
    if (
      this.running ||
      !process.env.IAM_BASE_URL ||
      !process.env.IAM_SERVICE_TOKEN
    )
      return;
    this.running = true;
    try {
      const base = new URL(process.env.IAM_BASE_URL);
      if (
        base.username ||
        base.password ||
        (base.protocol !== 'https:' &&
          !(
            process.env.NODE_ENV !== 'production' &&
            base.protocol === 'http:' &&
            ['localhost', '127.0.0.1'].includes(base.hostname)
          ))
      )
        throw new Error();
      const token = randomUUID();
      const { rows } = await this.pool.query(
        `WITH candidate AS (SELECT id FROM public.iam_access_outbox WHERE processed_at IS NULL AND available_at<=clock_timestamp() AND (locked_until IS NULL OR locked_until<clock_timestamp()) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) UPDATE public.iam_access_outbox o SET lock_token=$1,locked_until=clock_timestamp()+interval '30 seconds',attempts=attempts+1 FROM candidate c WHERE o.id=c.id RETURNING o.id,o.iam_user_id,o.application_code`,
        [token],
      );
      const item = rows[0];
      if (!item) return;
      let success = false;
      try {
        if (
          item.application_code !==
          (process.env.IAM_APPLICATION_CODE || 'rafael')
        )
          throw new Error();
        const response = await fetch(
          `${base.origin}/internal/sessions/suspend-access`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${process.env.IAM_SERVICE_TOKEN}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ userId: item.iam_user_id }),
            signal: AbortSignal.timeout(5000),
            redirect: 'error',
          },
        );
        success = response.ok;
      } catch {
        /* Retried from the durable outbox. */
      }
      await this.pool.query(
        `UPDATE public.iam_access_outbox SET processed_at=CASE WHEN $3 THEN clock_timestamp() ELSE NULL END,available_at=CASE WHEN $3 THEN available_at ELSE clock_timestamp()+interval '1 minute' END,locked_until=NULL,lock_token=NULL,last_error_code=CASE WHEN $3 THEN NULL ELSE 'IAM_SUSPEND_FAILED' END WHERE id=$1 AND lock_token=$2`,
        [item.id, token, success],
      );
    } catch {
      this.logger.warn('No se pudo procesar la outbox IAM; se reintentará.');
    } finally {
      this.running = false;
    }
  }
}
