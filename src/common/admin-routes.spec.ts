import { IamGuard } from '../auth/iam.service';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../app.module';
import { PG_POOL } from '../shared/connections/database.module';

describe('Administrative HTTP routes (isolated database double)', () => {
  let app: INestApplication;
  const query = jest.fn(async (sql: string) => {
    if (sql.includes('SELECT EXISTS')) return { rows: [{ ready: true }] };
    if (sql.includes('WITH filtered AS'))
      return { rows: [{ total: 0, postulaciones: [] }] };
    if (sql.startsWith('INSERT')) return { rows: [{ id: '9007199254740993' }] };
    return { rows: [] };
  });
  beforeAll(async () => {
    const client = { query, release: jest.fn() };
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(IamGuard)
      .useValue({
        canActivate: (context: any) => {
          context.switchToHttp().getRequest().actor = { memberId: '1' };
          return true;
        },
      })
      .overrideProvider(PG_POOL)
      .useValue({ query, connect: async () => client })
      .compile();
    app = module.createNestApplication();
    await app.init();
  });
  afterAll(async () => {
    await app?.close();
  });
  it.each([
    '/members/admin',
    '/projects/admin',
    '/events/admin',
    '/sponsors/admin',
    '/roles',
    '/specialties',
    '/periods',
  ])('registers GET %s with the collection envelope', async (path) => {
    const response = await request(app.getHttpServer()).get(path).expect(200);
    expect(response.body).toEqual({ data: [] });
  });
  it('forwards pagination query parameters', async () => {
    const response = await request(app.getHttpServer())
      .get('/applications?limit=30&offset=60')
      .expect(200);
    expect(response.body).toMatchObject({
      limit: 30,
      offset: 60,
      postulaciones: [],
      totalPostulaciones: 0,
    });
  });
  it.each(['/events', '/sponsors', '/roles', '/specialties'])(
    'registers and validates POST %s',
    async (path) => {
      await request(app.getHttpServer()).post(path).send({}).expect(400);
    },
  );
  it('creates a role and preserves its bigint ID', async () => {
    const response = await request(app.getHttpServer())
      .post('/roles')
      .send({ nombre: 'Contract test' })
      .expect(201);
    expect(response.body.id).toBe('9007199254740993');
  });
  it.each([
    '/members/1',
    '/projects/1',
    '/events/1',
    '/sponsors/1',
    '/roles/1',
    '/specialties/1',
    '/periods/1',
  ])('registers PATCH %s and rejects empty payloads', async (path) => {
    await request(app.getHttpServer()).patch(path).send({}).expect(400);
  });
});
