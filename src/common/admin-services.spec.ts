import { MembersService } from '../members/members.service';
import { ProjectsService } from '../projects/projects.service';
import { EventsService } from '../events/events.service';
import { SponsorsService } from '../sponsors/sponsors.service';
import { CatalogsService } from '../catalogs/catalogs.service';
import { ApplicationsService } from '../applications/applications.service';
const member = {
  nombre: 'Existing',
  correoInstitucional: null,
  carrera: 'Computación',
  anioIngresoCarrera: 2005,
  estado: 'activo',
  perfilPublico: true,
  fotoPublica: true,
};
const project = {
  nombre: 'Existing',
  descripcionBreve: null,
  descripcion: null,
  estado: 'activo',
  fechaInicio: '2026-01-01',
  fechaFin: null,
  publicado: true,
  destacado: true,
  orden: 0,
};
describe('Administrative CRUD contracts', () => {
  let client: any, pool: any;
  beforeEach(() => {
    client = {
      query: jest.fn().mockResolvedValue({ rows: [] }),
      release: jest.fn(),
    };
    pool = {
      query: jest.fn().mockResolvedValue({ rows: [] }),
      connect: jest.fn().mockResolvedValue(client),
    };
  });
  it('administrative lists preserve the data envelope and do not filter visibility or membership', async () => {
    for (const Service of [MembersService, ProjectsService, EventsService]) {
      pool.query.mockClear();
      expect(await new Service(pool).findAdmin()).toEqual({ data: [] });
      const sql = pool.query.mock.calls[0][0];
      expect(sql).not.toMatch(
        /WHERE\s+(m\.estado|p\.publicado|publicado)|AND\s+m\.perfil_publico/,
      );
    }
  });
  it('public members remain active and public', async () => {
    await new MembersService(pool).findPublic();
    expect(pool.query.mock.calls[0][0]).toContain("m.estado = 'activo'");
    expect(pool.query.mock.calls[0][0]).toContain('m.perfil_publico = true');
  });
  it('public projects retain the publication filter', async () => {
    await new ProjectsService(pool).findPublic();
    expect(pool.query.mock.calls[0][0]).toContain('p.publicado = true');
  });
  it('patching one member field preserves all omitted fields and associations', async () => {
    client.query.mockImplementation(async (sql: string) => ({
      rows: sql.includes('SELECT iam_subject, nombre') ? [member] : [],
    }));
    await new MembersService(pool).update('9007199254740993', {
      nombre: 'Updated',
    });
    const call = client.query.mock.calls.find(([sql]) =>
      sql.startsWith('UPDATE public.miembros'),
    );
    expect(call[1]).toEqual([
      'Updated',
      null,
      'Computación',
      2005,
      'activo',
      true,
      true,
      '9007199254740993',
    ]);
    expect(
      client.query.mock.calls.some(([sql]) => sql.includes('miembro_roles')),
    ).toBe(false);
  });
  it('rejects hiding a member while retaining a public photo', async () => {
    client.query.mockImplementation(async (sql: string) => ({
      rows: sql.includes('SELECT iam_subject, nombre') ? [member] : [],
    }));
    await expect(
      new MembersService(pool).update('1', { perfilPublico: false }),
    ).rejects.toMatchObject({ status: 400 });
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
  });
  it('retiring roles finalizes assignments rather than deleting history', async () => {
    client.query.mockImplementation(async (sql: string) => ({
      rows: sql.includes('SELECT iam_subject, nombre')
        ? [member]
        : sql.includes('SELECT rol_id')
          ? [{ id: '2' }]
          : [],
    }));
    await new MembersService(pool).update('1', { roleIds: [] });
    const sql = client.query.mock.calls.map(([sql]) => sql).join('\n');
    expect(sql).toContain('finalizado_en=clock_timestamp()');
    expect(sql).not.toContain('DELETE FROM public.miembro_roles');
  });
  it('rejects unpublishing a featured project without clearing featured', async () => {
    client.query.mockImplementation(async (sql: string) => ({
      rows: sql.includes('SELECT nombre') ? [project] : [],
    }));
    await expect(
      new ProjectsService(pool).update('1', { publicado: false }),
    ).rejects.toMatchObject({ status: 400 });
  });
  it('rejects unknown member IDs before connecting', () => {
    expect(() =>
      new MembersService(pool).update('0', { nombre: 'X' }),
    ).toThrow();
    expect(pool.connect).not.toHaveBeenCalled();
  });
  it('returns 404 for a missing project', async () => {
    await expect(
      new ProjectsService(pool).update('1', { nombre: 'X' }),
    ).rejects.toMatchObject({ status: 404 });
  });
  it('event creation enforces action URLs', async () => {
    await expect(
      new EventsService(pool).create({
        titulo_evento: 'Event',
        tipo_evento: 'charla',
        fecha_inicio: '2026-10-01',
        tipo_accion: 'inscripcion',
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(
      client.query.mock.calls.some(([sql]) => sql.startsWith('INSERT')),
    ).toBe(false);
  });
  it('event partial patches keep dates as date-only values', async () => {
    const event = {
      tipo_evento: 'charla',
      titulo_evento: 'Event',
      descripcion: null,
      fecha_inicio: '2026-10-01',
      fecha_fin: null,
      fecha_texto: null,
      ubicacion: null,
      url_evento: null,
      tipo_accion: null,
      url_accion: null,
      estado: 'programado',
      publicado: false,
    };
    client.query.mockImplementation(async (sql: string) => ({
      rows: sql.startsWith('SELECT')
        ? [event]
        : sql.startsWith('UPDATE')
          ? [{ id: '1' }]
          : [],
    }));
    await expect(
      new EventsService(pool).update('1', { publicado: true }),
    ).resolves.toEqual({ id: '1' });
    expect(
      client.query.mock.calls.find(([sql]) => sql.startsWith('SELECT'))[0],
    ).toContain("to_char(fecha_inicio,'YYYY-MM-DD')");
  });
  it('public sponsors filter both publication and current sponsorship', async () => {
    await new SponsorsService(pool).findAll();
    expect(pool.query.mock.calls[0][0]).toContain(
      "WHERE publicado=true AND estado_patrocinador='activo'",
    );
    pool.query.mockClear();
    await new SponsorsService(pool).findAll(true);
    expect(pool.query.mock.calls[0][0]).not.toContain('WHERE');
  });
  it('catalog duplicate names return conflict without internal details', async () => {
    client.query.mockImplementation(async (sql: string) => {
      if (sql.startsWith('INSERT')) throw { code: '23505', detail: 'PRIVATE' };
      return { rows: [] };
    });
    await expect(
      new CatalogsService(pool).save('roles', { nombre: 'Existing' }),
    ).rejects.toMatchObject({ status: 409 });
  });
  it.each(['10', '30', '50', '100'])(
    'supports application page size %s',
    async (limit) => {
      pool.query.mockResolvedValue({
        rows: [{ total: 120, postulaciones: [{ id: '9007199254740993' }] }],
      });
      const result = await new ApplicationsService(pool).findAll(
        limit,
        '10',
        'pendiente',
        '5',
        'Ana',
      );
      expect(result).toMatchObject({
        limit: Number(limit),
        offset: 10,
        totalPostulaciones: 120,
        hasMore: true,
      });
      expect(pool.query.mock.calls[0][1]).toEqual([
        Number(limit),
        10,
        'pendiente',
        '5',
        'Ana',
      ]);
      expect(pool.query.mock.calls[0][0]).not.toMatch(/rut|SELECT\s+\*/i);
    },
  );
  it.each([
    ['0', '0'],
    ['11', '0'],
    ['10', '-1'],
    ['100', '1.5'],
    ['100', '2147483648'],
  ])('rejects invalid pagination %s/%s', async (limit, offset) => {
    await expect(
      new ApplicationsService(pool).findAll(limit, offset),
    ).rejects.toMatchObject({ status: 400 });
    expect(pool.query).not.toHaveBeenCalled();
  });
  it('retains the total on an offset past the last page', async () => {
    pool.query.mockResolvedValue({ rows: [{ total: 3, postulaciones: [] }] });
    expect(
      await new ApplicationsService(pool).findAll('10', '20'),
    ).toMatchObject({
      totalPostulaciones: 3,
      postulaciones: [],
      hasMore: false,
    });
  });
});
