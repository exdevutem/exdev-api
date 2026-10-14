import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IamGuard, IamService } from './iam.service';
import { MembersService } from '../members/members.service';
const actor = {
  userId: '1236638c-55ab-441b-8e06-49d185573c35',
  memberId: '1',
  permissions: ['members.read'],
  token: 'a'.repeat(43),
};
describe('IAM guard and boundary', () => {
  const original = process.env.IAM_SESSION_COOKIE;
  afterEach(() => {
    process.env.IAM_SESSION_COOKIE = original;
  });
  function setup(
    publicRoute = false,
    permissions: string[] | undefined = ['members.read'],
    cookie = 'exdev_rafael_session=' + actor.token,
    method = 'GET',
  ) {
    process.env.IAM_SESSION_COOKIE = 'exdev_rafael_session';
    const request: any = {
      headers: { cookie },
      method,
      get: (name: string) =>
        name === 'Origin' ? 'http://localhost:3000' : 'csrf',
    };
    const reflector = {
      getAllAndOverride: (key: string) =>
        key === 'iam.public' ? publicRoute : permissions,
    };
    const iam = {
      validate: jest.fn().mockResolvedValue(actor),
      require: jest.fn((a, p) => {
        if (!a.permissions.includes(p)) throw new ForbiddenException();
      }),
    };
    const context = {
      getHandler: () => {},
      getClass: () => {},
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
    return {
      guard: new IamGuard(
        reflector as unknown as Reflector,
        iam as unknown as IamService,
      ),
      iam,
      request,
      context,
    };
  }
  it('preserves public routes without contacting IAM', async () => {
    const s = setup(true);
    expect(await s.guard.canActivate(s.context)).toBe(true);
    expect(s.iam.validate).not.toHaveBeenCalled();
  });
  it('denies routes without an explicit policy', async () => {
    const s = setup();
    (s.guard as any).reflector.getAllAndOverride = () => undefined;
    await expect(s.guard.canActivate(s.context)).rejects.toThrow(
      'ROUTE_NOT_AUTHORIZED',
    );
  });
  it('requires session and rejects duplicate cookies', async () => {
    for (const cookie of [
      '',
      `exdev_rafael_session=${actor.token}; exdev_rafael_session=${actor.token}`,
    ]) {
      const s = setup(false, [], cookie);
      await expect(s.guard.canActivate(s.context)).rejects.toThrow(
        'SESSION_REQUIRED',
      );
    }
  });
  it('passes CSRF and origin for mutation and derives actor from IAM', async () => {
    const s = setup(false, ['members.read'], undefined, 'PATCH');
    await s.guard.canActivate(s.context);
    expect(s.iam.validate).toHaveBeenCalledWith(actor.token, {
      csrf: 'csrf',
      origin: 'http://localhost:3000',
    });
    expect(s.request.actor.memberId).toBe('1');
  });
  it('rejects missing permissions', async () => {
    const s = setup(false, ['members.manage']);
    await expect(s.guard.canActivate(s.context)).rejects.toThrow();
  });
  it('rejects identity assignment through normal member POST', () => {
    const members = new MembersService({} as any);
    expect(() =>
      members.create({ nombre: 'X', iamSubject: actor.userId }),
    ).toThrow('campos no permitidos');
  });
});
