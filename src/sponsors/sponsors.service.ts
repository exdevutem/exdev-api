import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../shared/connections/database.module';
import {
  boolean,
  choice,
  integer,
  optionalText,
  requiredText,
  RecordSpec,
  saveRecord,
} from '../common/admin-data';
const spec: RecordSpec = {
  table: 'patrocinadores',
  fields: {
    nombre_patrocinador: requiredText,
    descripcion_patrocinador: optionalText,
    estado_patrocinador: choice(['activo', 'inactivo']),
    publicado: boolean,
    orden: integer,
  },
  defaults: {
    descripcion_patrocinador: null,
    estado_patrocinador: 'activo',
    publicado: false,
    orden: 0,
  },
};
@Injectable()
export class SponsorsService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}
  async findAll(admin = false) {
    const { rows } = await this.pool.query(
      `SELECT id,nombre_patrocinador,descripcion_patrocinador,estado_patrocinador,publicado,orden FROM public.patrocinadores ${admin ? '' : "WHERE publicado=true AND estado_patrocinador='activo'"} ORDER BY orden,id`,
    );
    return { data: rows };
  }
  create(body: unknown) {
    return saveRecord(this.pool, spec, body);
  }
  update(id: string, body: unknown) {
    return saveRecord(this.pool, spec, body, id);
  }
}
