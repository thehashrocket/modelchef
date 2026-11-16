import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { decideGuest, readCredit, reconcileGuest, recomputeTotal } from './finale';
import { GUEST_UNEVEN_REASON, type Entry, type JudgeScore } from './state';

const score = (judge: string, weighted: number): JudgeScore => ({
  judge,
  judgeName: judge === 'guest' ? 'Claude Opus 5.5' : `The ${judge}`,
  lens: 'overall',
  scores: { usefulness: 5, craft: 5, originality: 5, theme: 5 },
  weighted,
  critique: '',
  improve: '',
});

const finalist = (contestant: string, judges: JudgeScore[], over: Partial<Entry> = {}): Entry => {
  const e: Entry = {
    contestant,
    label: 'Dish A',
    model: null,
    forfeit: null,
    title: contestant,
    pitch: '',
    presentation: '',
    mech: { bytes: 1, consoleErrors: [], networkAttempts: [], mobileOverflow: false, blank: false, hasTitle: true, hasDescription: true, score: 10 },
    judges,
    abstained: [],
    judgeAvg: 0,
    total: 0,
    rank: 0,
    ...over,
  };
  recompute(e);
  return e;
};
const recompute = (e: Entry) => recomputeTotal(e, 0.8, 0.2);
const guestFailed = (e: Entry, why = 'Unavailable: timeout') => (e.abstained.push({ judge: 'guest', judgeName: 'Claude Opus 5.5', reason: why }), e);

describe('reconcileGuest', () => {
  it('guest scored both finalists: nothing changes', () => {
    const a = finalist('a', [score('p', 7), score('guest', 9)]);
    const b = finalist('b', [score('p', 6), score('guest', 8)]);
    assert.deepEqual(reconcileGuest([a, b], 'guest', recompute), { kind: 'unchanged' });
    assert.equal(a.judges.length, 2);
  });

  it('guest scored neither: nothing changes', () => {
    const a = guestFailed(finalist('a', [score('p', 7)]));
    const b = guestFailed(finalist('b', [score('p', 6)]));
    assert.deepEqual(reconcileGuest([a, b], 'guest', recompute), { kind: 'unchanged' });
    assert.equal(a.abstained[0]!.reason, 'Unavailable: timeout');
  });

  it('guest scored one: the score is discarded for both, totals recomputed, and the ranking can flip', () => {
    const a = finalist('a', [score('p', 6), score('guest', 10)]); // 8.0 with guest, 6.0 without
    const b = guestFailed(finalist('b', [score('p', 7)])); // 7.0
    assert.ok(a.total > b.total);
    assert.deepEqual(reconcileGuest([a, b], 'guest', recompute), { kind: 'discarded', chef: 'a' });
    assert.deepEqual(a.judges.map((j) => j.judge), ['p']);
    assert.equal(a.discardedGuestScores?.[0]?.weighted, 10);
    for (const e of [a, b]) {
      const guest = e.abstained.filter((x) => x.judge === 'guest');
      assert.equal(guest.length, 1, 'exactly one guest outcome per finalist');
      assert.equal(guest[0]!.reason, GUEST_UNEVEN_REASON);
    }
    assert.deepEqual(b.guestAttempts, ['Unavailable: timeout']);
    assert.ok(b.total > a.total, 'ranking flipped after recompute');
    assert.equal(a.total, 6 * 0.8 + 10 * 0.2);
  });

  it('guest was the only judge of a finalist: the score is kept (rule skipped)', () => {
    const a = finalist('a', [score('guest', 9)]);
    const b = guestFailed(finalist('b', [score('p', 7)]));
    assert.deepEqual(reconcileGuest([a, b], 'guest', recompute), { kind: 'retained', scored: 'a' });
    assert.equal(a.judges.length, 1);
    assert.equal(b.abstained[0]!.reason, 'Unavailable: timeout', 'the other finalist keeps its original reason');
  });

  it('a forfeited finalist: fewer than two served, nothing is dropped', () => {
    const a = finalist('a', [score('p', 6), score('guest', 9)]);
    const b = finalist('b', [], { forfeit: 'Model unavailable' });
    assert.deepEqual(reconcileGuest([a, b], 'guest', recompute), { kind: 'unchanged' });
    assert.equal(a.judges.length, 2);
  });
});

describe('decideGuest', () => {
  const min = 1.5;
  const reading = (keyRemaining: number | null, accountRemaining: number | null) => ({ ok: true as const, credit: { keyRemaining, accountRemaining } });
  it('no key limit and enough account credit: runs', () => assert.deepEqual(decideGuest(reading(null, 10), min), { run: true }));
  it('key limit too low: skips with a reason', () => {
    const d = decideGuest(reading(0.4, 10), min);
    assert.equal(d.run, false);
    assert.match((d as { reason: string }).reason, /key has \$0\.40 of its limit left; the guest judge needs at least \$1\.50/);
  });
  it('account too low: skips', () => assert.equal(decideGuest(reading(null, 1.49), min).run, false));
  it('exactly the minimum: runs', () => assert.deepEqual(decideGuest(reading(1.5, 1.5), min), { run: true }));
  it('unreadable: warns and runs', () => {
    const d = decideGuest({ ok: false, why: 'HTTP 500' }, min);
    assert.equal(d.run, true);
    assert.match((d as { warning: string }).warning, /Could not read the OpenRouter balance \(HTTP 500\)/);
  });
});

describe('readCredit', () => {
  const fake = (bodies: Record<string, unknown>, status = 200): typeof fetch =>
    (async (url: string | URL | Request) => {
      const path = String(url).split('/').pop()!;
      return new Response(JSON.stringify(bodies[path]), { status });
    }) as typeof fetch;

  it('reads the key limit and the account balance', async () => {
    const r = await readCredit('k', fake({ key: { data: { limit_remaining: 49.5 } }, credits: { data: { total_credits: 10, total_usage: 2.5 } } }));
    assert.deepEqual(r, { ok: true, credit: { keyRemaining: 49.5, accountRemaining: 7.5 } });
  });
  it('a key without a limit reads as null', async () => {
    const r = await readCredit('k', fake({ key: { data: { limit_remaining: null } }, credits: { data: { total_credits: 10, total_usage: 0 } } }));
    assert.deepEqual(r, { ok: true, credit: { keyRemaining: null, accountRemaining: 10 } });
  });
  it('a malformed key reply is unreadable, not zero', async () => {
    const r = await readCredit('k', fake({ key: { data: { limit_remaining: 'lots' } }, credits: { data: {} } }));
    assert.equal(r.ok, false);
  });
  it('a refused or malformed /credits keeps the key limit, with the account unknown', async () => {
    const refused = ((async (url: string | URL | Request) =>
      String(url).endsWith('/key')
        ? new Response(JSON.stringify({ data: { limit_remaining: 0.4 } }))
        : new Response('{"error":"management key required"}', { status: 403 })) as typeof fetch);
    const r = await readCredit('k', refused);
    assert.deepEqual(r, { ok: true, credit: { keyRemaining: 0.4, accountRemaining: null } });
    assert.equal(decideGuest(r, 1.5).run, false, 'a low key limit still stops the guest');
    const odd = await readCredit('k', fake({ key: { data: { limit_remaining: null } }, credits: { data: {} } }));
    assert.deepEqual(odd, { ok: true, credit: { keyRemaining: null, accountRemaining: null } });
  });
  it('HTTP errors are unreadable', async () => {
    assert.equal((await readCredit('k', fake({}, 500))).ok, false);
  });
  it('a timeout is unreadable', async () => {
    // A request that never answers. AbortSignal.timeout does not keep Node alive, so the
    // fake holds a ref'd timer until the abort arrives (otherwise the test can end first).
    const hang = ((_u: unknown, init?: RequestInit) =>
      new Promise((_r, reject) => {
        const alive = setTimeout(() => reject(new Error('the timeout never fired')), 5000);
        init?.signal?.addEventListener('abort', () => {
          clearTimeout(alive);
          reject(new Error('timed out'));
        });
      })) as typeof fetch;
    const r = await readCredit('k', hang, 20);
    assert.deepEqual(r, { ok: false, why: 'timed out' });
  });
});
