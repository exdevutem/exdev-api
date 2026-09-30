import {
  bodyObject,
  date,
  id,
  ids,
  timestamp,
  url,
  transaction,
} from './admin-data';
describe('Administrative input validation', () => {
  it('preserves bigint IDs and rejects unsafe numbers', () => {
    expect(id('9007199254740993')).toBe('9007199254740993');
    expect(() => id(9007199254740993)).toThrow();
    expect(() => id('9223372036854775808')).toThrow();
  });
  it.each(['2026-02-30', '2026-13-01', '2026-00-01', '2026-2-1'])(
    'rejects invalid calendar date %s',
    (value) => expect(() => date(value, 'date')).toThrow(),
  );
  it('accepts leap days only when valid', () => {
    expect(date('2024-02-29', 'date')).toBe('2024-02-29');
    expect(() => date('2025-02-29', 'date')).toThrow();
  });
  it('requires an explicit timezone', () => {
    expect(() => timestamp('2026-10-01T10:00', 'time')).toThrow();
    expect(timestamp('2026-10-01T10:00:00-03:00', 'time')).toBe(
      '2026-10-01T13:00:00.000Z',
    );
  });
  it.each(['javascript:alert(1)', '//example.com', '/\\example.com'])(
    'rejects unsafe URL %s',
    (value) => expect(() => url(value, 'url')).toThrow(),
  );
  it('allows the club application path', () =>
    expect(url('/apply', 'url')).toBe('/apply'));
  it('rejects empty patches and unknown fields', () => {
    expect(() => bodyObject({}, ['nombre'], true)).toThrow();
    expect(() => bodyObject({ admin: true }, ['nombre'])).toThrow();
  });
  it('detects duplicate IDs across numeric and string representations', () =>
    expect(() => ids([1, '1'], 'ids')).toThrow());
  it('rolls back and discards a broken connection without leaking database errors', async () => {
    const client = {
      query: jest
        .fn()
        .mockResolvedValueOnce({})
        .mockRejectedValueOnce(new Error('private')),
      release: jest.fn(),
    };
    const pool = { connect: jest.fn().mockResolvedValue(client) };
    await expect(
      transaction(pool as any, async () => {
        throw new Error('private');
      }),
    ).rejects.toThrow('No fue posible');
    expect(client.release).toHaveBeenCalledWith(true);
  });
});
