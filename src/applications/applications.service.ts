import {
  BadRequestException,
  HttpException,
  Inject,
  Injectable,
  Optional,
} from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { PG_POOL } from '../shared/connections/database.module';
import { PeriodsService } from '../periods/periods.service';
import { id } from '../common/admin-data';
import { encryptRut, normalizeRut } from './rut-encryption';

function fail(status: number, responseCode: string, message: string): never {
  throw new HttpException({ responseCode, message }, status);
}

function validate(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    fail(400, 'E002', 'Datos inválidos');
  }
  const input = body as Record<string, unknown>;
  const data: Record<string, unknown> = {};
  const texts: [string, number, boolean][] = [
    ['nombre_completo', 200, true],
    ['correo_institucional', 150, true],
    ['campus', 50, false],
    ['carrera', 100, true],
    ['area_interes1', 80, true],
    ['area_interes2', 80, false],
    ['area_interes3', 80, false],
    ['ayudantias', 1000, false],
    ['motivo_postulacion', 5000, false],
    ['proyecto_idea', 5000, false],
    ['portafolio', 500, false],
    ['postulacion_conjunta', 500, false],
    ['pitch', 10000, false],
    ['apodo', 100, false],
  ];
  for (const [field, max, required] of texts) {
    const value = input[field];
    if (value != null && typeof value !== 'string')
      fail(400, 'E002', `Campo inválido: ${field}`);
    const text = (value as string | undefined)?.trim() || null;
    if ((required && !text) || (text && text.length > max))
      fail(400, 'E002', `Campo inválido: ${field}`);
    data[field] = text;
  }
  const email = (data.correo_institucional as string).toLowerCase();
  if (!/^[^\s@]+@utem\.cl$/.test(email))
    fail(400, 'E002', 'Correo institucional inválido');
  data.correo_institucional = email;
  const currentYear = Number(
    new Intl.DateTimeFormat('en', {
      year: 'numeric',
      timeZone: 'America/Santiago',
    }).format(new Date()),
  );
  for (const [field, min, max] of [
    ['edad', 16, 99],
    ['anio_ingreso', currentYear - 10, currentYear],
    ['anio_actual', 1, 2147483647],
    ['horas_disponibles_semanales', 0, 2147483647],
  ] as [string, number, number][]) {
    const raw = input[field];
    if (raw == null || raw === '') {
      data[field] = null;
      continue;
    }
    if (
      typeof raw !== 'number' &&
      !(typeof raw === 'string' && /^\d+$/.test(raw))
    ) {
      fail(400, 'E002', `Campo inválido: ${field}`);
    }
    const value = Number(raw);
    if (!Number.isInteger(value) || value < min || value > max)
      fail(400, 'E002', `Campo inválido: ${field}`);
    data[field] = value;
  }
  const rut = normalizeRut(input.rut);
  if (!rut) fail(400, 'E002', 'RUT inválido');
  data.rut = rut;
  return data;
}

@Injectable()
export class ApplicationsService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Optional() private readonly periods?: PeriodsService,
  ) {}

  async create(body: unknown) {
    const data = validate(body);
    await this.periods?.synchronize();
    let client: PoolClient | undefined;
    let transaction = false;
    let discardConnection = false;
    try {
      // Fail closed if the encryption key is missing. Never fall back to plaintext.
      const encrypted = encryptRut(data.rut as string);
      client = await this.pool.connect();
      await client.query('BEGIN');
      transaction = true;
      // The lock serializes this submission against changes/cancellation of the period.
      const period = await client.query(`
        SELECT id FROM public.periodos_postulacion
        WHERE estado_periodo = 'habilitado'
        FOR UPDATE
      `);
      if (period.rows.length !== 1)
        fail(409, 'E004', 'No hay un período de postulaciones abierto');
      const periodId = period.rows[0].id;
      // Read the clock AFTER acquiring the lock, not the transaction start time.
      const window = await client.query(
        `
        SELECT id FROM public.periodos_postulacion
        WHERE id = $1 AND estado_periodo = 'habilitado'
          AND fecha_apertura <= clock_timestamp()
          AND clock_timestamp() < fecha_cierre
      `,
        [periodId],
      );
      if (window.rows.length !== 1)
        fail(409, 'E004', 'No hay un período de postulaciones abierto');

      const fields = [
        'nombre_completo',
        'edad',
        'correo_institucional',
        'campus',
        'carrera',
        'anio_ingreso',
        'anio_actual',
        'area_interes1',
        'area_interes2',
        'area_interes3',
        'ayudantias',
        'horas_disponibles_semanales',
        'motivo_postulacion',
        'proyecto_idea',
        'portafolio',
        'postulacion_conjunta',
        'pitch',
        'apodo',
      ];
      const values = [
        periodId,
        encrypted.ciphertext,
        encrypted.keyVersion,
        ...fields.map((field) => data[field]),
      ];
      const result = await client.query(
        `
        INSERT INTO public.postulaciones (
          periodo_id, rut_cifrado, rut_clave_version, ${fields.join(', ')}
        ) VALUES (${values.map((_, i) => `$${i + 1}`).join(', ')})
        RETURNING id
      `,
        values,
      );
      await client.query('COMMIT');
      transaction = false;
      return {
        responseCode: 'I001',
        message: 'La postulacion ha sido realizada con exito',
        // bigint is returned as a string by pg, avoiding precision loss.
        idPostulacion: result.rows[0].id,
      };
    } catch (error: unknown) {
      if (client && transaction) {
        try {
          await client.query('ROLLBACK');
        } catch {
          discardConnection = true;
        }
      }
      if (error instanceof HttpException) throw error;
      const code = (error as { code?: string })?.code;
      if (code === '23505')
        fail(409, 'E001', 'El correo ya tiene una postulación en este período');
      if (['23514', '23502', '22P02', '22001', '22003'].includes(code))
        fail(400, 'E002', 'Datos inválidos');
      // Do not expose pg details, request data, ciphertext, keys or exception causes.
      fail(500, 'E003', 'No se pudo registrar la postulación');
    } finally {
      client?.release(discardConnection);
    }
  }

  async findAll(
    rawLimit = '10',
    rawOffset = '0',
    state?: string,
    periodId?: string,
    search?: string,
  ) {
    if (!/^\d+$/.test(rawLimit) || !/^\d+$/.test(rawOffset))
      throw new BadRequestException('Paginación inválida');
    const limit = Number(rawLimit),
      offset = Number(rawOffset);
    if (
      ![10, 30, 50, 100].includes(limit) ||
      !Number.isSafeInteger(offset) ||
      offset > 2147483647
    )
      throw new BadRequestException(
        'limit debe ser 10, 30, 50 o 100; offset debe ser un entero no negativo',
      );
    if (
      state &&
      !['pendiente', 'aceptada', 'rechazada', 'retirada'].includes(state)
    )
      throw new BadRequestException('Estado inválido');
    const period = periodId ? id(periodId, 'periodo_id') : null;
    if (search && search.length > 200)
      throw new BadRequestException('La búsqueda es demasiado larga');
    try {
      const result = await this.pool.query(
        `WITH filtered AS (
        SELECT id, periodo_id, nombre_completo, edad, correo_institucional,
          campus, carrera, anio_ingreso, anio_actual, area_interes1, area_interes2, area_interes3, ayudantias,
          horas_disponibles_semanales, motivo_postulacion, proyecto_idea, portafolio, postulacion_conjunta,
          pitch, apodo, estado_postulacion, resuelta_en, resuelta_por, created_at, updated_at
        FROM public.postulaciones
        WHERE ($3::text IS NULL OR estado_postulacion=$3)
          AND ($4::bigint IS NULL OR periodo_id=$4)
          AND ($5::text IS NULL OR position(lower($5) in lower(nombre_completo || ' ' || correo_institucional))>0)
      ), page AS (SELECT id,periodo_id,nombre_completo,edad,correo_institucional,campus,carrera,anio_ingreso,anio_actual,area_interes1,area_interes2,area_interes3,ayudantias,horas_disponibles_semanales,motivo_postulacion,proyecto_idea,portafolio,postulacion_conjunta,pitch,apodo,estado_postulacion,resuelta_en,resuelta_por,created_at,updated_at FROM filtered ORDER BY created_at DESC, id DESC LIMIT $1 OFFSET $2)
      SELECT (SELECT count(*)::integer FROM filtered) AS total,
        COALESCE((SELECT json_agg(json_build_object(
          'id',id::text,'periodo_id',periodo_id::text,'nombre_completo',nombre_completo,'edad',edad,
          'correo_institucional',correo_institucional,'campus',campus,'carrera',carrera,'anio_ingreso',anio_ingreso,
          'anio_actual',anio_actual,'area_interes1',area_interes1,'area_interes2',area_interes2,'area_interes3',area_interes3,
          'ayudantias',ayudantias,'horas_disponibles_semanales',horas_disponibles_semanales,'motivo_postulacion',motivo_postulacion,
          'proyecto_idea',proyecto_idea,'portafolio',portafolio,'postulacion_conjunta',postulacion_conjunta,'pitch',pitch,'apodo',apodo,
          'estado_postulacion',estado_postulacion,'resuelta_en',resuelta_en,'resuelta_por',resuelta_por::text,
          'created_at',created_at,'updated_at',updated_at) ORDER BY created_at DESC,id DESC) FROM page),'[]'::json) AS postulaciones`,
        [limit, offset, state || null, period, search?.trim() || null],
      );
      const row = result.rows[0];
      return {
        totalPostulaciones: row.total,
        postulaciones: row.postulaciones,
        limit,
        offset,
        hasMore: offset + row.postulaciones.length < row.total,
      };
    } catch {
      fail(500, 'E003', 'No se pudieron consultar las postulaciones');
    }
  }
}
