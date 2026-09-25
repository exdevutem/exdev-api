import { BadRequestException, ConflictException, Inject, Injectable, InternalServerErrorException } from '@nestjs/common';
import { Pool } from 'pg';
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

  async create(rawBody: unknown) {
    const body = this.validateCreateBody(rawBody);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `INSERT INTO public.proyectos
          (nombre, descripcion_breve, descripcion, estado, fecha_inicio, fecha_fin,
           publicado, destacado, orden)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING id;`,
        [body.nombre, body.descripcionBreve, body.descripcion, body.estado,
         body.fechaInicio, body.fechaFin, body.publicado, body.destacado, body.orden],
      );
      const projectId = rows[0].id;

      for (const member of body.members) {
        await client.query(
          `INSERT INTO public.proyecto_miembros
            (proyecto_id, miembro_id, funcion, fecha_inicio, fecha_fin)
           VALUES ($1,$2,$3,$4,$5);`,
          [projectId, member.memberId, member.functionName, member.startDate, member.endDate],
        );
      }

      await client.query('COMMIT');
      return { message: 'Proyecto creado correctamente', id: projectId };
    } catch (error: any) {
      await client.query('ROLLBACK');
      if (error?.code === '23505') throw new ConflictException('El proyecto o uno de sus miembros ya existe');
      if (['23503', '23514', '22P02', '22007'].includes(error?.code)) throw new BadRequestException('Los datos del proyecto no son válidos');
      throw new InternalServerErrorException('No fue posible crear el proyecto');
    } finally {
      client.release();
    }
  }

  private validateCreateBody(rawBody: unknown) {
    if (!rawBody || typeof rawBody !== 'object') throw new BadRequestException('El cuerpo es obligatorio');
    const body = rawBody as Record<string, unknown>;
    const estado = body.estado ?? 'planificacion';
    const validStates = ['planificacion', 'activo', 'bloqueado', 'pausado', 'completado', 'cancelado'];
    if (typeof estado !== 'string' || !validStates.includes(estado)) throw new BadRequestException('estado no es válido');
    const publicado = body.publicado ?? false;
    const destacado = body.destacado ?? false;
    if (typeof publicado !== 'boolean' || typeof destacado !== 'boolean' || (destacado && !publicado)) {
      throw new BadRequestException('La configuración de publicación no es válida');
    }
    const orden = body.orden ?? 0;
    if (!Number.isSafeInteger(orden)) throw new BadRequestException('orden debe ser un entero');
    const members = body.members ?? [];
    if (!Array.isArray(members)) throw new BadRequestException('members debe ser un arreglo');
    const parsedMembers = members.map((rawMember) => this.parseMember(rawMember));
    const memberIds = parsedMembers.map((member) => member.memberId);
    if (new Set(memberIds).size !== memberIds.length) throw new BadRequestException('Un miembro no puede repetirse en el proyecto');

    return {
      nombre: this.requiredText(body.nombre, 'nombre'),
      descripcionBreve: this.optionalText(body.descripcionBreve, 'descripcionBreve'),
      descripcion: this.optionalText(body.descripcion, 'descripcion'),
      estado,
      fechaInicio: this.optionalDate(body.fechaInicio, 'fechaInicio'),
      fechaFin: this.optionalDate(body.fechaFin, 'fechaFin'),
      publicado, destacado, orden,
      members: parsedMembers,
    };
  }

  private parseMember(rawMember: unknown) {
    if (!rawMember || typeof rawMember !== 'object') throw new BadRequestException('Cada miembro del proyecto debe ser un objeto');
    const member = rawMember as Record<string, unknown>;
    const memberId = Number(member.memberId);
    if (!Number.isSafeInteger(memberId) || memberId < 1) throw new BadRequestException('memberId no es válido');
    return {
      memberId,
      functionName: this.optionalText(member.functionName, 'functionName'),
      startDate: this.optionalDate(member.startDate, 'startDate'),
      endDate: this.optionalDate(member.endDate, 'endDate'),
    };
  }

  private requiredText(value: unknown, field: string): string {
    if (typeof value !== 'string' || !value.trim()) throw new BadRequestException(`${field} es obligatorio`);
    return value.trim();
  }

  private optionalText(value: unknown, field: string): string | null {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value !== 'string') throw new BadRequestException(`${field} debe ser texto`);
    return value.trim() || null;
  }

  private optionalDate(value: unknown, field: string): string | null {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new BadRequestException(`${field} debe usar el formato YYYY-MM-DD`);
    }
    return value;
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
