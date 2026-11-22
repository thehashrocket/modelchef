// Runs one episode: every remaining chef cooks, the dishes are photographed
// and machine-checked, the judges score them blind, the bottom two face a
// pressure test, and one chef goes home. episode.json and state.json are
// written only at the very end, so a run that fails before then records
// nothing. Read "If a run fails" in the README before re-running: a run always
// cooks the next episode.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Browser } from 'playwright';
import { capture } from './capture';
import { decideGuest, readCredit, reconcileGuest, recomputeTotal, type CreditReading } from './finale';
import { renderShareImage, shareCardFor } from './share-image';
import {
  CONTESTANTS,
  GUEST_JUDGE,
  GUEST_MIN_CREDIT_USD,
  JUDGES,
  MYSTERY_THEMES,
  PRESSURE_SPECS,
  SCORING,
  SECRET_INGREDIENT_FROM_EPISODE,
  SECRET_INGREDIENTS,
  type Contestant,
  type Judge,
  type SecretIngredient,
} from './config';
import { chat, ChatError, clipSentences, extractHtml, parseJson, type ChatResult } from './llm';
import { challengeText, cookPrompt, duelPrompt, guestBriefPrompt, judgePrompt, pressurePrompt, themePrompt, type Challenge, type Dish, type ShowContext } from './prompts';
import {
  episodeDir,
  loadState,
  saveState,
  writeJson,
  type DuelVote,
  type Entry,
  type Episode,
  type EpisodeType,
  type JudgeScore,
  type Outcome,
  type PressureTest,
  type Scores,
  type SeasonState,
  GUEST_SKIPPED_NO_CREDIT,
  SAME_FAMILY_REASON,
} from './state';
import type { Msg } from './llm';

const pick = <T>(xs: T[]): T => xs[Math.floor(Math.random() * xs.length)]!;
const shuffle = <T>(xs: T[]): T[] => xs.map((x) => [Math.random(), x] as const).sort((a, b) => a[0] - b[0]).map(([, x]) => x);
const log = (msg: string) => console.log(`[modelchef] ${msg}`);
/** "<provider>/<model>" for the model that answered a call. */
const modelOf = (res: ChatResult) => `${res.used.provider}/${res.used.model}`;

const decode = (s: string) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&amp;/g, '&');

function readMeta(html: string): { title: string | null; pitch: string | null } {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() || null;
  let pitch: string | null = null;
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    if (!/name\s*=\s*["']?description/i.test(tag)) continue;
    const m = /content\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag);
    pitch = (m?.[1] ?? m?.[2])?.trim() || null;
    break;
  }
  return { title: title && decode(title).slice(0, 80), pitch: pitch && decode(pitch).slice(0, 240) };
}

/** The chef's speech to the judges, as plain text. */
function readPresentation(reply: string): string {
  const m = /<presentation>([\s\S]*?)<\/presentation>/i.exec(reply);
  return (m?.[1] ?? '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, 900);
}

interface Cooked {
  chef: Contestant;
  forfeit: string | null;
  /** Set when no provider answered at all: the chef sits out instead of forfeiting. */
  sitOut: string | null;
  model: string | null;
  path: string;
  title: string;
  pitch: string;
  presentation: string;
  hasTitle: boolean;
  hasDescription: boolean;
}

/**
 * How long a chef's kitchen waits out a provider that is not answering at all before the
 * chef sits the episode out. Providers do not bill failed calls, so waiting costs only time.
 */
const COOK_PATIENCE_MS = Number(process.env.COOK_PATIENCE_MS ?? 10 * 60_000);
/** How long the winner's theme pick waits out a provider that is not answering. */
const THEME_PATIENCE_MS = Number(process.env.THEME_PATIENCE_MS ?? 5 * 60_000);
/** More chefs than this sitting out in one episode means the episode is not recorded. */
const MAX_SAT_OUT = 2;

async function cook(chef: Contestant, messages: Msg[], path: string): Promise<Cooked> {
  const base = { chef, path, model: null, sitOut: null, title: 'No dish', pitch: '', presentation: '', hasTitle: false, hasDescription: false };
  try {
    const { text, used, stop } = await chat(chef.models, messages, { maxTokens: chef.maxTokens, kind: 'cook', tag: chef.id, patienceMs: COOK_PATIENCE_MS });
    const html = extractHtml(text);
    const model = `${used.provider}/${used.model}`;
    if (!html) {
      const why =
        stop === 'length'
          ? `The dish was cut off at the ${chef.maxTokens}-token output limit before </html>. Raise this chef's maxTokens.`
          : `The reply did not contain a complete HTML document (stop reason: ${stop}, ${text.length} characters).`;
      return { ...base, model, forfeit: why };
    }
    writeFileSync(path, html);
    const meta = readMeta(html);
    return {
      ...base,
      model,
      forfeit: null,
      title: meta.title ?? 'Untitled',
      pitch: meta.pitch ?? '',
      presentation: readPresentation(text),
      hasTitle: !!meta.title,
      hasDescription: !!meta.pitch,
    };
  } catch (err) {
    // No provider answered at all: an outage, not a bad dish. The chef sits out.
    if (err instanceof ChatError && !err.answered) return { ...base, forfeit: null, sitOut: `No provider answered: ${err.message.slice(0, 300)}` };
    // A model that replied but never served a dish forfeits, as before.
    const msg = (err as Error).message;
    if (err instanceof ChatError && /stop reason: length/.test(msg)) {
      return { ...base, forfeit: `The model spent its whole ${chef.maxTokens}-token output budget without writing a dish (a thinking model reasoning past the limit). Raise this chef's maxTokens.` };
    }
    return { ...base, forfeit: `Model unavailable: ${msg.slice(0, 300)}` };
  }
}

/** A warning in the log, and on the Actions run page when on GitHub. */
const warn = (msg: string) => {
  log(`  WARNING: ${msg}`);
  if (process.env.GITHUB_ACTIONS) console.log(`::warning::${msg.replace(/\r?\n/g, ' ')}`);
};

/**
 * The finale guest's calls share one time budget (cumulative time spent in
 * guest calls, so cooking and other judging in between never count). Each
 * call gets a signal that fires when the budget runs out.
 */
class GuestBudget {
  constructor(private remainingMs: number) {}
  async run<T>(call: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.remainingMs <= 0) throw new Error('the guest judge is out of time');
    const started = Date.now();
    try {
      return await call(AbortSignal.timeout(this.remainingMs));
    } finally {
      this.remainingMs -= Date.now() - started;
    }
  }
}
const GUEST_BUDGET_MS = 15 * 60_000;

/**
 * How long each judge seat may spend, across the whole episode, waiting out a provider
 * that is not answering (429s, server errors). Free tiers do not bill failed calls, so it
 * costs only time; sharing it per seat keeps a dead judge from eating the 90-minute
 * Actions limit one dish at a time. Once spent, that judge's later calls get one pass only.
 */
const JUDGE_PATIENCE_MS = Number(process.env.JUDGE_PATIENCE_MS ?? 10 * 60_000);

class JudgePatience {
  private left = new Map<string, number>();
  ms(judgeId: string) {
    return this.left.get(judgeId) ?? JUDGE_PATIENCE_MS;
  }
  /** Times a judge call, and charges the seat for it when no provider answered at all. */
  async run<T>(judgeId: string, call: (patienceMs: number) => Promise<T>): Promise<T> {
    const started = Date.now();
    try {
      return await call(this.ms(judgeId));
    } catch (err) {
      if (err instanceof ChatError && !err.answered) {
        this.left.set(judgeId, Math.max(0, this.ms(judgeId) - (Date.now() - started)));
        console.warn(`[${judgeId}] no provider answered: ${err.message}`);
      }
      throw err;
    }
  }
}
const judgePatience = new JudgePatience();

/** OpenRouter balance for the guest. The mock never calls the network: MOCK_GUEST_FAIL=balance reads as nearly empty. */
async function guestCredit(guest: Judge): Promise<CreditReading> {
  if (process.env.MOCK) {
    return process.env.MOCK_GUEST_FAIL === 'balance'
      ? { ok: true, credit: { keyRemaining: 0.4, accountRemaining: 10 } }
      : { ok: true, credit: { keyRemaining: null, accountRemaining: 100 } };
  }
  if (!guest.models.every((m) => m.provider === 'openrouter')) return { ok: false, why: 'the guest is not billed through OpenRouter' };
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return { ok: false, why: 'OPENROUTER_API_KEY is not set' };
  return readCredit(key);
}

const clamp = (v: unknown) => Math.min(10, Math.max(1, Math.round(Number(v)) || 1));

async function judgeDish(panel: Judge[], challenge: Challenge, dish: Dish, chef: Contestant, show: ShowContext, guestBudget?: GuestBudget) {
  const judges: JudgeScore[] = [];
  const abstained: Entry['abstained'] = [];
  for (const judge of panel) {
    if (judge.family === chef.family) {
      abstained.push({ judge: judge.id, judgeName: judge.name, reason: SAME_FAMILY_REASON });
      continue;
    }
    // A judge whose reply cannot be read gets one more try before sitting out.
    let failure = '';
    // The model behind the last reply, kept even when that reply was unusable.
    let replied: string | undefined;
    for (let attempt = 1; attempt <= 2; attempt++) {
      replied = undefined;
      let raw = '';
      let stop = '';
      try {
        const opts = { maxTokens: 8000, temperature: 0.4, kind: 'judge' as const, tag: `${judge.id}:${chef.id}` };
        const prompt = judgePrompt(judge, challenge, dish, show);
        // Only the finale guest runs on a budget.
        const res =
          guestBudget && judge.id === GUEST_JUDGE?.id
            ? await guestBudget.run((signal) => chat(judge.models, prompt, { ...opts, signal }))
            : await judgePatience.run(judge.id, (patienceMs) => chat(judge.models, prompt, { ...opts, patienceMs }));
        replied = modelOf(res);
        stop = res.stop;
        const { text } = res;
        raw = text;
        const reply = parseJson<{ scores?: Partial<Scores>; critique?: string; improve?: string }>(text);
        if (!reply.scores) throw new Error('reply has no scores');
        const scores: Scores = {
          usefulness: clamp(reply.scores.usefulness),
          craft: clamp(reply.scores.craft),
          originality: clamp(reply.scores.originality),
          theme: clamp(reply.scores.theme),
        };
        const sum = scores.usefulness + scores.craft + scores.originality + scores.theme;
        const weighted = judge.lens === 'overall' ? sum / 4 : (sum + scores[judge.lens]) / 5;
        judges.push({
          judge: judge.id,
          judgeName: judge.name,
          lens: judge.lens,
          scores,
          weighted,
          critique: clipSentences(String(reply.critique ?? ''), 600),
          improve: clipSentences(String(reply.improve ?? ''), 300),
          model: replied,
        });
        failure = '';
        break;
      } catch (err) {
        failure = (err as Error).message.slice(0, 200);
        // The record keeps only the error; the raw reply goes to the run log so the next one can be diagnosed.
        if (raw) console.warn(`[${judge.id}:${chef.id}] unreadable reply (attempt ${attempt}, ${replied}, stop reason ${stop}, ${raw.length} chars): ${(err as Error).message}\n${raw.slice(0, 4000)}`);
        // An outage already had its patience inside chat(); a second pass right away rarely helps.
        if (err instanceof ChatError && !err.answered) break;
      }
    }
    if (failure) abstained.push({ judge: judge.id, judgeName: judge.name, reason: `Unavailable: ${failure}`, ...(replied ? { model: replied } : {}) });
  }
  return { judges, abstained };
}

async function pressureTest(
  browser: Browser,
  dir: string,
  /** Higher-ranked chef first. */
  chefs: [Contestant, Contestant],
  show: ShowContext,
): Promise<PressureTest> {
  const spec = pick(PRESSURE_SPECS);
  const [upper, lower] = chefs;
  const result: PressureTest = { spec, chefs: [upper.id, lower.id], forfeits: {}, votes: [], eliminated: lower.id, decidedBy: 'main-round score' };

  const dishes = new Map<string, Dish>();
  for (const chef of chefs) {
    const path = join(dir, 'pressure', `${chef.id}.html`);
    const cooked = await cook(chef, pressurePrompt(chef, spec), path);
    if (cooked.sitOut) {
      (result.satOut ??= {})[chef.id] = cooked.sitOut;
      continue;
    }
    if (cooked.forfeit) {
      result.forfeits[chef.id] = cooked.forfeit;
      continue;
    }
    const { mech, shots } = await capture(browser, path, join(dir, 'shots', `pressure-${chef.id}`), cooked);
    dishes.set(chef.id, { label: '', title: cooked.title, pitch: cooked.pitch, presentation: '', mech, source: readFileSync(path, 'utf8'), shots });
  }

  // An outage in the pressure test cannot send anyone home: the main round decides.
  if (result.satOut) return result;
  const forfeited = chefs.filter((c) => result.forfeits[c.id]);
  if (forfeited.length === 1) return { ...result, eliminated: forfeited[0]!.id, decidedBy: 'forfeit' };
  if (forfeited.length === 2) return result;

  const tally = new Map<string, number>([[upper.id, 0], [lower.id, 0]]);
  for (const judge of JUDGES) {
    const vote: DuelVote = { judge: judge.id, judgeName: judge.name, winner: null, reason: '' };
    result.votes.push(vote);
    if (chefs.some((c) => c.family === judge.family)) {
      vote.reason = 'Abstained: same model family as one of the chefs.';
      continue;
    }
    // Each judge sees the pair in a random order so position cannot decide it.
    const [a, b] = shuffle([upper, lower]) as [Contestant, Contestant];
    // Kept so the site can say which chef "Dish A" and "Dish B" were in this judge's reason.
    vote.order = [a.id, b.id];
    try {
      const prompt = duelPrompt(judge, spec, dishes.get(a.id)!, dishes.get(b.id)!, show);
      const res = await judgePatience.run(judge.id, (patienceMs) =>
        chat(judge.models, prompt, { maxTokens: 8000, temperature: 0.3, kind: 'duel', tag: `${judge.id}:duel`, patienceMs }),
      );
      vote.model = modelOf(res);
      const { text } = res;
      const reply = parseJson<{ winner?: string; reason?: string }>(text);
      const letter = String(reply.winner ?? '').trim().toUpperCase();
      if (letter !== 'A' && letter !== 'B') throw new Error('no clear winner in reply');
      vote.winner = letter === 'A' ? a.id : b.id;
      vote.reason = String(reply.reason ?? '').slice(0, 400);
      tally.set(vote.winner, tally.get(vote.winner)! + 1);
    } catch (err) {
      vote.reason = `Abstained: ${(err as Error).message.slice(0, 200)}`;
    }
  }

  const up = tally.get(upper.id)!;
  const low = tally.get(lower.id)!;
  if (up === low) return result; // tie or no votes: the main round decides
  return { ...result, eliminated: up > low ? lower.id : upper.id, decidedBy: 'votes' };
}

/**
 * The episode's share image. Never fails the episode: on any error it says how
 * to backfill the image once the episode is recorded. SHARE_IMAGE=0 skips it.
 */
async function shareImage(browser: Browser, dir: string, season: string, n: number, type: EpisodeType, theme: string | null, winner: Entry) {
  const out = join(dir, 'og.jpg');
  // A re-run must never publish a stale image from an earlier attempt.
  rmSync(out, { force: true });
  rmSync(`${out}.tmp`, { force: true });
  if (process.env.SHARE_IMAGE === '0') {
    log('  Share image skipped (SHARE_IMAGE=0).');
    return;
  }
  try {
    await renderShareImage(browser, out, shareCardFor(season, { number: n, type, theme }, winner, dir));
    log('  Share image: og.jpg');
  } catch (err) {
    const msg = `share image failed for ${dir}: ${(err as Error).message.split('\n')[0]!.replace(/\.$/, '')}. The episode continues. After it is recorded, run pnpm backfill-share-images ${season}/ep-${String(n).padStart(2, '0')} and commit ${join(dir, 'og.jpg')}.`;
    console.error(`[modelchef] ${msg}`);
    if (process.env.GITHUB_ACTIONS) console.log(`::warning::${msg}`);
  }
}

/** What the judges know about the season so far: only what actually happened on the show. */
function showContext(state: SeasonState, n: number): ShowContext {
  const histories = Object.values(state.contestants).flatMap((c) => c.history);
  const earlierWinners = state.episodes
    .map((ep) => {
      const h = state.contestants[ep.winner]?.history.find((x) => x.episode === ep.number);
      return h ? { episode: ep.number, title: h.title, pitch: h.pitch } : null;
    })
    .filter((w): w is ShowContext['earlierWinners'][number] => !!w);
  const m = /^season-0*(\d+)$/.exec(String(state.season));
  return { season: m ? `season ${m[1]}` : String(state.season), episode: n, earlierWinners, dishesJudged: histories.length };
}

async function main() {
  const state = loadState();
  if (state.champion) {
    log(`${state.season} is over. Champion: ${state.champion}. Bump SEASON in src/config.ts to start a new one.`);
    return;
  }
  const active = CONTESTANTS.filter((c) => state.contestants[c.id]?.status === 'active');
  if (active.length < 2) throw new Error('Fewer than two active chefs. Check the roster in src/config.ts against state.json.');

  const n = state.episodes.length + 1;
  const type: EpisodeType = active.length === 2 ? 'finale' : n % 2 === 1 ? 'mystery-box' : 'invention';
  let theme: string | null = null;
  let themeChosenBy: string | null = null;
  if (type === 'mystery-box') {
    theme = state.nextTheme?.theme ?? MYSTERY_THEMES[Math.floor(n / 2) % MYSTERY_THEMES.length]!;
    themeChosenBy = state.nextTheme?.chosenBy ?? null;
  }
  // Immunity lapses once three chefs remain, so the semifinal always has a real pressure test.
  const immune = active.length <= 3 ? null : state.immune;

  // Mystery Box twist: a secret ingredient on top of the theme, never repeated in a season.
  let ingredient: SecretIngredient | null = null;
  if (type === 'mystery-box' && n >= SECRET_INGREDIENT_FROM_EPISODE && SECRET_INGREDIENTS.length) {
    const used = new Set(state.episodes.map((e) => e.ingredient));
    const fresh = SECRET_INGREDIENTS.filter((i) => !used.has(i.id));
    ingredient = pick(fresh.length ? fresh : SECRET_INGREDIENTS);
  }

  // Finale: the guest judge sets the brief, and scores both dishes unless they
  // share a model family with a finalist (then they score neither). It takes
  // part only when there is credit for it, and its calls share a time budget.
  let guest: Judge | null = type === 'finale' ? GUEST_JUDGE : null;
  let guestSkipped: string | null = null;
  let panel: Judge[] = JUDGES;
  let guestBriefModel: string | null = null;
  const guestBudget = new GuestBudget(GUEST_BUDGET_MS);
  if (guest) {
    const decision = decideGuest(await guestCredit(guest), GUEST_MIN_CREDIT_USD);
    if (!decision.run) {
      // The account's figures never go public: not in the record, not on the site, and not in
      // GitHub Actions logs (public for a public repo). Local runs print them.
      guestSkipped = GUEST_SKIPPED_NO_CREDIT;
      const why = process.env.GITHUB_ACTIONS
        ? `OpenRouter credit is below GUEST_MIN_CREDIT_USD (amounts not logged on Actions; run pnpm check-models locally, or see the OpenRouter dashboard).`
        : decision.reason;
      warn(`${why} The finale runs on schedule without the guest judge.`);
      guest = null;
    } else if (decision.warning) warn(decision.warning);
  }
  if (guest) {
    const g = guest;
    const used = state.episodes.map((e) => e.theme).filter((t): t is string => !!t);
    const failures: string[] = [];
    // One retry. An empty brief counts as a failed attempt.
    for (let attempt = 1; attempt <= 2 && !theme; attempt++) {
      try {
        const res = await guestBudget.run((signal) => chat(g.models, guestBriefPrompt(g, used), { maxTokens: 4000, kind: 'brief', signal }));
        guestBriefModel = modelOf(res);
        const reply = parseJson<{ brief?: string; theme?: string }>(res.text);
        const brief = String(reply.brief ?? reply.theme ?? '').trim().slice(0, 240);
        if (!brief) throw new Error('the reply has no brief');
        theme = brief;
      } catch (err) {
        failures.push((err as Error).message.slice(0, 160));
      }
    }
    if (!theme) warn(`The guest judge could not set a brief (${failures.join(' | ')}); the finale runs with the default brief.`);
    if (active.some((c) => c.family === g.family)) log(`  ${g.name} shares a model family with a finalist, so sets the brief but does not score.`);
    else panel = [...JUDGES, g];
  }
  const challenge: Challenge = { type, theme, ingredient: ingredient?.text ?? null, guest: guest?.name ?? null };
  const show = showContext(state, n);

  const dir = episodeDir(n);
  for (const sub of ['apps', 'shots', 'pressure']) mkdirSync(join(dir, sub), { recursive: true });
  log(`Episode ${n}: ${type}${theme ? ` ("${theme}")` : ''}, ${active.length} chefs${immune ? `, ${immune} is immune` : ''}`);
  if (ingredient) log(`  Secret ingredient: ${ingredient.text}`);
  if (guest) log(`  Guest judge: ${guest.name}`);

  const labels = shuffle([...'ABCDEFGHIJKLMNOP'].slice(0, active.length));
  const entries: Entry[] = [];
  const satOut: { contestant: string; reason: string }[] = [];
  let pressure: PressureTest | null = null;
  let guestRuleSkipped: string | null = null;

  // Set CHROME_PATH to use an installed Chrome instead of Playwright's download.
  const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
  try {
    for (const [i, chef] of active.entries()) {
      const path = join(dir, 'apps', `${chef.id}.html`);
      const cooked = await cook(chef, cookPrompt(chef, n, challenge, state), path);
      if (cooked.sitOut) {
        satOut.push({ contestant: chef.id, reason: cooked.sitOut });
        warn(`${chef.id} sits out: ${cooked.sitOut}`);
        if (satOut.length > MAX_SAT_OUT) {
          throw new Error(`${satOut.length} chefs' providers did not answer (${satOut.map((s) => s.contestant).join(', ')}). Episode not recorded; run it again later.`);
        }
        continue;
      }
      const entry: Entry = {
        contestant: chef.id,
        label: `Dish ${labels[i]}`,
        model: cooked.model,
        forfeit: cooked.forfeit,
        title: cooked.title,
        pitch: cooked.pitch,
        presentation: cooked.presentation,
        mech: null,
        judges: [],
        abstained: [],
        judgeAvg: 0,
        total: 0,
        rank: 0,
      };
      entries.push(entry);
      if (cooked.forfeit) {
        log(`  ${chef.id} forfeits: ${cooked.forfeit}`);
        continue;
      }

      const { mech, shots } = await capture(browser, path, join(dir, 'shots', chef.id), { ...cooked, ingredient });
      entry.mech = mech;
      const dish: Dish = { label: entry.label, title: entry.title, pitch: entry.pitch, presentation: entry.presentation, mech, source: readFileSync(path, 'utf8'), shots };
      Object.assign(entry, await judgeDish(panel, challenge, dish, chef, show, guestBudget));
      if (!entry.judges.length) {
        throw new Error(`No judge could score ${chef.id} (${entry.abstained.map((a) => a.reason).join('; ')}). Episode not recorded.`);
      }
      entry.judgeAvg = entry.judges.reduce((sum, j) => sum + j.weighted, 0) / entry.judges.length;
      entry.total = entry.judgeAvg * SCORING.judgeWeight + mech.score * SCORING.mechanicalWeight;
      log(`  ${chef.id}: "${entry.title}" ${entry.total.toFixed(2)} (judges ${entry.judgeAvg.toFixed(2)}, machine ${mech.score})`);
    }

    if (entries.every((e) => e.forfeit)) throw new Error('Every chef forfeited. Check API keys and model IDs (pnpm check-models). Episode not recorded.');

    // Finale: a guest who scored only one finalist must not decide the season by itself.
    if (guest && panel.includes(guest)) {
      const outcome = reconcileGuest(entries, guest.id, (e) => recomputeTotal(e, SCORING.judgeWeight, SCORING.mechanicalWeight));
      if (outcome.kind === 'discarded') warn(`The guest judge scored only ${outcome.chef}, so neither finalist's guest score counts. Totals were recomputed from the regular panel.`);
      if (outcome.kind === 'retained') {
        guestRuleSkipped = `dropping the guest would leave ${outcome.scored} unjudged`;
        warn(`The guest judge scored only ${outcome.scored}, and no other judge did; the guest's score was kept.`);
      }
    }

    entries.sort((a, b) => b.total - a.total || (b.mech?.score ?? 0) - (a.mech?.score ?? 0));
    entries.forEach((e, i) => (e.rank = i + 1));

    if (type === 'finale' && satOut.length) {
      throw new Error(`A finalist's provider did not answer (${satOut.map((s) => s.contestant).join(', ')}). A champion is not crowned by an outage. Episode not recorded; run it again later.`);
    }
    if (type !== 'finale') {
      // The episode winner and the immune chef are safe; the two lowest of the rest cook again.
      const atRisk = entries.filter((e, i) => i > 0 && e.contestant !== immune).slice(-2);
      if (atRisk.length < 2) {
        throw new Error(`Too few chefs cooked for a pressure test (${satOut.length} sat out). Episode not recorded; run it again later.`);
      }
      const chefs = atRisk.map((e) => active.find((c) => c.id === e.contestant)!) as [Contestant, Contestant];
      log(`  Pressure test: ${chefs[0].id} vs ${chefs[1].id}`);
      pressure = await pressureTest(browser, dir, chefs, show);
    }

    await shareImage(browser, dir, state.season, n, type, theme, entries[0]!);
  } finally {
    await browser.close();
  }

  const winner = entries[0]!.contestant;
  const eliminated = type === 'finale' ? entries[1]!.contestant : pressure!.eliminated;
  const date = new Date().toISOString().slice(0, 10);

  for (const e of entries) {
    const outcome: Outcome =
      e.contestant === eliminated ? 'eliminated'
      : e.contestant === winner ? 'won'
      : pressure?.chefs.includes(e.contestant) ? 'survived the pressure test'
      : 'safe';
    state.contestants[e.contestant]!.history.push({
      episode: n,
      type,
      theme,
      title: e.title,
      pitch: e.forfeit ? `Forfeited. ${e.forfeit}` : e.pitch,
      rank: e.rank,
      of: entries.length,
      total: e.total,
      outcome,
      feedback: e.judges.map((j) => ({ judge: j.judgeName, critique: j.critique, improve: j.improve })),
    });
  }
  state.contestants[eliminated]!.status = 'eliminated';
  state.contestants[eliminated]!.eliminatedIn = n;
  state.episodes.push({ number: n, date, type, theme, ingredient: ingredient?.id ?? null, winner, eliminated });
  state.nextTheme = type === 'mystery-box' ? null : state.nextTheme;
  state.immune = winner;
  if (type === 'finale') {
    state.contestants[winner]!.status = 'champion';
    state.champion = winner;
    state.immune = null;
  }

  // The winner sets the theme when the next episode is a Mystery Box.
  const remaining = active.length - 1;
  if (!state.champion && remaining > 2 && (n + 1) % 2 === 1) {
    const chef = active.find((c) => c.id === winner)!;
    const used = state.episodes.map((e) => e.theme).filter((t): t is string => !!t);
    try {
      // The pick is the winner's prize: wait out an outage instead of losing it to one.
      const { text } = await chat(chef.models, themePrompt(chef, used), { maxTokens: 4000, kind: 'theme', tag: chef.id, patienceMs: THEME_PATIENCE_MS });
      const chosen = String(parseJson<{ theme?: string }>(text).theme ?? '').trim().slice(0, 120);
      if (chosen) state.nextTheme = { theme: chosen, chosenBy: winner };
    } catch (err) {
      log(`  ${winner} could not pick a theme (${(err as Error).message.slice(0, 120)}); using the house list.`);
    }
  }

  const episode: Episode = {
    number: n,
    date,
    type,
    theme,
    themeChosenBy,
    ingredient: ingredient ? { id: ingredient.id, text: ingredient.text } : null,
    brief: challengeText(challenge),
    guestJudge: guest?.name ?? null,
    guestBriefModel,
    ...(type === 'finale' ? { guestSkipped, guestRuleSkipped } : {}),
    immune,
    ...(satOut.length ? { satOut } : {}),
    entries,
    winner,
    pressure,
    eliminated,
  };
  writeJson(join(dir, 'episode.json'), episode);
  saveState(state);

  log(`Winner: ${winner}. Eliminated: ${eliminated}${pressure ? ` (${pressure.decidedBy})` : ''}.`);
  if (state.champion) log(`${state.champion} is the ${state.season} champion.`);
  else if (state.nextTheme) log(`Next Mystery Box, chosen by ${state.nextTheme.chosenBy}: "${state.nextTheme.theme}"`);
}

main().catch((err) => {
  console.error(`[modelchef] ${(err as Error).message}`);
  process.exit(1);
});
