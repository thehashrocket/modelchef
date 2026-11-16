// The finale's guest-judge rules, as pure functions so they can be tested
// without models: whether there is credit for the guest, and what happens when
// the guest scored only one finalist. episode.ts wires these in.
import { GUEST_UNEVEN_REASON, type Abstention, type Entry, type JudgeScore } from './state';

// ---------------------------------------------------------------------------
// Credit

/** What OpenRouter says is left. null means "no limit" for the key, "unknown" for the account. */
export interface Credit {
  /** `data.limit_remaining` from GET /api/v1/key: null when the key has no spending limit. */
  keyRemaining: number | null;
  /** `data.total_credits - data.total_usage` from GET /api/v1/credits. */
  accountRemaining: number | null;
}

export type CreditReading = { ok: true; credit: Credit } | { ok: false; why: string };

export type GuestDecision = { run: true; warning?: string } | { run: false; reason: string };

const usd = (n: number) => `$${n.toFixed(2)}`;

/**
 * Runs the guest only when both the key's limit (if it has one) and the
 * account's funds cover the minimum. An unreadable balance warns and runs:
 * a missing reading is not evidence of an empty account.
 */
export function decideGuest(reading: CreditReading, minUsd: number): GuestDecision {
  if (!reading.ok) return { run: true, warning: `Could not read the OpenRouter balance (${reading.why}); running the guest judge anyway.` };
  const { keyRemaining, accountRemaining } = reading.credit;
  if (keyRemaining !== null && keyRemaining < minUsd)
    return { run: false, reason: `The OpenRouter key has ${usd(keyRemaining)} of its limit left; the guest judge needs at least ${usd(minUsd)}.` };
  if (accountRemaining !== null && accountRemaining < minUsd)
    return { run: false, reason: `The OpenRouter account has ${usd(accountRemaining)} of credit left; the guest judge needs at least ${usd(minUsd)}.` };
  return { run: true };
}

const num = (v: unknown): number | null | undefined => (v === null ? null : typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** Reads both balances. Injectable `fetch` for tests; never called under MOCK. */
export async function readCredit(apiKey: string, fetchFn: typeof fetch = fetch, timeoutMs = 5000): Promise<CreditReading> {
  try {
    const get = async (path: string) => {
      const res = await fetchFn(`https://openrouter.ai/api/v1/${path}`, { headers: { authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
      return ((await res.json()) as { data?: Record<string, unknown> }).data ?? {};
    };
    const key = await get('key');
    const keyRemaining = num(key.limit_remaining);
    if (keyRemaining === undefined) return { ok: false, why: 'key: limit_remaining is missing or not a number' };
    // The key's own limit is enough to decide on. OpenRouter may refuse /credits to
    // an ordinary key, so a failure there means "account balance unknown", not "unreadable".
    let accountRemaining: number | null = null;
    try {
      const credits = await get('credits');
      const total = num(credits.total_credits);
      const used = num(credits.total_usage);
      if (typeof total === 'number' && typeof used === 'number') accountRemaining = total - used;
    } catch {
      accountRemaining = null;
    }
    return { ok: true, credit: { keyRemaining, accountRemaining } };
  } catch (err) {
    return { ok: false, why: (err as Error).message.slice(0, 160) };
  }
}

// ---------------------------------------------------------------------------
// The uneven guest

export type GuestOutcome =
  | { kind: 'unchanged' }
  | { kind: 'discarded'; chef: string }
  | { kind: 'retained'; scored: string };

const isGuest = (guestId: string) => (j: { judge: string }) => j.judge === guestId;

/**
 * If the guest scored exactly one of the served finalists, either drop that
 * score for both (when each finalist still has a counted judge) or keep it
 * (when dropping it would leave that finalist unjudged). Mutates the entries
 * and returns what happened; `recompute` refreshes judgeAvg and total.
 */
export function reconcileGuest(entries: Entry[], guestId: string, recompute: (e: Entry) => void): GuestOutcome {
  const served = entries.filter((e) => !e.forfeit);
  if (served.length < 2) return { kind: 'unchanged' };
  const scored = served.filter((e) => e.judges.some(isGuest(guestId)));
  if (scored.length !== 1) return { kind: 'unchanged' };
  const withGuest = scored[0]!;
  // Dropping it would leave this finalist with no counted judge: keep it, and say so.
  if (!withGuest.judges.some((j) => !isGuest(guestId)(j))) return { kind: 'retained', scored: withGuest.contestant };
  const dropped = withGuest.judges.filter(isGuest(guestId));
  withGuest.judges = withGuest.judges.filter((j) => !isGuest(guestId)(j));
  withGuest.discardedGuestScores = [...(withGuest.discardedGuestScores ?? []), ...dropped];
  for (const e of served) {
    // Each finalist ends with exactly one guest outcome; earlier reasons are kept as attempts.
    const earlier = e.abstained.filter(isGuest(guestId));
    if (earlier.length) e.guestAttempts = [...(e.guestAttempts ?? []), ...earlier.map((a) => a.reason)];
    const name = dropped[0]?.judgeName ?? earlier[0]?.judgeName;
    const uneven: Abstention = { judge: guestId, ...(name ? { judgeName: name } : {}), reason: GUEST_UNEVEN_REASON };
    e.abstained = [...e.abstained.filter((a) => !isGuest(guestId)(a)), uneven];
    recompute(e);
  }
  return { kind: 'discarded', chef: withGuest.contestant };
}

/** The visible note when the guest's single score was kept. */
export const guestKeptNote = (scoredChef: string) =>
  `The guest judge scored only ${scoredChef}. That score was kept so both finalists have a score; the panels differed.`;

/** Mean of counted judges, then the usual weighting. */
export function recomputeTotal(e: Entry, judgeWeight: number, mechanicalWeight: number) {
  e.judgeAvg = e.judges.length ? e.judges.reduce((sum: number, j: JudgeScore) => sum + j.weighted, 0) / e.judges.length : 0;
  e.total = e.judgeAvg * judgeWeight + (e.mech?.score ?? 0) * mechanicalWeight;
}
