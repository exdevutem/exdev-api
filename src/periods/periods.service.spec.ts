import { PeriodsService } from './periods.service';
const scheduled = {
  nombre_periodo: 'Convocatoria',
  descripcion: null,
  fecha_apertura: '2030-10-01T13:00:00.000Z',
  fecha_cierre: '2030-10-10T13:00:00.000Z',
  fecha_cierre_votacion: '2030-10-12T13:00:00.000Z',
  estado_periodo: 'creado',
};
describe('Scheduled periods', () => {
  let client: any, pool: any, service: PeriodsService;
  beforeEach(() => {
    client = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes('SELECT EXISTS')) return { rows: [{ ready: true }] };
        if (sql.includes('SELECT clock_timestamp'))
          return { rows: [{ instant: '2030-09-01T12:00:00.000Z' }] };
        if (sql.includes('FOR UPDATE')) return { rows: [scheduled] };
        if (sql.startsWith('INSERT')) return { rows: [{ id: '7' }] };
        return { rows: [] };
      }),
      release: jest.fn(),
    };
    pool = {
      connect: jest.fn().mockResolvedValue(client),
      query: jest.fn().mockResolvedValue({ rows: [] }),
    };
    service = new PeriodsService(pool);
  });
  it('closes expired periods before opening eligible ones, under a transaction lock', async () => {
    await service.synchronize();
    const calls = client.query.mock.calls.map(([sql]) => sql);
    const closed = calls.findIndex((sql) =>
        sql.includes("SET estado_periodo='cerrado'"),
      ),
      opened = calls.findIndex((sql) =>
        sql.includes("SET estado_periodo='habilitado'"),
      );
    expect(calls[1]).toContain('pg_advisory_xact_lock');
    expect(closed).toBeLessThan(opened);
    expect(calls[opened]).toContain("estado_periodo='creado'");
    expect(calls[opened]).toContain('fecha_apertura<=clock_timestamp()');
    expect(calls[opened]).toContain('clock_timestamp()<fecha_cierre');
  });
  it('creates a future period without opening it early', async () => {
    expect(await service.create(scheduled)).toEqual({ id: '7' });
    expect(
      client.query.mock.calls.find(([sql]) => sql.startsWith('INSERT'))[1][5],
    ).toBe('creado');
  });
  it('rejects invalid reception and voting windows', async () => {
    await expect(
      service.create({ ...scheduled, fecha_cierre: scheduled.fecha_apertura }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      service.create({
        ...scheduled,
        fecha_cierre_votacion: scheduled.fecha_apertura,
      }),
    ).rejects.toMatchObject({ status: 400 });
  });
  it('rejects a new period opening in the past', async () => {
    await expect(
      service.create({ ...scheduled, fecha_apertura: '2030-08-01T13:00:00Z' }),
    ).rejects.toMatchObject({ status: 400 });
  });
  it('prevents manual early activation', async () => {
    await expect(
      service.update('7', { estado_periodo: 'habilitado' }),
    ).rejects.toMatchObject({ status: 400 });
  });
  it('allows cancellation of a scheduled period', async () => {
    expect(await service.update('7', { estado_periodo: 'cancelado' })).toEqual({
      id: '7',
    });
    expect(
      client.query.mock.calls.find(
        ([sql]) => sql.startsWith('UPDATE') && sql.includes('nombre_periodo'),
      )[1][5],
    ).toBe('cancelado');
  });
  it('reports a missing migration before writing', async () => {
    client.query.mockImplementation(async (sql: string) => ({
      rows: sql.includes('SELECT EXISTS') ? [{ ready: false }] : [],
    }));
    await expect(service.create(scheduled)).rejects.toMatchObject({
      status: 409,
    });
    expect(
      client.query.mock.calls.some(([sql]) => sql.startsWith('INSERT')),
    ).toBe(false);
  });
  it('maps overlapping intervals to conflict and rolls back', async () => {
    const original = client.query.getMockImplementation();
    client.query.mockImplementation(async (sql: string) => {
      if (sql.startsWith('INSERT')) throw { code: '23P01' };
      return original(sql);
    });
    await expect(service.create(scheduled)).rejects.toMatchObject({
      status: 409,
    });
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
  });
});
