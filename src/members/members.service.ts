import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Pool } from 'pg';
import {
  bodyObject,
  boolean,
  choice,
  id,
  ids,
  integer,
  optionalText,
  requiredText,
  transaction,
  Data,
} from '../common/admin-data';
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

  async findAdmin(memberId?: string) {
    const { rows } = await this.pool.query(
      `
      SELECT m.id, m.nombre, m.correo_institucional, m.carrera, m.anio_ingreso_carrera,
        m.estado, m.perfil_publico, m.foto_publica,
        COALESCE((SELECT json_agg(r.nombre ORDER BY r.nombre) FROM public.miembro_roles mr
          JOIN public.roles_club r ON r.id = mr.rol_id WHERE mr.miembro_id = m.id AND mr.estado = 'activo'), '[]') AS roles,
        COALESCE((SELECT json_agg(mr.rol_id::text ORDER BY mr.rol_id) FROM public.miembro_roles mr
          WHERE mr.miembro_id = m.id AND mr.estado = 'activo'), '[]') AS role_ids,
        COALESCE((SELECT json_agg(e.nombre ORDER BY e.nombre) FROM public.miembro_especialidades me
          JOIN public.especialidades e ON e.id = me.especialidad_id WHERE me.miembro_id = m.id), '[]') AS especialidades,
        COALESCE((SELECT json_agg(me.especialidad_id::text ORDER BY me.especialidad_id) FROM public.miembro_especialidades me
          WHERE me.miembro_id = m.id), '[]') AS specialty_ids
      FROM public.miembros m WHERE ($1::bigint IS NULL OR m.id=$1) ORDER BY m.nombre, m.id`,
      [memberId ?? null],
    );
    return { data: rows };
  }

  create(body: unknown) {
    return this.save(body);
  }
  update(memberId: string, body: unknown, actorId?: string) {
    return this.save(body, id(memberId), actorId);
  }

  private save(raw: unknown, memberId?: string, actorId?: string) {
    const fields = [
      'nombre',
      'correoInstitucional',
      'carrera',
      'anioIngresoCarrera',
      'estado',
      'perfilPublico',
      'fotoPublica',
      'roleIds',
      'specialtyIds',
    ];
    const body = bodyObject(raw, fields, !!memberId);
    return transaction(this.pool, async (client) => {
      let previous: Data = {
        estado: 'activo',
        perfilPublico: false,
        fotoPublica: false,
        correoInstitucional: null,
        anioIngresoCarrera: null,
      };
      if (memberId) {
        const result = await client.query(
          `SELECT iam_subject, nombre, correo_institucional AS "correoInstitucional", carrera,
          anio_ingreso_carrera AS "anioIngresoCarrera", estado, perfil_publico AS "perfilPublico", foto_publica AS "fotoPublica"
          FROM public.miembros WHERE id = $1 FOR UPDATE`,
          [memberId],
        );
        if (!result.rows.length)
          throw new NotFoundException('Miembro no encontrado');
        previous = result.rows[0];
      }
      const data = { ...previous, ...body };
      const nombre = requiredText(data.nombre, 'nombre');
      const carrera = requiredText(data.carrera, 'carrera');
      const email =
        optionalText(
          data.correoInstitucional,
          'correoInstitucional',
        )?.toLowerCase() ?? null;
      if (email && !/^[^\s@]+@utem\.cl$/.test(email))
        throw new BadRequestException('El correo debe pertenecer a @utem.cl');
      const year =
        data.anioIngresoCarrera == null
          ? null
          : integer(data.anioIngresoCarrera, 'anioIngresoCarrera');
      if (year !== null && (year < 1900 || year > 2100))
        throw new BadRequestException('Año de ingreso inválido');
      const estado = choice(['activo', 'inactivo'])(data.estado, 'estado');
      if (memberId && previous.iam_subject && estado !== previous.estado) {
        if (memberId === actorId && estado === 'inactivo')
          throw new BadRequestException(
            'No puedes desactivar tu propia cuenta',
          );
        if (estado === 'activo') {
          const pending = await client.query(
            'SELECT id FROM public.iam_access_outbox WHERE miembro_id=$1 AND processed_at IS NULL LIMIT 1',
            [memberId],
          );
          if (pending.rows.length)
            throw new BadRequestException(
              'La suspensión IAM sigue pendiente; vuelve a intentar después',
            );
        } else
          await client.query(
            'INSERT INTO public.iam_access_outbox(id,miembro_id,iam_user_id,application_code) VALUES($1,$2,$3,$4)',
            [
              randomUUID(),
              memberId,
              previous.iam_subject,
              process.env.IAM_APPLICATION_CODE || 'rafael',
            ],
          );
      }
      const profile = boolean(data.perfilPublico, 'perfilPublico');
      const photo = boolean(data.fotoPublica, 'fotoPublica');
      if (photo && !profile)
        throw new BadRequestException(
          'La foto pública requiere un perfil público',
        );
      const values = [nombre, email, carrera, year, estado, profile, photo];
      if (memberId)
        await client.query(
          `UPDATE public.miembros SET nombre=$1, correo_institucional=$2, carrera=$3, anio_ingreso_carrera=$4, estado=$5, perfil_publico=$6, foto_publica=$7 WHERE id=$8`,
          [...values, memberId],
        );
      else {
        const result = await client.query(
          `INSERT INTO public.miembros (nombre, correo_institucional, carrera, anio_ingreso_carrera, estado, perfil_publico, foto_publica) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
          values,
        );
        memberId = String(result.rows[0].id);
      }
      if (body.roleIds !== undefined) {
        const roleIds = ids(body.roleIds, 'roleIds');
        const existing = await client.query(
          `SELECT rol_id::text AS id FROM public.miembro_roles WHERE miembro_id=$1 AND estado='activo'`,
          [memberId],
        );
        const old = new Set(existing.rows.map((row) => String(row.id)));
        for (const roleId of roleIds.filter((value) => !old.has(value))) {
          const role = await client.query(
            `SELECT id FROM public.roles_club WHERE id=$1 AND estado='activo' FOR SHARE`,
            [roleId],
          );
          if (!role.rows.length)
            throw new BadRequestException(
              'Solo puedes asignar roles activos existentes',
            );
          await client.query(
            `INSERT INTO public.miembro_roles (miembro_id, rol_id) VALUES ($1,$2)`,
            [memberId, roleId],
          );
        }
        await client.query(
          `UPDATE public.miembro_roles SET estado='inactivo', finalizado_en=clock_timestamp() WHERE miembro_id=$1 AND estado='activo' AND NOT (rol_id=ANY($2::bigint[]))`,
          [memberId, roleIds],
        );
      }
      if (body.specialtyIds !== undefined) {
        const specialtyIds = ids(body.specialtyIds, 'specialtyIds');
        const existing = await client.query(
          `SELECT especialidad_id::text AS id FROM public.miembro_especialidades WHERE miembro_id=$1`,
          [memberId],
        );
        const old = new Set(existing.rows.map((row) => String(row.id)));
        for (const specialtyId of specialtyIds.filter(
          (value) => !old.has(value),
        )) {
          const specialty = await client.query(
            `SELECT id FROM public.especialidades WHERE id=$1 AND estado='activo' FOR SHARE`,
            [specialtyId],
          );
          if (!specialty.rows.length)
            throw new BadRequestException(
              'Solo puedes asignar especialidades activas existentes',
            );
          await client.query(
            `INSERT INTO public.miembro_especialidades (miembro_id, especialidad_id) VALUES ($1,$2)`,
            [memberId, specialtyId],
          );
        }
        await client.query(
          `DELETE FROM public.miembro_especialidades WHERE miembro_id=$1 AND NOT (especialidad_id=ANY($2::bigint[]))`,
          [memberId, specialtyIds],
        );
      }
      return { id: memberId };
    });
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
