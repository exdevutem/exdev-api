import {
  BadRequestException,
  Inject,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../shared/connections/database.module';
import {
  boolean,
  choice,
  date,
  dateRange,
  optionalDate,
  optionalText,
  requiredText,
  saveRecord,
  url,
  RecordSpec,
} from '../common/admin-data';

const eventSpec: RecordSpec = {
  table: 'eventos',
  fields: {
    tipo_evento: requiredText,
    titulo_evento: requiredText,
    descripcion: optionalText,
    fecha_inicio: date,
    fecha_fin: optionalDate,
    fecha_texto: optionalText,
    ubicacion: optionalText,
    url_evento: url,
    tipo_accion: (value, field) =>
      value == null
        ? null
        : choice(['inscripcion', 'postulacion', 'acceso_libre'])(value, field),
    url_accion: url,
    estado: choice(['programado', 'cancelado', 'finalizado']),
    publicado: boolean,
  },
  defaults: {
    descripcion: null,
    fecha_fin: null,
    fecha_texto: null,
    ubicacion: null,
    url_evento: null,
    tipo_accion: null,
    url_accion: null,
    estado: 'programado',
    publicado: false,
  },
  validate(data) {
    dateRange(data.fecha_inicio, data.fecha_fin);
    const needsUrl = ['inscripcion', 'postulacion'].includes(
      String(data.tipo_accion),
    );
    if (needsUrl ? !data.url_accion : data.url_accion !== null)
      throw new BadRequestException(
        'El enlace debe corresponder a la acción del evento',
      );
  },
};

@Injectable()
export class EventsService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}
  async findAdmin() {
    const { rows } = await this.pool
      .query(`SELECT id,tipo_evento,titulo_evento,descripcion,
      to_char(fecha_inicio,'YYYY-MM-DD') AS fecha_inicio,to_char(fecha_fin,'YYYY-MM-DD') AS fecha_fin,
      fecha_texto,ubicacion,url_evento,tipo_accion,url_accion,estado,publicado FROM public.eventos ORDER BY fecha_inicio DESC,id DESC`);
    return { data: rows };
  }
  create(body: unknown) {
    return saveRecord(this.pool, eventSpec, body);
  }
  update(id: string, body: unknown) {
    return saveRecord(this.pool, eventSpec, body, id);
  }
  async findPublic(rawLimit = '20', rawUpcoming = 'true', rawOffset = '0') {
    if (!/^\d+$/.test(rawLimit) || !/^\d+$/.test(rawOffset))
      throw new BadRequestException('Paginación inválida');
    const limit = Number(rawLimit),
      offset = Number(rawOffset);
    if (
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 100 ||
      !Number.isSafeInteger(offset) ||
      offset > 1000000
    )
      throw new BadRequestException('Paginación inválida');
    if (!['true', 'false'].includes(rawUpcoming))
      throw new BadRequestException('upcoming debe ser true o false');
    try {
      const { rows } = await this.pool.query(
        `
        SELECT id, tipo_evento, titulo_evento, descripcion,
          to_char(fecha_inicio, 'YYYY-MM-DD') AS fecha_inicio,
          to_char(fecha_fin, 'YYYY-MM-DD') AS fecha_fin,
          fecha_texto, ubicacion, url_evento, tipo_accion, url_accion, estado
        FROM public.eventos
        WHERE publicado = true
          AND (NOT $2::boolean OR (
            estado = 'programado'
            AND COALESCE(fecha_fin, fecha_inicio) >= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Santiago')::date
          ))
        ORDER BY
          CASE WHEN COALESCE(fecha_fin, fecha_inicio) >= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Santiago')::date THEN 0 ELSE 1 END,
          CASE WHEN COALESCE(fecha_fin, fecha_inicio) >= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Santiago')::date THEN fecha_inicio END ASC,
          fecha_inicio DESC, id ASC
        LIMIT $1 OFFSET $3
      `,
        [limit + 1, rawUpcoming === 'true', offset],
      );
      return { data: rows.slice(0, limit), hasMore: rows.length > limit };
    } catch {
      throw new InternalServerErrorException(
        'No fue posible cargar los eventos',
      );
    }
  }
}
