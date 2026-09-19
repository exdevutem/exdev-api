import { Inject, Injectable, InternalServerErrorException, HttpException  } from '@nestjs/common';
import { PG_POOL } from 'src/shared/connections/database.module';
import { Pool } from 'pg';
import { buildErrorExceptionPayload  } from 'src/common/error-response';
@Injectable()
export class ApplicationsService {
    constructor(@Inject(PG_POOL) private readonly pool: Pool) {}
async create(body: any){
    const sql = `
        INSERT INTO postulaciones (
        nombre_completo,
        rut,
        edad,
        correo_institucional,
        campus,
        carrera,
        anio_ingreso,
        anio_actual,
        area_interes1,
        area_interes2,
        area_interes3,
        ayudantias,
        horas_disponibles_semanales,
        motivo_postulacion,
        proyecto_idea,
        portafolio,
        postulacion_conjunta,
        pitch,
        apodo
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19
      )
      RETURNING id;
    `;

      const values = [
      body?.nombre_completo ?? null,
      body?.rut ?? null,
      body?.edad ?? null,
      body?.correo_institucional ?? null,
      body?.campus ?? null,
      body?.carrera ?? null,
      body?.anio_ingreso ?? null,
      body?.anio_actual ?? null,
      body?.area_interes1 ?? null,
      body?.area_interes2 ?? null,
      body?.area_interes3 ?? null,
      body?.ayudantias ?? null,
      body?.horas_disponibles_semanales ?? null,
      body?.motivo_postulacion ?? null,
      body?.proyecto_idea ?? null,
      body?.portafolio ?? null,
      body?.postulacion_conjunta ?? null,
      body?.pitch ?? null,
      body?.apodo ?? null,
    ];

    try {
      const { rows } = await this.pool.query(sql, values);
      return {
        responseCode: 'I001',
        message: 'La postulacion ha sido realizada con exito',
        idPostulacion: rows[0].id as number
      }
    } catch (err: any) {
      const { status, body } = buildErrorExceptionPayload(err);
      throw new HttpException(body, status, { cause: err });
    }
  }

  async findAll() {
    const countSql = `SELECT COUNT(*)::int AS total FROM postulaciones;`;

    const listSql = `
      SELECT
        id,
        nombre_completo,
        rut,
        edad,
        correo_institucional,
        campus,
        carrera,
        anio_ingreso,
        anio_actual,
        area_interes1,
        area_interes2,
        area_interes3,
        ayudantias,
        horas_disponibles_semanales,
        motivo_postulacion,
        proyecto_idea,
        portafolio,
        postulacion_conjunta,
        pitch,
        apodo,
        created_at,
        updated_at
      FROM postulaciones
      ORDER BY created_at DESC;
    `;

    try {
      const [countRes, listRes] = await Promise.all([
        this.pool.query(countSql),
        this.pool.query(listSql),
      ]);

      return {
        totalPostulaciones: countRes.rows[0].total as number,
        postulaciones: listRes.rows,
      };
    } catch (err: any) {
      const { status, body } = buildErrorExceptionPayload(err);
      throw new HttpException(body, status, { cause: err });
    }
  }

}
