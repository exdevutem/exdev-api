import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { PG_POOL } from '../shared/connections/database.module';
import {
  bodyObject,
  choice,
  id,
  optionalText,
  requiredText,
  timestamp,
  transaction,
} from '../common/admin-data';

@Injectable()
export class PeriodsService implements OnModuleInit, OnModuleDestroy {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private readonly logger = new Logger(PeriodsService.name);
  private warned = false;
  onModuleInit() {
    void this.tick();
    this.timer = setInterval(() => void this.tick(), 30000);
    this.timer.unref();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
  private async tick() {
    if (this.running) return;
    this.running = true;
    try {
      await this.synchronize();
    } catch {
      if (!this.warned) {
        this.logger.warn(
          'No se pudieron actualizar los períodos. Revisa la conexión y la migración de programación.',
        );
        this.warned = true;
      }
    } finally {
      this.running = false;
    }
  }
  private async hasMigration(client: PoolClient) {
    const result = await client.query(
      `SELECT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass('public.periodos_postulacion') AND conname='periodos_recepcion_sin_superposicion') AS ready`,
    );
    return result.rows[0]?.ready === true;
  }
  private async lockAndSync(client: PoolClient, required = true) {
    // All API writers serialize period changes across processes, then acquire row locks.
    await client.query('SELECT pg_advisory_xact_lock(74102931)');
    if (!(await this.hasMigration(client))) {
      if (required)
        throw new ConflictException(
          'Falta aplicar la migración de programación de períodos',
        );
      if (!this.warned) {
        this.logger.warn(
          'Programación automática pendiente: falta la migración de períodos.',
        );
        this.warned = true;
      }
      return false;
    }
    await client.query(
      `UPDATE public.periodos_postulacion SET estado_periodo='cerrado' WHERE estado_periodo IN ('creado','habilitado') AND fecha_cierre<=clock_timestamp()`,
    );
    await client.query(
      `UPDATE public.periodos_postulacion SET estado_periodo='habilitado' WHERE estado_periodo='creado' AND fecha_apertura<=clock_timestamp() AND clock_timestamp()<fecha_cierre`,
    );
    return true;
  }
  synchronize() {
    return transaction(this.pool, (client) => this.lockAndSync(client, false));
  }
  async findAll() {
    await this.synchronize();
    const { rows } = await this.pool.query(
      `SELECT id,nombre_periodo,descripcion,fecha_apertura,fecha_cierre,fecha_cierre_votacion,estado_periodo FROM public.periodos_postulacion ORDER BY fecha_apertura DESC,id DESC`,
    );
    return { data: rows };
  }
  create(body: unknown) {
    return this.save(body);
  }
  update(periodId: string, body: unknown) {
    return this.save(body, id(periodId));
  }
  private save(raw: unknown, periodId?: string) {
    const body = bodyObject(
      raw,
      [
        'nombre_periodo',
        'descripcion',
        'fecha_apertura',
        'fecha_cierre',
        'fecha_cierre_votacion',
        'estado_periodo',
      ],
      !!periodId,
    );
    return transaction(this.pool, async (client) => {
      await this.lockAndSync(client);
      let previous: Record<string, unknown> = {
        descripcion: null,
        estado_periodo: 'creado',
      };
      if (periodId) {
        const result = await client.query(
          `SELECT nombre_periodo,descripcion,fecha_apertura,fecha_cierre,fecha_cierre_votacion,estado_periodo FROM public.periodos_postulacion WHERE id=$1 FOR UPDATE`,
          [periodId],
        );
        if (!result.rows.length)
          throw new NotFoundException('Período no encontrado');
        previous = result.rows[0];
        for (const key of [
          'fecha_apertura',
          'fecha_cierre',
          'fecha_cierre_votacion',
        ])
          if (previous[key] instanceof Date)
            previous[key] = (previous[key] as Date).toISOString();
      }
      const merged = { ...previous, ...body };
      const opening = timestamp(merged.fecha_apertura, 'fecha_apertura'),
        closing = timestamp(merged.fecha_cierre, 'fecha_cierre'),
        voting = timestamp(
          merged.fecha_cierre_votacion,
          'fecha_cierre_votacion',
        );
      if (closing <= opening || voting < closing)
        throw new BadRequestException(
          'El cierre debe ser posterior a la apertura y la votación no puede cerrar antes de la recepción',
        );
      const state = choice(['creado', 'habilitado', 'cerrado', 'cancelado'])(
        merged.estado_periodo,
        'estado_periodo',
      );
      const clock = await client.query('SELECT clock_timestamp() AS instant');
      const now = new Date(clock.rows[0].instant).toISOString();
      if (!periodId && (state !== 'creado' || opening <= now))
        throw new BadRequestException(
          'El nuevo período debe programarse con una apertura futura y estado creado',
        );
      if (periodId) {
        const old = previous.estado_periodo;
        const allowed =
          old === 'creado'
            ? ['creado', 'cancelado']
            : old === 'habilitado'
              ? ['habilitado', 'cerrado', 'cancelado']
              : [old];
        if (!allowed.includes(state))
          throw new BadRequestException(
            'La transición de estado no está permitida',
          );
        if (
          old !== 'creado' &&
          (opening !== previous.fecha_apertura ||
            (closing !== previous.fecha_cierre && old !== 'habilitado'))
        )
          throw new BadRequestException(
            'No se pueden cambiar las fechas de recepción de este período',
          );
        if (old === 'creado' && state === 'creado' && opening <= now)
          throw new BadRequestException(
            'La apertura programada debe ser futura',
          );
        if (
          ['cerrado', 'cancelado'].includes(String(old)) &&
          voting !== previous.fecha_cierre_votacion
        )
          throw new BadRequestException(
            'No se puede reprogramar la votación de un período terminado',
          );
      }
      const values = [
        requiredText(merged.nombre_periodo, 'nombre_periodo'),
        optionalText(merged.descripcion, 'descripcion'),
        opening,
        closing,
        voting,
        state,
      ];
      if (periodId)
        await client.query(
          `UPDATE public.periodos_postulacion SET nombre_periodo=$1,descripcion=$2,fecha_apertura=$3,fecha_cierre=$4,fecha_cierre_votacion=$5,estado_periodo=$6 WHERE id=$7`,
          [...values, periodId],
        );
      else {
        const result = await client.query(
          `INSERT INTO public.periodos_postulacion (nombre_periodo,descripcion,fecha_apertura,fecha_cierre,fecha_cierre_votacion,estado_periodo) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
          values,
        );
        periodId = String(result.rows[0].id);
      }
      await this.lockAndSync(client);
      return { id: periodId };
    });
  }
}
