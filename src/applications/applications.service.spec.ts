import { createDecipheriv } from 'node:crypto';
import { ApplicationsService } from './applications.service';
import { encryptRut, normalizeRut } from './rut-encryption';

describe('ApplicationsService with encrypted RUT', () => {
  const previousVersion = process.env.RUT_ENCRYPTION_KEY_VERSION;
  const previousKey = process.env.RUT_ENCRYPTION_KEY_V1;
  const key = Buffer.alloc(32, 7); // Test-only key, never used outside tests.
  const body = {
    nombre_completo: 'Persona de prueba', rut: '12.345.678-5',
    correo_institucional: 'TEST@utem.cl', carrera: 'Computación', area_interes1: 'Backend',
  };
  let client: any;
  let pool: any;
  let service: ApplicationsService;
  beforeEach(() => {
    process.env.RUT_ENCRYPTION_KEY_VERSION = '1';
    process.env.RUT_ENCRYPTION_KEY_V1 = key.toString('base64');
    client = { query: jest.fn(async (sql: string) => {
      if (sql.includes('SELECT id')) return { rows: [{ id: '2' }] };
      if (sql.includes('INSERT INTO')) return { rows: [{ id: '9007199254740993' }] };
      return { rows: [] };
    }), release: jest.fn() };
    pool = { connect: jest.fn(async () => client) };
    service = new ApplicationsService(pool);
  });
  afterAll(() => {
    if (previousVersion === undefined) delete process.env.RUT_ENCRYPTION_KEY_VERSION;
    else process.env.RUT_ENCRYPTION_KEY_VERSION = previousVersion;
    if (previousKey === undefined) delete process.env.RUT_ENCRYPTION_KEY_V1;
    else process.env.RUT_ENCRYPTION_KEY_V1 = previousKey;
  });
  it('validates the RUT check digit', () => {
    expect(normalizeRut('12.345.678-5')).toBe('12345678-5');
    expect(normalizeRut('12345678-0')).toBeNull();
  });
  it('encrypts with randomized authenticated encryption', () => {
    const first = encryptRut('12345678-5').ciphertext;
    expect(first.equals(encryptRut('12345678-5').ciphertext)).toBe(false);
    const decipher = createDecipheriv('aes-256-gcm', key, first.subarray(0, 12));
    decipher.setAAD(Buffer.from('exdev:postulaciones:rut:v1'));
    decipher.setAuthTag(first.subarray(12, 28));
    expect(Buffer.concat([decipher.update(first.subarray(28)), decipher.final()]).toString()).toBe('12345678-5');
  });
  it('saves only encrypted RUT and selects the period on the server', async () => {
    const result = await service.create({ ...body, periodo_id: 999 });
    expect(result.idPostulacion).toBe('9007199254740993');
    const insert = client.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO'));
    expect(insert[1][0]).toBe('2');
    expect(Buffer.isBuffer(insert[1][1])).toBe(true);
    expect(insert[1]).not.toContain('12345678-5');
    expect(insert[1]).toContain('test@utem.cl');
    expect(client.query).toHaveBeenCalledWith('COMMIT');
    expect(client.release).toHaveBeenCalledWith(false);
  });
  it('rejects invalid RUT before connecting', async () => {
    await expect(service.create({ ...body, rut: '12345678-0' })).rejects.toMatchObject({ status: 400 });
    expect(pool.connect).not.toHaveBeenCalled();
  });
  it('fails closed without a key', async () => {
    delete process.env.RUT_ENCRYPTION_KEY_V1;
    await expect(service.create(body)).rejects.toMatchObject({ status: 500 });
    expect(pool.connect).not.toHaveBeenCalled();
  });
  it('rejects when no period is enabled', async () => {
    client.query.mockImplementation(async () => ({ rows: [] }));
    await expect(service.create(body)).rejects.toMatchObject({ status: 409 });
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
  });
  it('rejects outside the date window after locking', async () => {
    client.query.mockImplementation(async (sql: string) => ({ rows: sql.includes('FOR UPDATE') ? [{ id: '2' }] : [] }));
    await expect(service.create(body)).rejects.toMatchObject({ status: 409 });
    expect(client.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO'))).toBe(false);
  });
  it('does not expose database details on duplicate email', async () => {
    client.query.mockImplementation(async (sql: string) => {
      if (sql.includes('INSERT INTO')) throw { code: '23505', detail: 'PRIVATE DATA' };
      return { rows: [{ id: '2' }] };
    });
    try { await service.create(body); throw new Error('Expected failure'); }
    catch (error) {
      expect(error.getStatus()).toBe(409);
      expect(JSON.stringify(error.getResponse())).not.toContain('PRIVATE DATA');
    }
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
  });
});
