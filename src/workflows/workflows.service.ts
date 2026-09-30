import {
  BadRequestException,
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { Pool, PoolClient } from 'pg';
import { PG_POOL } from '../shared/connections/database.module';
import { Actor, IamService } from '../auth/iam.service';
import {
  bodyObject,
  boolean,
  choice,
  date,
  dateRange,
  id,
  optionalDate,
  optionalText,
  requiredText,
  transaction,
} from '../common/admin-data';

const versionColumn =
  "to_char(updated_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US') AS version";
function match(actual: string, supplied?: string) {
  if (!supplied)
    throw new HttpException(
      'Falta la versión del registro; vuelve a cargarlo',
      428,
    );
  if (supplied !== actual)
    throw new HttpException(
      'El registro cambió; vuelve a cargarlo antes de editar',
      412,
    );
}
function key(value?: string) {
  if (
    !value ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
    throw new BadRequestException('Idempotency-Key debe ser UUID');
  return value.toLowerCase();
}
const fingerprint = (data: object) =>
  createHash('sha256').update(JSON.stringify(data)).digest();

@Injectable()
export class WorkflowsService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly iam: IamService,
  ) {}
  private async ready(client: PoolClient, conversion = false) {
    const { rows } = await client.query(
      "SELECT to_regclass('public.business_audit_events') IS NOT NULL AND ($1::boolean=false OR to_regclass('public.postulacion_miembro_conversiones') IS NOT NULL) AS ready",
      [conversion],
    );
    if (!rows[0]?.ready)
      throw new ServiceUnavailableException(
        'Falta aplicar 005_rafael_auditoria_conversiones.sql',
      );
  }
  private async audit(
    client: PoolClient,
    actor: Actor,
    action: string,
    resource: string,
    result: object,
    detail: object = {},
    idem?: string,
    hash?: Buffer,
  ) {
    await client.query(
      `INSERT INTO public.business_audit_events(actor_iam_subject,actor_miembro_id,action,resource_type,resource_id,request_id,idempotency_key,request_fingerprint,result,detail) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        actor.userId,
        actor.memberId,
        action,
        action.startsWith('announcement') ? 'anuncio' : 'postulacion',
        resource,
        randomUUID(),
        idem || null,
        hash || null,
        result,
        detail,
      ],
    );
  }
  async announcements(admin: boolean, rawLimit = '30', rawOffset = '0') {
    if (
      !/^\d+$/.test(rawLimit) ||
      !/^\d+$/.test(rawOffset) ||
      +rawLimit < 1 ||
      +rawLimit > 100 ||
      !Number.isSafeInteger(+rawOffset) ||
      +rawOffset > 2147483647
    )
      throw new BadRequestException('Paginación inválida');
    const { rows } = await this.pool.query(
      `SELECT a.id::text,a.titulo,a.contenido,a.autor_id::text,m.nombre AS autor_nombre,to_char(a.fecha_inicio,'YYYY-MM-DD') AS fecha_inicio,to_char(a.fecha_fin,'YYYY-MM-DD') AS fecha_fin,a.publicado,to_char(a.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US') AS version FROM public.anuncios a JOIN public.miembros m ON m.id=a.autor_id WHERE ($1::boolean OR (a.publicado AND a.fecha_inicio<=(clock_timestamp() AT TIME ZONE 'America/Santiago')::date AND (a.fecha_fin IS NULL OR a.fecha_fin>=(clock_timestamp() AT TIME ZONE 'America/Santiago')::date))) ORDER BY a.fecha_inicio DESC,a.id DESC LIMIT $2 OFFSET $3`,
      [admin, +rawLimit + 1, +rawOffset],
    );
    return { data: rows.slice(0, +rawLimit), hasMore: rows.length > +rawLimit };
  }
  saveAnnouncement(
    actor: Actor,
    raw: unknown,
    rawId?: string,
    version?: string,
    publication = false,
  ) {
    const announcementId = rawId ? id(rawId) : undefined;
    const body = bodyObject(
      raw,
      publication
        ? ['publicado']
        : ['titulo', 'contenido', 'fecha_inicio', 'fecha_fin'],
      !!announcementId,
    );
    return transaction(this.pool, async (client) => {
      await this.ready(client);
      let previous: any = { fecha_fin: null, publicado: false };
      const permissions = announcementId ? [] : ['announcements.create'];
      if (announcementId) {
        const result = await client.query(
          `SELECT id,autor_id::text,titulo,contenido,to_char(fecha_inicio,'YYYY-MM-DD') AS fecha_inicio,to_char(fecha_fin,'YYYY-MM-DD') AS fecha_fin,publicado,${versionColumn} FROM public.anuncios WHERE id=$1 FOR UPDATE`,
          [announcementId],
        );
        previous = result.rows[0];
        if (!previous) throw new NotFoundException('Anuncio no encontrado');
        permissions.push(
          previous.autor_id === actor.memberId
            ? 'announcements.edit_own'
            : 'announcements.edit_any',
        );
        if (publication || previous.publicado)
          permissions.push('announcements.publish');
        this.iam.require(actor, ...permissions);
        match(previous.version, version);
      }
      const merged = { ...previous, ...body };
      const title = requiredText(merged.titulo, 'titulo');
      if ([...title].length > 200)
        throw new BadRequestException('Título demasiado largo');
      const content = requiredText(merged.contenido, 'contenido');
      const start = date(merged.fecha_inicio, 'fecha_inicio');
      const end = optionalDate(merged.fecha_fin, 'fecha_fin');
      dateRange(start, end);
      const published = publication
        ? boolean(body.publicado, 'publicado')
        : previous.publicado;
      await this.iam.revalidate(client, actor, ...permissions);
      const result = announcementId
        ? await client.query(
            'UPDATE public.anuncios SET titulo=$1,contenido=$2,fecha_inicio=$3,fecha_fin=$4,publicado=$5 WHERE id=$6 RETURNING id::text',
            [title, content, start, end, published, announcementId],
          )
        : await client.query(
            'INSERT INTO public.anuncios(titulo,contenido,fecha_inicio,fecha_fin,autor_id) VALUES($1,$2,$3,$4,$5) RETURNING id::text',
            [title, content, start, end, actor.memberId],
          );
      const saved = { id: result.rows[0].id };
      await this.audit(
        client,
        actor,
        publication
          ? 'announcement.publication'
          : announcementId
            ? 'announcement.updated'
            : 'announcement.created',
        saved.id,
        saved,
      );
      return saved;
    });
  }
  private async lockApplication(client: PoolClient, applicationId: string) {
    await client.query('SELECT pg_advisory_xact_lock(74102931)');
    const lookup = await client.query(
      'SELECT periodo_id::text FROM public.postulaciones WHERE id=$1',
      [applicationId],
    );
    if (!lookup.rows[0])
      throw new NotFoundException('Postulación no encontrada');
    const period = await client.query(
      'SELECT * FROM public.periodos_postulacion WHERE id=$1 FOR UPDATE',
      [lookup.rows[0].periodo_id],
    );
    const application = await client.query(
      'SELECT id::text,estado_postulacion FROM public.postulaciones WHERE id=$1 FOR UPDATE',
      [applicationId],
    );
    return { period: period.rows[0], application: application.rows[0] };
  }
  async myVote(actor: Actor, rawId: string) {
    const applicationId = id(rawId);
    const exists = await this.pool.query(
      'SELECT id FROM public.postulaciones WHERE id=$1',
      [applicationId],
    );
    if (!exists.rowCount)
      throw new NotFoundException('Postulación no encontrada');
    const result = await this.pool.query(
      `SELECT id::text,voto,comentario,${versionColumn} FROM public.postulacion_votos WHERE postulacion_id=$1 AND miembro_id=$2`,
      [applicationId, actor.memberId],
    );
    return { data: result.rows[0] || null };
  }
  vote(
    actor: Actor,
    rawId: string,
    raw: unknown,
    patch: boolean,
    version?: string,
  ) {
    const applicationId = id(rawId),
      body = bodyObject(raw, ['voto', 'comentario'], patch);
    return transaction(this.pool, async (client) => {
      await this.ready(client);
      const { application, period } = await this.lockApplication(
        client,
        applicationId,
      );
      if (
        application.estado_postulacion !== 'pendiente' ||
        period.estado_periodo === 'cancelado'
      )
        throw new ConflictException('La postulación no admite votos');
      const found = await client.query(
        `SELECT id::text,voto,comentario,${versionColumn} FROM public.postulacion_votos WHERE postulacion_id=$1 AND miembro_id=$2 FOR UPDATE`,
        [applicationId, actor.memberId],
      );
      const previous = found.rows[0];
      if (patch && !previous)
        throw new NotFoundException('Todavía no has votado');
      if (!patch && previous)
        throw new ConflictException('Ya emitiste un voto');
      if (patch) match(previous.version, version);
      const merged = { comentario: null, ...previous, ...body };
      const vote = choice(['a_favor', 'en_contra'])(merged.voto, 'voto');
      const comment = optionalText(merged.comentario, 'comentario');
      await this.iam.revalidate(client, actor, 'votes.write_own');
      const window = await client.query(
        'SELECT clock_timestamp()>=$1::timestamptz AND clock_timestamp()<$2::timestamptz AS open',
        [period.fecha_apertura, period.fecha_cierre_votacion],
      );
      if (!window.rows[0].open)
        throw new ConflictException('Fuera del plazo de votación');
      const saved = patch
        ? await client.query(
            'UPDATE public.postulacion_votos SET voto=$1,comentario=$2 WHERE id=$3 RETURNING id::text',
            [vote, comment, previous.id],
          )
        : await client.query(
            'INSERT INTO public.postulacion_votos(postulacion_id,miembro_id,voto,comentario) VALUES($1,$2,$3,$4) RETURNING id::text',
            [applicationId, actor.memberId, vote, comment],
          );
      const result = { id: saved.rows[0].id };
      await this.audit(
        client,
        actor,
        patch ? 'vote.updated' : 'vote.created',
        applicationId,
        result,
      );
      return result;
    });
  }
  async resultsOverview(rawOffset = '0') {
    if (
      !/^\d+$/.test(rawOffset) ||
      !Number.isSafeInteger(+rawOffset) ||
      +rawOffset > 2147483647
    )
      throw new BadRequestException('Paginación inválida');
    const { rows } = await this.pool.query(
      `SELECT p.id::text,p.nombre_completo,p.estado_postulacion,periodo.nombre_periodo FROM public.postulaciones p JOIN public.periodos_postulacion periodo ON periodo.id=p.periodo_id ORDER BY p.created_at DESC,p.id DESC LIMIT 31 OFFSET $1`,
      [+rawOffset],
    );
    return { data: rows.slice(0, 30), hasMore: rows.length > 30 };
  }
  async results(rawId: string) {
    const applicationId = id(rawId);
    const exists = await this.pool.query(
      'SELECT id FROM public.postulaciones WHERE id=$1',
      [applicationId],
    );
    if (!exists.rowCount)
      throw new NotFoundException('Postulación no encontrada');
    const { rows } = await this.pool.query(
      'SELECT v.id::text,v.miembro_id::text,m.nombre,v.voto,v.comentario,v.updated_at FROM public.postulacion_votos v JOIN public.miembros m ON m.id=v.miembro_id WHERE v.postulacion_id=$1 ORDER BY m.nombre,v.id',
      [applicationId],
    );
    return {
      data: rows,
      a_favor: rows.filter((v) => v.voto === 'a_favor').length,
      en_contra: rows.filter((v) => v.voto === 'en_contra').length,
    };
  }
  resolve(actor: Actor, rawId: string, raw: unknown, rawKey?: string) {
    const applicationId = id(rawId),
      idem = key(rawKey),
      body = bodyObject(raw, ['decision', 'motivo']);
    const decision = choice(['aceptada', 'rechazada'])(
        body.decision,
        'decision',
      ),
      reason = requiredText(body.motivo, 'motivo');
    const hash = fingerprint({ decision, reason });
    return transaction(this.pool, async (client) => {
      await this.ready(client);
      const { application, period } = await this.lockApplication(
        client,
        applicationId,
      );
      await this.iam.revalidate(client, actor, 'applications.resolve');
      const replay = await client.query(
        "SELECT request_fingerprint,result FROM public.business_audit_events WHERE actor_iam_subject=$1 AND action='application.resolved' AND resource_type='postulacion' AND resource_id=$2 AND idempotency_key=$3",
        [actor.userId, applicationId, idem],
      );
      if (replay.rows[0]) {
        if (!replay.rows[0].request_fingerprint.equals(hash))
          throw new ConflictException('La clave ya se usó con otros datos');
        return replay.rows[0].result;
      }
      if (
        application.estado_postulacion !== 'pendiente' ||
        period.estado_periodo === 'cancelado'
      )
        throw new ConflictException(
          'La postulación ya está resuelta o no admite resolución',
        );
      const time = await client.query(
        'SELECT clock_timestamp()>=$1::timestamptz AS open',
        [period.fecha_apertura],
      );
      if (!time.rows[0].open)
        throw new ConflictException('El período aún no comienza');
      await client.query(
        'UPDATE public.postulaciones SET estado_postulacion=$1,resuelta_en=clock_timestamp(),resuelta_por=$2 WHERE id=$3',
        [decision, actor.memberId, applicationId],
      );
      const result = { id: applicationId, estado_postulacion: decision };
      await this.audit(
        client,
        actor,
        'application.resolved',
        applicationId,
        result,
        { motivo: reason },
        idem,
        hash,
      );
      return result;
    });
  }
  convert(actor: Actor, rawId: string, raw: unknown, rawKey?: string) {
    const applicationId = id(rawId),
      idem = key(rawKey),
      body = bodyObject(raw, [
        'mode',
        'memberId',
        'nombre',
        'correoInstitucional',
        'carrera',
        'anioIngresoCarrera',
        'confirmado',
      ]);
    const mode = choice(['crear', 'asociar_existente'])(body.mode, 'mode');
    if (body.confirmado !== true)
      throw new BadRequestException('Debes confirmar la revisión de identidad');
    let data: any;
    if (mode === 'asociar_existente') {
      if (
        Object.keys(body).some(
          (k) => !['mode', 'memberId', 'confirmado'].includes(k),
        )
      )
        throw new BadRequestException('Datos incompatibles con asociación');
      data = { mode, memberId: id(body.memberId) };
    } else {
      if ('memberId' in body)
        throw new BadRequestException('No enviar memberId al crear');
      const email = requiredText(
        body.correoInstitucional,
        'correoInstitucional',
      ).toLowerCase();
      if (!/^[^\s@]+@utem\.cl$/.test(email))
        throw new BadRequestException('Correo institucional inválido');
      const year = body.anioIngresoCarrera ?? null;
      if (
        year !== null &&
        (typeof year !== 'number' ||
          !Number.isInteger(year) ||
          year < 1900 ||
          year > 2100)
      )
        throw new BadRequestException('Año inválido');
      data = {
        mode,
        nombre: requiredText(body.nombre, 'nombre'),
        correoInstitucional: email,
        carrera: requiredText(body.carrera, 'carrera'),
        anioIngresoCarrera: year,
      };
    }
    const hash = fingerprint(data);
    return transaction(this.pool, async (client) => {
      await this.ready(client, true);
      const { application } = await this.lockApplication(client, applicationId);
      await this.iam.revalidate(
        client,
        actor,
        'applications.convert',
        'members.manage',
      );
      const replay = await client.query(
        'SELECT miembro_id::text,request_fingerprint FROM public.postulacion_miembro_conversiones WHERE postulacion_id=$1',
        [applicationId],
      );
      if (replay.rows[0]) {
        if (!replay.rows[0].request_fingerprint.equals(hash))
          throw new ConflictException(
            'Esta postulación ya fue convertida con otros datos',
          );
        return { id: replay.rows[0].miembro_id };
      }
      if (application.estado_postulacion !== 'aceptada')
        throw new ConflictException(
          'Solo puedes convertir postulaciones aceptadas',
        );
      let memberId: string;
      if (mode === 'asociar_existente') {
        const member = await client.query(
          "SELECT id::text FROM public.miembros WHERE id=$1 AND estado='activo' FOR SHARE",
          [data.memberId],
        );
        if (!member.rows[0])
          throw new ConflictException(
            'Miembro no disponible; no se reactiva automáticamente',
          );
        memberId = member.rows[0].id;
      } else {
        const member = await client.query(
          "INSERT INTO public.miembros(nombre,correo_institucional,carrera,anio_ingreso_carrera,estado,perfil_publico,foto_publica) VALUES($1,$2,$3,$4,'activo',false,false) RETURNING id::text",
          [
            data.nombre,
            data.correoInstitucional,
            data.carrera,
            data.anioIngresoCarrera,
          ],
        );
        memberId = member.rows[0].id;
      }
      await client.query(
        'INSERT INTO public.postulacion_miembro_conversiones(postulacion_id,miembro_id,converted_by,actor_iam_subject,mode,idempotency_key,request_fingerprint) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [
          applicationId,
          memberId,
          actor.memberId,
          actor.userId,
          mode,
          idem,
          hash,
        ],
      );
      const result = { id: memberId };
      await this.audit(
        client,
        actor,
        'application.converted',
        applicationId,
        result,
        {},
        idem,
        hash,
      );
      return result;
    });
  }
}
