import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../shared/connections/database.module';
import {
  choice,
  optionalText,
  requiredText,
  RecordSpec,
  saveRecord,
} from '../common/admin-data';
export type CatalogKind = 'roles' | 'specialties';
const tables: Record<CatalogKind, string> = {
  roles: 'roles_club',
  specialties: 'especialidades',
};
@Injectable()
export class CatalogsService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}
  async findAll(kind: CatalogKind) {
    const { rows } = await this.pool.query(
      `SELECT id,nombre,descripcion,estado FROM public.${tables[kind]} ORDER BY nombre,id`,
    );
    return { data: rows };
  }
  save(kind: CatalogKind, body: unknown, id?: string) {
    const spec: RecordSpec = {
      table: tables[kind],
      fields: {
        nombre: requiredText,
        descripcion: optionalText,
        estado: choice(['activo', 'inactivo']),
      },
      defaults: { descripcion: null, estado: 'activo' },
    };
    return saveRecord(this.pool, spec, body, id);
  }
}
