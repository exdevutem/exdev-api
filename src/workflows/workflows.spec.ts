import { WorkflowsService } from './workflows.service';
const actor = {
  userId: '1236638c-55ab-441b-8e06-49d185573c35',
  memberId: '1',
  permissions: [],
  token: 'a'.repeat(43),
};
const idem = 'd7c13b56-0618-4219-a37d-83ae1727d7de';
describe('Business workflow protection', () => {
  function setup(state = 'pendiente', open = true, existingVote: any = null) {
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('to_regclass')) return { rows: [{ ready: true }] };
      if (sql.startsWith('SELECT periodo_id'))
        return { rows: [{ periodo_id: '1' }] };
      if (sql.startsWith('SELECT * FROM public.periodos'))
        return {
          rows: [
            {
              estado_periodo: 'habilitado',
              fecha_apertura: '2026-01-01',
              fecha_cierre_votacion: '2026-12-01',
            },
          ],
        };
      if (sql.startsWith('SELECT id::text,estado'))
        return { rows: [{ id: '2', estado_postulacion: state }] };
      if (sql.includes('SELECT clock_timestamp()')) return { rows: [{ open }] };
      if (
        sql.includes('FROM public.postulacion_votos') &&
        sql.includes('FOR UPDATE')
      )
        return { rows: existingVote ? [existingVote] : [] };
      if (sql.startsWith('INSERT INTO public.postulacion_votos'))
        return { rows: [{ id: '90' }] };
      return { rows: [], rowCount: 0 };
    });
    const client = { query, release: jest.fn() },
      pool = { connect: async () => client, query };
    const iam = {
      revalidate: jest.fn().mockResolvedValue(undefined),
      require: jest.fn(),
    };
    return {
      service: new WorkflowsService(pool as any, iam as any),
      query,
      iam,
    };
  }
  it.each(['autor_id', 'miembro_id', 'resuelta_por'])(
    'rejects supplied actor %s',
    (field) => {
      const s = setup();
      expect(() =>
        s.service.saveAnnouncement(actor, { [field]: '2' }),
      ).toThrow();
      expect(() =>
        s.service.vote(actor, '2', { voto: 'a_favor', [field]: '2' }, false),
      ).toThrow();
      expect(() =>
        s.service.resolve(
          actor,
          '2',
          { decision: 'aceptada', motivo: 'x', [field]: '2' },
          idem,
        ),
      ).toThrow();
    },
  );
  it('does not write a vote on a resolved application', async () => {
    const s = setup('aceptada');
    await expect(
      s.service.vote(actor, '2', { voto: 'a_favor' }, false),
    ).rejects.toThrow('no admite votos');
    expect(
      s.query.mock.calls.some(([sql]) =>
        sql.startsWith('INSERT INTO public.postulacion_votos'),
      ),
    ).toBe(false);
  });
  it('checks voting deadline after actor revalidation', async () => {
    const s = setup('pendiente', false);
    await expect(
      s.service.vote(actor, '2', { voto: 'a_favor' }, false),
    ).rejects.toThrow('Fuera del plazo');
    expect(s.iam.revalidate).toHaveBeenCalled();
  });
  it('writes actor-owned vote and audit in same transaction', async () => {
    const s = setup();
    await expect(
      s.service.vote(actor, '2', { voto: 'a_favor' }, false),
    ).resolves.toEqual({ id: '90' });
    expect(
      s.query.mock.calls.some(([sql]) =>
        sql.startsWith('INSERT INTO public.business_audit_events'),
      ),
    ).toBe(true);
    expect(s.query.mock.calls.at(-1)?.[0]).toBe('COMMIT');
  });
  it('requires current version when editing', async () => {
    const s = setup('pendiente', true, {
      id: '90',
      version: 'current',
      voto: 'a_favor',
    });
    await expect(
      s.service.vote(actor, '2', { voto: 'en_contra' }, true, 'old'),
    ).rejects.toThrow('registro cambió');
  });
  it('allows resolution during reception, independent of voting close', async () => {
    const s = setup();
    await expect(
      s.service.resolve(
        actor,
        '2',
        { decision: 'aceptada', motivo: 'Revisión' },
        idem,
      ),
    ).resolves.toMatchObject({ estado_postulacion: 'aceptada' });
  });
  it('rejects a second final resolution', async () => {
    const s = setup('rechazada');
    await expect(
      s.service.resolve(
        actor,
        '2',
        { decision: 'aceptada', motivo: 'Cambio' },
        idem,
      ),
    ).rejects.toThrow('ya está resuelta');
  });
  it('requires identity review for conversion', () => {
    const s = setup();
    expect(() =>
      s.service.convert(
        actor,
        '2',
        { mode: 'asociar_existente', memberId: '3' },
        idem,
      ),
    ).toThrow('confirmar');
  });
});
