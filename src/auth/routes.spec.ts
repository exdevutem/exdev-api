import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../app.module';
import { PG_POOL } from '../shared/connections/database.module';
import { IamService } from './iam.service';
describe('HTTP authorization policies', () => {
  let app: INestApplication;
  const iam = {
    validate: jest.fn().mockResolvedValue({
      userId: 'user',
      memberId: '1',
      permissions: [],
      token: 'a'.repeat(43),
    }),
    require: IamService.prototype.require,
  };
  beforeAll(async () => {
    const client = {
      query: jest.fn().mockResolvedValue({ rows: [] }),
      release: jest.fn(),
    };
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PG_POOL)
      .useValue({ ...client, connect: async () => client })
      .overrideProvider(IamService)
      .useValue(iam)
      .compile();
    app = module.createNestApplication();
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });
  it.each([
    '/members/admin',
    '/members/me',
    '/projects/admin',
    '/events/admin',
    '/sponsors/admin',
    '/roles',
    '/specialties',
    '/periods',
    '/applications',
    '/announcements',
    '/announcements/admin',
    '/applications/1/my-vote',
    '/applications/1/votes',
  ])('GET %s requires a real session', async (path) => {
    await request(app.getHttpServer()).get(path).expect(401);
  });
  it.each([
    '/members',
    '/projects',
    '/events',
    '/sponsors',
    '/roles',
    '/specialties',
    '/periods',
    '/announcements',
    '/applications/1/my-vote',
    '/applications/1/resolution',
    '/applications/1/member-conversion',
  ])('POST %s requires a real session', async (path) => {
    await request(app.getHttpServer()).post(path).send({}).expect(401);
  });
  it.each([
    '/members/1',
    '/members/me',
    '/projects/1',
    '/events/1',
    '/sponsors/1',
    '/roles/1',
    '/specialties/1',
    '/periods/1',
    '/announcements/1',
    '/announcements/1/publication',
    '/applications/1/my-vote',
  ])('PATCH %s requires a real session', async (path) => {
    await request(app.getHttpServer()).patch(path).send({}).expect(401);
  });
  it.each(['/members', '/projects', '/events', '/sponsors'])(
    'GET %s stays public',
    async (path) => {
      await request(app.getHttpServer()).get(path).expect(200);
    },
  );
  it('does not infer management permission from an authenticated member', async () => {
    const name =
      process.env.IAM_SESSION_COOKIE || '__Host-exdev_rafael_session';
    await request(app.getHttpServer())
      .post('/members')
      .set('Cookie', `${name}=${'a'.repeat(43)}`)
      .send({})
      .expect(403);
  });
});
