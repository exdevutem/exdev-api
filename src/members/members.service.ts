import { BadRequestException, ConflictException, Inject, Injectable, InternalServerErrorException } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../shared/connections/database.module';

@Injectable()
export class MembersService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async findPublic(rawLimit?: string) {
    const limit = this.parseLimit(rawLimit);
    const { rows } = await this.pool.query(
      `
        SELECT
          m.id,
          m.nombre,
          m.carrera,
          m.anio_ingreso_carrera,
          m.foto_publica,
          COALESCE((
            SELECT json_agg(r.nombre ORDER BY r.nombre)
            FROM public.miembro_roles mr
            JOIN public.roles_club r ON r.id = mr.rol_id
            WHERE mr.miembro_id = m.id
              AND mr.estado = 'activo'
              AND r.estado = 'activo'
          ), '[]'::json) AS roles,
          COALESCE((
            SELECT json_agg(e.nombre ORDER BY e.nombre)
            FROM public.miembro_especialidades me
            JOIN public.especialidades e ON e.id = me.especialidad_id
            WHERE me.miembro_id = m.id
              AND e.estado = 'activo'
          ), '[]'::json) AS especialidades
        FROM public.miembros m
        WHERE m.estado = 'activo'
          AND m.perfil_publico = true
        ORDER BY m.nombre
        LIMIT $1;
      `,
      [limit],
    );

    return { data: rows };
  }

  async create(rawBody: unknown) {
    const body = this.validateCreateBody(rawBody);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `INSERT INTO public.miembros
          (iam_subject, nombre, correo_institucional, carrera, anio_ingreso_carrera,
           estado, perfil_publico, foto_publica)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         RETURNING id;`,
        [body.iamSubject, body.nombre, body.correoInstitucional, body.carrera,
         body.anioIngresoCarrera, body.estado, body.perfilPublico, body.fotoPublica],
      );
      const memberId = rows[0].id;

      for (const roleId of body.roleIds) {
        await client.query(
          `INSERT INTO public.miembro_roles (miembro_id, rol_id, estado)
           VALUES ($1, $2, 'activo');`,
          [memberId, roleId],
        );
      }
      for (const specialtyId of body.specialtyIds) {
        await client.query(
          `INSERT INTO public.miembro_especialidades (miembro_id, especialidad_id)
           VALUES ($1, $2);`,
          [memberId, specialtyId],
        );
      }

      await client.query('COMMIT');
      return { message: 'Miembro creado correctamente', id: memberId };
    } catch (error: any) {
      await client.query('ROLLBACK');
      if (error?.code === '23505') throw new ConflictException('El miembro o una de sus asignaciones ya existe');
      if (['23503', '23514', '22P02'].includes(error?.code)) throw new BadRequestException('Los datos del miembro no son válidos');
      throw new InternalServerErrorException('No fue posible crear el miembro');
    } finally {
      client.release();
    }
  }

  private validateCreateBody(rawBody: unknown) {
    if (!rawBody || typeof rawBody !== 'object') throw new BadRequestException('El cuerpo es obligatorio');
    const body = rawBody as Record<string, unknown>;
    const nombre = this.requiredText(body.nombre, 'nombre');
    const correoInstitucional = this.requiredText(body.correoInstitucional, 'correoInstitucional').toLowerCase();
    if (!/^[^\s@]+@utem\.cl$/i.test(correoInstitucional)) {
      throw new BadRequestException('correoInstitucional debe pertenecer a @utem.cl');
    }
    const carrera = this.requiredText(body.carrera, 'carrera');
    const anioIngresoCarrera = Number(body.anioIngresoCarrera);
    if (!Number.isInteger(anioIngresoCarrera) || anioIngresoCarrera < 1900 || anioIngresoCarrera > 2100) {
      throw new BadRequestException('anioIngresoCarrera no es válido');
    }
    const estado = body.estado ?? 'activo';
    if (estado !== 'activo' && estado !== 'inactivo') throw new BadRequestException('estado no es válido');
    const perfilPublico = body.perfilPublico ?? false;
    const fotoPublica = body.fotoPublica ?? false;
    if (typeof perfilPublico !== 'boolean' || typeof fotoPublica !== 'boolean' || (fotoPublica && !perfilPublico)) {
      throw new BadRequestException('La configuración de visibilidad no es válida');
    }
    return {
      iamSubject: body.iamSubject === undefined || body.iamSubject === null ? null : this.requiredText(body.iamSubject, 'iamSubject'),
      nombre, correoInstitucional, carrera, anioIngresoCarrera, estado,
      perfilPublico, fotoPublica,
      roleIds: this.idArray(body.roleIds, 'roleIds'),
      specialtyIds: this.idArray(body.specialtyIds, 'specialtyIds'),
    };
  }

  private requiredText(value: unknown, field: string): string {
    if (typeof value !== 'string' || !value.trim()) throw new BadRequestException(`${field} es obligatorio`);
    return value.trim();
  }

  private idArray(value: unknown, field: string): number[] {
    if (value === undefined) return [];
    if (!Array.isArray(value)) throw new BadRequestException(`${field} debe ser un arreglo`);
    const ids = value.map(Number);
    if (ids.some((id) => !Number.isSafeInteger(id) || id < 1) || new Set(ids).size !== ids.length) {
      throw new BadRequestException(`${field} contiene IDs inválidos o repetidos`);
    }
    return ids;
  }

  private parseLimit(rawLimit?: string): number {
    if (rawLimit === undefined) return 4;
    const limit = Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new BadRequestException('limit debe ser un entero entre 1 y 100');
    }
    return limit;
  }
}
