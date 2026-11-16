// Runs one episode: every remaining chef cooks, the dishes are photographed
// and machine-checked, the judges score them blind, the bottom two face a
// pressure test, and one chef goes home. Nothing is recorded unless the whole
// episode completes, so a failed run can simply be run again.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Browser } from 'playwright';
import { capture } from './capture';
import {
  CONTESTANTS,
  GUEST_JUDGE,
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
import { chat, extractHtml, parseJson, type ChatResult } from './llm';
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
  model: string | null;
  path: string;
  title: string;
  pitch: string;
  presentation: string;
  hasTitle: boolean;
  hasDescription: boolean;
}

async function cook(chef: Contestant, messages: Msg[], path: string): Promise<Cooked> {
  const base = { chef, path, model: null, title: 'No dish', pitch: '', presentation: '', hasTitle: false, hasDescription: false };
  try {
    const { text, used, stop } = await chat(chef.models, messages, { maxTokens: chef.maxTokens, kind: 'cook', tag: chef.id });
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
    return { ...base, forfeit: `Model unavailable: ${(err as Error).message.slice(0, 300)}` };
  }
}

const clamp = (v: unknown) => Math.min(10, Math.max(1, Math.round(Number(v)) || 1));

async function judgeDish(panel: Judge[], challenge: Challenge, dish: Dish, chefFamily: string, show: ShowContext) {
  const judges: JudgeScore[] = [];
  const abstained: Entry['abstained'] = [];
  for (const judge of panel) {
    if (judge.family === chefFamily) {
      abstained.push({ judge: judge.id, judgeName: judge.name, reason: SAME_FAMILY_REASON });
      continue;
    }
    // A judge whose reply cannot be read gets one more try before sitting out.
    let failure = '';
    // The model behind the last reply, kept even when that reply was unusable.
    let replied: string | undefined;
    for (let attempt = 1; attempt <= 2; attempt++) {
      replied = undefined;
      try {
        const res = await chat(judge.models, judgePrompt(judge, challenge, dish, show), { maxTokens: 8000, temperature: 0.4, kind: 'judge', tag: judge.id });
        replied = modelOf(res);
        const { text } = res;
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
          critique: String(reply.critique ?? '').slice(0, 600),
          improve: String(reply.improve ?? '').slice(0, 300),
          model: replied,
        });
        failure = '';
        break;
      } catch (err) {
        failure = (err as Error).message.slice(0, 200);
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
    if (cooked.forfeit) {
      result.forfeits[chef.id] = cooked.forfeit;
      continue;
    }
    const { mech, shots } = await capture(browser, path, join(dir, 'shots', `pressure-${chef.id}`), cooked);
    dishes.set(chef.id, { label: '', title: cooked.title, pitch: cooked.pitch, presentation: '', mech, source: readFileSync(path, 'utf8'), shots });
  }

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
      const res = await chat(judge.models, duelPrompt(judge, spec, dishes.get(a.id)!, dishes.get(b.id)!, show), { maxTokens: 8000, temperature: 0.3, kind: 'duel', tag: judge.id });
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
  // share a model family with a finalist (then they score neither).
  const guest = type === 'finale' ? GUEST_JUDGE : null;
  let panel: Judge[] = JUDGES;
  let guestBriefModel: string | null = null;
  if (guest) {
    try {
      const used = state.episodes.map((e) => e.theme).filter((t): t is string => !!t);
      const res = await chat(guest.models, guestBriefPrompt(guest, used), { maxTokens: 4000, kind: 'theme' });
      guestBriefModel = modelOf(res);
      const { text } = res;
      const reply = parseJson<{ brief?: string; theme?: string }>(text);
      theme = String(reply.brief ?? reply.theme ?? '').trim().slice(0, 240) || null;
    } catch (err) {
      log(`  Guest judge could not set a brief (${(err as Error).message.slice(0, 160)}); the finale runs without one.`);
    }
    if (active.some((c) => c.family === guest.family)) log(`  ${guest.name} shares a model family with a finalist, so sets the brief but does not score.`);
    else panel = [...JUDGES, guest];
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
  let pressure: PressureTest | null = null;

  // Set CHROME_PATH to use an installed Chrome instead of Playwright's download.
  const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
  try {
    for (const [i, chef] of active.entries()) {
      const path = join(dir, 'apps', `${chef.id}.html`);
      const cooked = await cook(chef, cookPrompt(chef, n, challenge, state), path);
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
      Object.assign(entry, await judgeDish(panel, challenge, dish, chef.family, show));
      if (!entry.judges.length) {
        throw new Error(`No judge could score ${chef.id} (${entry.abstained.map((a) => a.reason).join('; ')}). Episode not recorded.`);
      }
      entry.judgeAvg = entry.judges.reduce((sum, j) => sum + j.weighted, 0) / entry.judges.length;
      entry.total = entry.judgeAvg * SCORING.judgeWeight + mech.score * SCORING.mechanicalWeight;
      log(`  ${chef.id}: "${entry.title}" ${entry.total.toFixed(2)} (judges ${entry.judgeAvg.toFixed(2)}, machine ${mech.score})`);
    }

    if (entries.every((e) => e.forfeit)) throw new Error('Every chef forfeited. Check API keys and model IDs (pnpm check-models). Episode not recorded.');

    entries.sort((a, b) => b.total - a.total || (b.mech?.score ?? 0) - (a.mech?.score ?? 0));
    entries.forEach((e, i) => (e.rank = i + 1));

    if (type !== 'finale') {
      // The episode winner and the immune chef are safe; the two lowest of the rest cook again.
      const atRisk = entries.filter((e, i) => i > 0 && e.contestant !== immune).slice(-2);
      const chefs = atRisk.map((e) => active.find((c) => c.id === e.contestant)!) as [Contestant, Contestant];
      log(`  Pressure test: ${chefs[0].id} vs ${chefs[1].id}`);
      pressure = await pressureTest(browser, dir, chefs, show);
    }
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
      const { text } = await chat(chef.models, themePrompt(chef, used), { maxTokens: 4000, kind: 'theme', tag: chef.id });
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
    immune,
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
