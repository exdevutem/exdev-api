import { BadRequestException, Inject, Injectable, InternalServerErrorException } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../shared/connections/database.module';

@Injectable()
export class EventsService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}
  async findPublic(rawLimit = '20', rawUpcoming = 'true', rawOffset = '0') {
    if (!/^\d+$/.test(rawLimit) || !/^\d+$/.test(rawOffset)) throw new BadRequestException('Paginación inválida');
    const limit = Number(rawLimit), offset = Number(rawOffset);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || !Number.isSafeInteger(offset) || offset > 1000000) throw new BadRequestException('Paginación inválida');
    if (!['true', 'false'].includes(rawUpcoming)) throw new BadRequestException('upcoming debe ser true o false');
    try {
      const { rows } = await this.pool.query(`
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
      `, [limit + 1, rawUpcoming === 'true', offset]);
      return { data: rows.slice(0, limit), hasMore: rows.length > limit };
    } catch {
      throw new InternalServerErrorException('No fue posible cargar los eventos');
    }
  }
}
