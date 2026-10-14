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
  dateRange,
  id,
  ids,
  integer,
  optionalDate,
  optionalText,
  requiredText,
  transaction,
  Data,
} from '../common/admin-data';
import { PG_POOL } from '../shared/connections/database.module';

@Injectable()
export class ProjectsService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async findPublic(rawLimit?: string, rawFeatured?: string) {
    const limit = this.parseLimit(rawLimit);
    const featured = this.parseFeatured(rawFeatured);
    const { rows } = await this.pool.query(
      `
        SELECT
          p.id,
          p.nombre,
          p.descripcion_breve,
          p.descripcion,
          p.estado,
          p.fecha_inicio,
          p.fecha_fin,
          p.destacado,
          COALESCE((
            SELECT json_agg(
              json_build_object('id', m.id, 'nombre', m.nombre, 'funcion', pm.funcion)
              ORDER BY m.nombre
            )
            FROM public.proyecto_miembros pm
            JOIN public.miembros m ON m.id = pm.miembro_id
            WHERE pm.proyecto_id = p.id
              AND m.estado = 'activo'
              AND m.perfil_publico = true
          ), '[]'::json) AS miembros
        FROM public.proyectos p
        WHERE p.publicado = true
          AND ($2::boolean IS NULL OR p.destacado = $2)
        ORDER BY p.orden ASC, p.created_at DESC
        LIMIT $1;
      `,
      [limit, featured],
    );

    return { data: rows };
  }

  async findAdmin() {
    const { rows } = await this.pool
      .query(`SELECT p.id, p.nombre, p.descripcion_breve, p.descripcion,
      p.estado, to_char(p.fecha_inicio,'YYYY-MM-DD') AS fecha_inicio, to_char(p.fecha_fin,'YYYY-MM-DD') AS fecha_fin,
      p.publicado, p.destacado, p.orden,
      COALESCE((SELECT json_agg(json_build_object('id',m.id::text,'nombre',m.nombre,'funcion',pm.funcion,
        'fecha_inicio',to_char(pm.fecha_inicio,'YYYY-MM-DD'),'fecha_fin',to_char(pm.fecha_fin,'YYYY-MM-DD')) ORDER BY m.nombre,m.id)
        FROM public.proyecto_miembros pm JOIN public.miembros m ON m.id=pm.miembro_id WHERE pm.proyecto_id=p.id),'[]') AS miembros
      FROM public.proyectos p ORDER BY p.orden,p.created_at DESC,p.id DESC`);
    return { data: rows };
  }
  create(body: unknown) {
    return this.save(body);
  }
  update(projectId: string, body: unknown) {
    return this.save(body, id(projectId));
  }
  private save(raw: unknown, projectId?: string) {
    const body = bodyObject(
      raw,
      [
        'nombre',
        'descripcionBreve',
        'descripcion',
        'estado',
        'fechaInicio',
        'fechaFin',
        'publicado',
        'destacado',
        'orden',
        'members',
      ],
      !!projectId,
    );
    return transaction(this.pool, async (client) => {
      let previous: Data = {
        descripcionBreve: null,
        descripcion: null,
        estado: 'planificacion',
        fechaInicio: null,
        fechaFin: null,
        publicado: false,
        destacado: false,
        orden: 0,
      };
      if (projectId) {
        const result = await client.query(
          `SELECT nombre, descripcion_breve AS "descripcionBreve", descripcion, estado,
          to_char(fecha_inicio,'YYYY-MM-DD') AS "fechaInicio", to_char(fecha_fin,'YYYY-MM-DD') AS "fechaFin", publicado, destacado, orden
          FROM public.proyectos WHERE id=$1 FOR UPDATE`,
          [projectId],
        );
        if (!result.rows.length)
          throw new NotFoundException('Proyecto no encontrado');
        previous = result.rows[0];
      }
      const data = { ...previous, ...body };
      const start = optionalDate(data.fechaInicio, 'fechaInicio'),
        end = optionalDate(data.fechaFin, 'fechaFin');
      dateRange(start, end);
      const published = boolean(data.publicado, 'publicado'),
        featured = boolean(data.destacado, 'destacado');
      if (featured && !published)
        throw new BadRequestException('Destacado requiere publicación');
      const values = [
        requiredText(data.nombre, 'nombre'),
        optionalText(data.descripcionBreve, 'descripcionBreve'),
        optionalText(data.descripcion, 'descripcion'),
        choice([
          'planificacion',
          'activo',
          'bloqueado',
          'pausado',
          'completado',
          'cancelado',
        ])(data.estado, 'estado'),
        start,
        end,
        published,
        featured,
        integer(data.orden, 'orden'),
      ];
      if (projectId)
        await client.query(
          `UPDATE public.proyectos SET nombre=$1,descripcion_breve=$2,descripcion=$3,estado=$4,fecha_inicio=$5,fecha_fin=$6,publicado=$7,destacado=$8,orden=$9 WHERE id=$10`,
          [...values, projectId],
        );
      else {
        const result = await client.query(
          `INSERT INTO public.proyectos (nombre,descripcion_breve,descripcion,estado,fecha_inicio,fecha_fin,publicado,destacado,orden) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
          values,
        );
        projectId = String(result.rows[0].id);
      }
      if (body.members !== undefined) {
        if (!Array.isArray(body.members))
          throw new BadRequestException('members debe ser un arreglo');
        const members = body.members.map((rawMember) => {
          const m = bodyObject(rawMember, [
            'memberId',
            'functionName',
            'startDate',
            'endDate',
          ]);
          const startDate = optionalDate(m.startDate, 'startDate'),
            endDate = optionalDate(m.endDate, 'endDate');
          dateRange(startDate, endDate);
          return {
            memberId: id(m.memberId, 'memberId'),
            functionName: optionalText(m.functionName, 'functionName'),
            startDate,
            endDate,
          };
        });
        const memberIds = ids(
          members.map((m) => m.memberId),
          'members',
        );
        for (const member of members) {
          await client.query(
            `INSERT INTO public.proyecto_miembros (proyecto_id,miembro_id,funcion,fecha_inicio,fecha_fin) VALUES ($1,$2,$3,$4,$5)
            ON CONFLICT (proyecto_id,miembro_id) DO UPDATE SET funcion=EXCLUDED.funcion,fecha_inicio=EXCLUDED.fecha_inicio,fecha_fin=EXCLUDED.fecha_fin`,
            [
              projectId,
              member.memberId,
              member.functionName,
              member.startDate,
              member.endDate,
            ],
          );
        }
        await client.query(
          `DELETE FROM public.proyecto_miembros WHERE proyecto_id=$1 AND NOT (miembro_id=ANY($2::bigint[]))`,
          [projectId, memberIds],
        );
      }
      return { id: projectId };
    });
  }

  private parseLimit(rawLimit?: string): number {
    if (rawLimit === undefined) return 100;
    const limit = Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new BadRequestException('limit debe ser un entero entre 1 y 100');
    }
    return limit;
  }

  private parseFeatured(rawFeatured?: string): boolean | null {
    if (rawFeatured === undefined) return null;
    if (rawFeatured === 'true') return true;
    if (rawFeatured === 'false') return false;
    throw new BadRequestException('featured debe ser true o false');
  }
}
