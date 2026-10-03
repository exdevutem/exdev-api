import { MembersService } from './members.service';
import { MembersController } from './members.controller';
import { IamService, Actor } from '../auth/iam.service';
import { Pool } from 'pg';

const representative: Actor = {
  userId: '1236638c-55ab-441b-8e06-49d185573c35',
  memberId: '1',
  token: 'a'.repeat(43),
  permissions: ['members.manage', 'access_levels.manage'],
  isAdministrator: false,
};
const profile = {
  nombre: 'Member',
  correoInstitucional: 'member@utem.cl',
  carrera: 'Computación',
  estado: 'activo',
  perfilPublico: false,
  fotoPublica: false,
};
function fixture(previous: string | null = null, administrator = false) {
  const actor = { ...representative, isAdministrator: administrator };
  const query = jest.fn(async (sql: string) => ({
    rows: sql.includes('SELECT iam_subject, nombre')
      ? [{ ...profile, iam_subject: null, accessLevel: previous }]
      : sql.includes('INSERT INTO public.miembros')
        ? [{ id: '2' }]
        : sql.includes('FROM public.roles_club')
          ? [{ id: '42' }]
          : [],
    rowCount: 1,
  }));
  const client = { query, release: jest.fn() };
  const pool = { connect: async () => client } as unknown as Pool;
  const iam = {
    require: IamService.prototype.require,
    validate: jest.fn().mockResolvedValue(actor),
  };
  const service = new MembersService(pool, iam as unknown as IamService);
  return { service, query, iam, actor };
}
describe('Member access level authorization', () => {
  it.each(['trainee', 'miembro'])(
    'representative can create a member with %s before IAM linking',
    async (level) => {
      const f = fixture();
      await f.service.create({ ...profile, accessLevel: level }, f.actor);
      expect(f.query).toHaveBeenCalledWith(
        'UPDATE public.miembros SET rafael_access_level=$1 WHERE id=$2',
        [level, '2'],
      );
      expect(
        f.query.mock.calls.some(([sql]) =>
          sql.includes('rafael_access_level_audit'),
        ),
      ).toBe(true);
    },
  );
  it('promotes trainee to member and audits the previous level in the same transaction', async () => {
    const f = fixture('trainee');
    await f.service.update(
      '2',
      { accessLevel: 'miembro' },
      f.actor.memberId,
      f.actor,
    );
    const audit = f.query.mock.calls.find(([sql]) =>
      sql.includes('INSERT INTO public.rafael_access_level_audit'),
    );
    expect(audit).toBeDefined();
    expect(f.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO public.rafael_access_level_audit'),
      ['2', f.actor.userId, 'trainee', 'miembro'],
    );
    expect(f.query).toHaveBeenCalledWith('COMMIT');
  });
  it.each([
    ['trainee', 'representante'],
    ['representante', 'miembro'],
    ['representante', null],
  ])('representative cannot change %s to %s', async (previous, next) => {
    const f = fixture(previous);
    await expect(
      f.service.update('2', { accessLevel: next }, '1', f.actor),
    ).rejects.toThrow('ADMINISTRATOR_REQUIRED');
    expect(f.query).toHaveBeenCalledWith('ROLLBACK');
  });
  it('representative cannot create a representative by forging the payload', async () => {
    const f = fixture();
    await expect(
      f.service.create({ ...profile, accessLevel: 'representante' }, f.actor),
    ).rejects.toThrow('ADMINISTRATOR_REQUIRED');
  });
  it('administrator can assign representative', async () => {
    const f = fixture('miembro', true);
    await f.service.update('2', { accessLevel: 'representante' }, '1', f.actor);
    expect(f.query).toHaveBeenCalledWith(
      'UPDATE public.miembros SET rafael_access_level=$1 WHERE id=$2',
      ['representante', '2'],
    );
  });
  it('no member form can assign administrator', async () => {
    const f = fixture('miembro', true);
    await expect(
      f.service.update(
        '2',
        { accessLevel: 'administrador_rafael' },
        '1',
        f.actor,
      ),
    ).rejects.toThrow();
  });
  it('rechecks authorization after session permissions were revoked', async () => {
    const f = fixture('trainee');
    f.iam.validate.mockResolvedValue({ ...f.actor, permissions: [] });
    await expect(
      f.service.update('2', { accessLevel: 'miembro' }, '1', f.actor),
    ).rejects.toThrow('PERMISSION_REQUIRED');
  });
  it('preserves level when an edit omits it', async () => {
    const f = fixture('representante');
    await f.service.update('2', { nombre: 'Updated' }, '1', f.actor);
    expect(
      f.query.mock.calls.some(([sql]) =>
        sql.includes('SET rafael_access_level'),
      ),
    ).toBe(false);
  });
  it('self-profile cannot change access level', () => {
    const f = fixture('trainee');
    expect(() =>
      new MembersController(f.service).updateSelf({ actor: f.actor } as any, {
        accessLevel: 'representante',
      }),
    ).toThrow('campos no permitidos');
  });
});

describe('Unified member type', () => {
  it.each([
    ['trainee', 'trainee', ['trainee']],
    ['miembro', 'miembro', ['miembro', 'miembro activo']],
    ['titulado', 'miembro', ['titulado']],
    ['representante', 'representante', ['representante']],
  ])(
    'saves %s with its club role and %s access atomically',
    async (type, level, names) => {
      const f = fixture(null, true);
      await f.service.create({ ...profile, memberType: type }, f.actor);
      expect(f.query).toHaveBeenCalledWith(
        expect.stringContaining('lower(btrim(nombre))=ANY'),
        [names],
      );
      expect(f.query).toHaveBeenCalledWith(
        'UPDATE public.miembros SET rafael_access_level=$1 WHERE id=$2',
        [level, '2'],
      );
      expect(f.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO public.miembro_roles'),
        ['2', '42'],
      );
      expect(f.query).toHaveBeenCalledWith('COMMIT');
    },
  );
  it('changes member to graduate without changing member permissions', async () => {
    const f = fixture('miembro');
    await f.service.update('2', { memberType: 'titulado' }, '1', f.actor);
    expect(f.iam.validate).toHaveBeenCalled();
    expect(f.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO public.miembro_roles'),
      ['2', '42'],
    );
    expect(
      f.query.mock.calls.some(([sql]) =>
        sql.includes('SET rafael_access_level'),
      ),
    ).toBe(false);
  });
  it.each([
    [null, 'representante'],
    ['representante', 'miembro'],
  ])('requires administrator for %s to %s', async (previous, next) => {
    const f = fixture(previous);
    await expect(
      f.service.update('2', { memberType: next }, '1', f.actor),
    ).rejects.toThrow('ADMINISTRATOR_REQUIRED');
    expect(f.query).toHaveBeenCalledWith('ROLLBACK');
  });
  it('rejects conflicting legacy selection fields', () => {
    const f = fixture();
    expect(() =>
      f.service.create(
        { ...profile, memberType: 'titulado', roleIds: ['1'] },
        f.actor,
      ),
    ).toThrow('Envía solo memberType');
    expect(f.query).not.toHaveBeenCalled();
  });
  it('rolls back when the matching catalog role is missing', async () => {
    const f = fixture();
    f.query.mockImplementation(async () => ({ rows: [], rowCount: 0 }));
    await expect(
      f.service.create({ ...profile, memberType: 'titulado' }, f.actor),
    ).rejects.toThrow('único rol activo');
    expect(f.query).toHaveBeenCalledWith('ROLLBACK');
    expect(
      f.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO')),
    ).toBe(false);
  });
});
