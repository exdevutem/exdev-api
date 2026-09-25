import { EventsService } from './events.service';

describe('EventsService public agenda', () => {
  const pool = { query: jest.fn() };
  const service = new EventsService(pool as any);
  beforeEach(() => jest.resetAllMocks());
  it('filters publication, current dates in Chile and formats date-only values', async () => {
    pool.query.mockResolvedValue({ rows: [{ id: '1' }, { id: '2' }] });
    expect(await service.findPublic('1', 'true')).toEqual({ data: [{ id: '1' }], hasMore: true });
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toContain('WHERE publicado = true');
    expect(sql).toContain("estado = 'programado'");
    expect(sql).toContain("AT TIME ZONE 'America/Santiago'");
    expect(sql).toContain("to_char(fecha_inicio, 'YYYY-MM-DD')");
    expect(params).toEqual([2, true, 0]);
  });
  it('supports complete agenda pagination', async () => {
    pool.query.mockResolvedValue({ rows: [] });
    expect(await service.findPublic('20', 'false', '20')).toEqual({ data: [], hasMore: false });
    expect(pool.query.mock.calls[0][1]).toEqual([21, false, 20]);
  });
  it.each([['0', 'true', '0'], ['101', 'true', '0'], ['4', 'bad', '0'], ['4', 'true', '-1']])('rejects invalid query %s %s %s', async (limit, upcoming, offset) => {
    await expect(service.findPublic(limit, upcoming, offset)).rejects.toMatchObject({ status: 400 });
    expect(pool.query).not.toHaveBeenCalled();
  });
  it('does not expose database failures', async () => {
    pool.query.mockRejectedValue(new Error('private database detail'));
    await expect(service.findPublic()).rejects.toThrow('No fue posible cargar los eventos');
  });
});
