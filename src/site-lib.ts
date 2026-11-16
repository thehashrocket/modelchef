// Pure renderers for the static site. No file system access and nothing runs at
// import time, so tests can import these directly. build-site.ts does the I/O.
//
// Every string that came out of a model goes through esc() before it reaches HTML.
import { CONTESTANTS, GUEST_JUDGE, JUDGES, SCORING, type Judge } from './config';
import { guestKeptNote } from './finale';
import { challengeText, RULES } from './prompts';
import { GUEST_UNEVEN_REASON, isPilot, SAME_FAMILY_REASON, seasonLabel, TYPE_LABEL, type Abstention, type DuelVote, type Entry, type Episode, type JudgeScore, type MechReport } from './state';

export const esc = (s: unknown) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
export const chefName = (id: string) => CONTESTANTS.find((c) => c.id === id)?.name ?? id;
export const judgeName = (id: string) => JUDGES.find((j) => j.id === id)?.name ?? (GUEST_JUDGE?.id === id ? GUEST_JUDGE.name : id);

// ---------------------------------------------------------------------------
// Judge identity: a colour and a monogram from config. Names always come from
// the episode record, so retiring or renaming a judge never rewrites history.

/** Every judge with a seat: the regular panel, plus the finale guest when there is one. */
export const panelJudges = (guest: Judge | null = GUEST_JUDGE): Judge[] => [...JUDGES, ...(guest ? [guest] : [])];
export const judgeClass = (id: string) => `j-${id.toLowerCase().replace(/[^a-z0-9-]/g, '')}`;
const judgeConfig = (id: string) => panelJudges().find((j) => j.id === id);

/** Per-judge colour variables for STYLE, light and dark. Unknown ids fall back to --muted. */
export function judgeCss(judges: Judge[] = panelJudges()): string {
  const light = judges.map((j) => `.${judgeClass(j.id)}{--j:${j.color.light}}`).join('');
  const dark = judges.map((j) => `.${judgeClass(j.id)}{--j:${j.color.dark}}`).join('');
  return `${light}\n@media (prefers-color-scheme:dark){${dark}}`;
}

/** A decorative circle with the judge's initial. The name text always sits beside it. */
export function monogram(judgeId: string, fallbackName = ''): string {
  const cfg = judgeConfig(judgeId);
  const letter = (cfg?.short ?? fallbackName.replace(/^The /, '') ?? judgeId).charAt(0).toUpperCase() || '?';
  return `<span class="mono ${cfg ? judgeClass(judgeId) : 'j-unknown'}" aria-hidden="true">${esc(letter)}</span>`;
}

/** The name to show for a judge: the record's, then config's, then the raw id. */
const shownName = (judge: string, recorded?: string) => recorded ?? judgeName(judge);
const shortOf = (judge: string, name: string) => (judge === GUEST_JUDGE?.id ? name : (judgeConfig(judge)?.short ?? name.replace(/^The /, '')));

/** Ids in a record that config no longer knows (a retired judge, or a typo). */
export function unknownJudgeIds(ep: Episode): string[] {
  const ids = new Set([...ep.entries.flatMap((e) => [...e.judges.map((j) => j.judge), ...e.abstained.map((a) => a.judge)]), ...(ep.pressure?.votes.map((v) => v.judge) ?? [])]);
  return [...ids].filter((id) => !judgeConfig(id) && id !== 'guest');
}

export type ChipKind = 'scored' | 'sat-out' | 'no-score' | 'not-counted';
export const SAT_OUT_TITLE = 'Same lab as this chef, so this judge sat the dish out.';
export const NO_SCORE_TITLE = "This judge's reply couldn't be read, so the dish was scored by the others.";
/** Why a judge has no number on a dish, from the abstention's reason. */
export function abstentionKind(reason: string, guestUnevenReason?: string): Exclude<ChipKind, 'scored'> {
  if (isSameFamily(reason)) return 'sat-out';
  if (guestUnevenReason && reason === guestUnevenReason) return 'not-counted';
  return 'no-score';
}
export const pad = (n: number) => String(n).padStart(2, '0');
export { isPilot, seasonLabel, TYPE_LABEL };
/**
 * Marks a link, button or disclosure for the page's analytics listener: a click
 * (or opening a <details>) sends `name` with these props to Vercel and Google
 * Analytics. Props are ids and numbers only, never model-written text.
 */
export function evAttrs(name: string, props: Record<string, string | number | boolean> = {}): string {
  return ` data-ev="${esc(name)}" data-ev-props="${esc(JSON.stringify(props))}"`;
}
/** The analytics props that identify a dish. */
const dishProps = (season: string, ep: Episode, e: Entry) => ({ season, episode: ep.number, chef: e.contestant, rank: e.rank, featured: e.contestant === ep.winner });

export const fmtDate = (iso: string) => {
  const d = new Date(`${iso}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
};

/** og:image and friends. Absolute URLs only when the site's URL is known; unfurlers ignore relative ones. */
export interface MetaInput {
  title: string;
  description: string;
  /** Site path with a leading slash, e.g. "/s/season-01/ep-01/". */
  path: string;
  /** Site path of the image with a leading slash, already versioned if wanted. */
  image?: string;
  width?: number;
  height?: number;
}

export function metaTags(m: MetaInput, siteUrl: string): string {
  const tag = (attr: 'property' | 'name', key: string, value: string | number) => `<meta ${attr}="${key}" content="${esc(value)}">`;
  const out = [
    tag('property', 'og:title', m.title),
    tag('property', 'og:description', m.description),
    tag('property', 'og:type', 'website'),
    tag('property', 'og:site_name', 'ModelChef'),
    tag('name', 'twitter:card', 'summary_large_image'),
    tag('name', 'twitter:title', m.title),
    tag('name', 'twitter:description', m.description),
  ];
  if (siteUrl) {
    // The site answers on more than one host (custom domain and *.vercel.app); search engines index this one.
    out.push(`<link rel="canonical" href="${esc(siteUrl + m.path)}">`);
    out.push(tag('property', 'og:url', siteUrl + m.path));
    if (m.image) {
      out.push(tag('property', 'og:image', siteUrl + m.image));
      if (m.width && m.height) out.push(tag('property', 'og:image:width', m.width), tag('property', 'og:image:height', m.height));
      out.push(tag('name', 'twitter:image', siteUrl + m.image));
    }
  }
  return out.join('\n');
}

/**
 * The site's absolute URL for share tags: SITE_URL if set (empty disables it),
 * else Vercel's production URL on production builds only. A malformed value
 * warns and is ignored: a cosmetic tag must never fail a deploy.
 */
export function resolveSiteUrl(env: Record<string, string | undefined>): { url: string; note: string } {
  if (env.SITE_URL !== undefined) {
    const v = env.SITE_URL.trim().replace(/\/+$/, '');
    if (!v) return { url: '', note: 'share tags: relative only (SITE_URL is empty)' };
    if (!/^https?:\/\/[^/]/.test(v)) return { url: '', note: `warning: SITE_URL must start with https:// (got "${env.SITE_URL}"); building without absolute share tags` };
    return { url: v, note: `share tags: absolute via SITE_URL=${v}` };
  }
  if (env.VERCEL_ENV === 'production' && env.VERCEL_PROJECT_PRODUCTION_URL) {
    const v = `https://${env.VERCEL_PROJECT_PRODUCTION_URL.replace(/\/+$/, '')}`;
    return { url: v, note: `share tags: absolute via VERCEL_PROJECT_PRODUCTION_URL=${v}` };
  }
  return { url: '', note: 'share tags: relative only (SITE_URL unset)' };
}
/** Where an episode's files live, relative to the site root. */
export const epPath = (season: string, ep: Episode) => `s/${season}/ep-${pad(ep.number)}`;
export const epAnchor = (season: string, ep: Episode) => `${season}-ep-${pad(ep.number)}`;

/**
 * A formatter for one set of scores shown together: 1 decimal, unless two
 * different values would print the same at 1 decimal, then 2 decimals for the
 * whole set. "Different" compares 2-decimal strings, so float noise never
 * counts. With three or more values a single collision widens all of them.
 */
export function fmtScores(values: number[]): (v: number) => string {
  const byOne = new Map<string, Set<string>>();
  for (const v of values) {
    const one = v.toFixed(1);
    if (!byOne.has(one)) byOne.set(one, new Set());
    byOne.get(one)!.add(v.toFixed(2));
  }
  const digits = [...byOne.values()].some((two) => two.size > 1) ? 2 : 1;
  return (v: number) => v.toFixed(digits);
}
/** The formatter for one episode's dish scores. */
export const episodeFmt = (ep: Episode) => fmtScores(ep.entries.filter((e) => !e.forfeit).map((e) => e.total));
/** How a dish's score is made, from SCORING. */
export const SCORE_EXPLAINED = `A dish's score is the judges' average × ${SCORING.judgeWeight} plus the machine check × ${SCORING.mechanicalWeight}.`;

/** Judges see the pressure-test pair as "Dish A" and "Dish B"; readers should see who they mean. */
export function nameDishes(reason: string, order?: [string, string]): string {
  if (!order) return esc(reason);
  const name = (l: string) => chefName(l === 'A' ? order[0] : order[1]);
  return esc(reason.replace(/\bDish ([AB])\b/g, (_, l: string) => name(l)).replace(/\b([AB])(['’]s)\b/g, (_, l: string, s: string) => name(l) + s));
}

/** Records made before judge models were kept have no `model` on any score. */
const keepsModels = (ep: Episode) => ep.entries.some((e) => e.judges.some((j) => j.model)) || !!ep.pressure?.votes.some((v) => v.model);
export const isSameFamily = (reason: string) => reason === SAME_FAMILY_REASON || /^(Abstained: )?same model family/i.test(reason);
const prov = (text: string) => `<small class="prov">${text}</small>`;
/** Which model stood behind a judge's score, vote or abstention. */
export function provenance(ep: Episode, x: JudgeScore | DuelVote | Abstention): string {
  if ('reason' in x && isSameFamily(x.reason)) return '';
  if (!keepsModels(ep)) return prov('model not recorded');
  const scored = 'scores' in x || ('winner' in x && x.winner !== null);
  if (x.model) return prov(scored ? `judged by ${esc(x.model)}` : `reply from ${esc(x.model)} could not be read`);
  return prov('no model answered');
}

// ---------------------------------------------------------------------------
// The recap: what happened in an episode, in one or two sentences, from data.

const counted = (ep: Episode) => {
  const p = ep.pressure;
  const tally = new Map<string, number>((p?.chefs ?? []).map((id) => [id, 0]));
  for (const v of p?.votes ?? []) if (v.winner && tally.has(v.winner)) tally.set(v.winner, tally.get(v.winner)! + 1);
  return tally;
};

/** Plain text (escape it where it is used). The words "pressure test" may be linked by recapHtml(). */
export function recapText(season: string, ep: Episode): string {
  return recapParts(season, ep).join(' ');
}

/** The recap's sentences: what the winner did, then (outside a finale) how the pressure test went. */
function recapParts(season: string, ep: Episode): [string] | [string, string] {
  const win = ep.entries.find((e) => e.contestant === ep.winner);
  const winner = chefName(ep.winner);
  const f = episodeFmt(ep);
  if (ep.type === 'finale') {
    const runnerUp = ep.entries.find((e) => e.contestant === ep.eliminated);
    if (!win || win.forfeit || !runnerUp) return [`${winner} won.`];
    return [`${winner} is the ${seasonLabel(season)} champion, beating ${chefName(runnerUp.contestant)} ${f(win.total)} to ${f(runnerUp.total)}.`];
  }
  const first = !win || win.forfeit ? `${winner} won.` : `${winner} won with "${win.title}" (${f(win.total)}).`;
  const p = ep.pressure;
  if (!p) return [first];
  const out = chefName(p.eliminated);
  const survivor = chefName(p.chefs.find((id) => id !== p.eliminated) ?? '');
  const tally = counted(ep);
  const votesFor = (id: string) => tally.get(id) ?? 0;
  let second: string;
  if (p.decidedBy === 'votes') {
    const w = Math.max(...tally.values());
    const l = Math.min(...tally.values());
    second = `${out} lost the pressure test ${w}–${l} to ${survivor} and went home.`;
  } else if (p.decidedBy === 'forfeit') {
    second = `${out} didn't serve a pressure-test dish and went home.`;
  } else if (p.chefs.every((id) => p.forfeits[id])) {
    second = `Neither chef served a pressure-test dish, so the main-round score sent ${out} home.`;
  } else if (p.chefs.some((id) => votesFor(id) > 0)) {
    const [a, b] = p.chefs.map(votesFor) as [number, number];
    second = `The judges tied ${a}–${b} on the pressure test, so the main-round score sent ${out} home.`;
  } else {
    second = `No judge could pick a pressure-test winner, so the main-round score sent ${out} home.`;
  }
  return [first, second];
}

/** The recap as HTML, with "pressure test" linking to the pressure block (always on the same page as the recap). */
export function recapHtml(season: string, ep: Episode): string {
  const [first, second] = recapParts(season, ep);
  if (!second) return esc(first);
  // Only the generated sentence is linked: the first one carries a model-written dish title.
  return `${esc(first)} ${esc(second).replace('pressure test', `<a href="#${epAnchor(season, ep)}-pressure">pressure test</a>`)}`;
}

// ---------------------------------------------------------------------------
// Card pieces shared by card() and featuredCard().

export function badgesFor(ep: Episode, e: Entry): string {
  const badges: string[] = [];
  if (e.contestant === ep.winner) badges.push(`<span class="badge win">${ep.type === 'finale' ? 'Champion' : 'Winner'}</span>`);
  if (e.contestant === ep.immune) badges.push('<span class="badge">Immune</span>');
  if (ep.pressure?.chefs.includes(e.contestant)) badges.push('<span class="badge">Pressure test</span>');
  if (e.contestant === ep.eliminated) badges.push('<span class="badge gone">Eliminated</span>');
  if (e.forfeit) badges.push('<span class="badge gone">Forfeit</span>');
  return `<div class="badges">${badges.join('')}</div>`;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const kb = (bytes: number, precise: boolean) => `${(bytes / 1024).toFixed(precise ? 1 : 0)} KB`;

/** What the machine check found wrong, in reading order. Counts only: dish output never goes in here. */
export function mechProblems(m: MechReport): string[] {
  const problems: string[] = [];
  if (m.blank) problems.push('Rendered blank');
  if (m.networkAttempts.length) problems.push(plural(m.networkAttempts.length, 'network attempt'));
  if (m.consoleErrors.length) problems.push(plural(m.consoleErrors.length, 'console error'));
  if (m.mobileOverflow) problems.push('Overflows on phone');
  if (m.ingredient === 'missing') problems.push('Secret ingredient missing');
  if (!m.hasTitle || !m.hasDescription) problems.push('Missing title or description');
  return problems;
}

/**
 * One line per dish: a quiet "passed" when nothing went wrong, the specific
 * problems when something did. The size is always shown when size is the
 * secret ingredient, and the ingredient result whenever the episode had one.
 */
export function mechLine(m: MechReport | null, ep: Episode): string {
  if (!m) return '';
  const tiny = ep.ingredient?.id === 'tiny';
  const size = tiny ? ` · ${kb(m.bytes, true)}` : '';
  const ingredient =
    m.ingredient === 'present' ? ' · secret ingredient check passed'
    : m.ingredient === 'unchecked' ? ' · secret ingredient not machine-checked'
    : '';
  const problems = mechProblems(m);
  if (!problems.length) {
    const detail = `Machine check passed, ${m.score}/10 · ${kb(m.bytes, tiny)} · no console errors · no network attempts${ingredient}${m.ingredient === 'present' ? ' (a source check, not a play test)' : ''}`;
    return `<div class="mech ok"><span aria-hidden="true" title="${esc(detail)}"><span class="tick">✓</span> Machine check passed${size}${ingredient}</span><span class="sr">${esc(detail)}</span></div>`;
  }
  return `<div class="mech bad"><span aria-hidden="true">⚠</span> Machine check <b>${m.score}/10</b>: <span class="problems">${problems.join(' · ')}</span>${size}${ingredient}</div>`;
}

const isGuestId = (judge: string) => judge === GUEST_JUDGE?.id || judge === 'guest';
const guestMark = (judge: string) => (isGuestId(judge) ? ' <span class="gm">Guest</span>' : '');
/** How each kind of missing judge reads: on the chip, and in plain words beside the raw reason. A null title uses the reason itself. */
const ABSENCE: Record<Exclude<ChipKind, 'scored'>, { label: string; title: string | null }> = {
  'sat-out': { label: 'sat out', title: SAT_OUT_TITLE },
  'no-score': { label: 'no score', title: NO_SCORE_TITLE },
  'not-counted': { label: 'not counted', title: null },
};

/** One chip per panel judge: a score, "sat out", or "no score". Raw error text never goes in a chip. */
export function judgeChips(_ep: Episode, e: Entry): string {
  if (!e.judges.length) return '';
  const scored = e.judges.map((j) => `<span class="chip">${monogram(j.judge, j.judgeName)}${esc(shortOf(j.judge, j.judgeName))}${guestMark(j.judge)} <b>${j.weighted.toFixed(1)}</b></span>`);
  const missing = e.abstained.map((a) => {
    // The guest's missing chip says just "Guest"; regular judges use their short name.
    const name = isGuestId(a.judge) ? 'Guest' : shortOf(a.judge, shownName(a.judge, a.judgeName));
    const { label, title } = ABSENCE[abstentionKind(a.reason, GUEST_UNEVEN_REASON)];
    return `<span class="chip out" title="${esc(title ?? a.reason)}">${monogram(a.judge, name)}${esc(name)} · ${label}</span>`;
  });
  return `<div class="jrow" aria-label="Judge scores">${[...scored, ...missing].join('')}</div>`;
}

/** The judges' critiques. `open` renders them bare instead of inside a closed disclosure. */
export function notesBlock(ep: Episode, e: Entry, open: boolean): string {
  if (!e.judges.length) return '';
  const quotes =
    e.judges
      .map(
        (j) =>
          `<blockquote><b>${monogram(j.judge, j.judgeName)}${esc(j.judgeName)} · ${j.weighted.toFixed(1)}</b>${esc(j.critique)}<br><small>Use ${j.scores.usefulness} · Craft ${j.scores.craft} · Originality ${j.scores.originality} · Theme ${j.scores.theme}</small>${provenance(ep, j)}</blockquote>`,
      )
      .join('') +
    e.abstained
      .map((a) => {
        const name = shownName(a.judge, a.judgeName);
        const plain = ABSENCE[abstentionKind(a.reason, GUEST_UNEVEN_REASON)].title;
        return `<blockquote><b>${monogram(a.judge, name)}${esc(name)} abstained</b>${plain ? `<span class="why">${esc(plain)}</span>` : ''}<small>${esc(a.reason)}</small>${provenance(ep, a)}</blockquote>`;
      })
      .join('');
  return open
    ? `<div class="notes"><h4>Judges' notes</h4>${quotes}</div>`
    : `<details${evAttrs('notes_open', { episode: ep.number, chef: e.contestant })}><summary>Judges' notes</summary>${quotes}</details>`;
}

const twoDp = (n: number) => n.toFixed(2);
/** A rank tooltip when this entry's total ties another's. */
export function tieTitle(ep: Episode, e: Entry): string {
  if (e.forfeit) return '';
  const tied = ep.entries.filter((o) => !o.forfeit && twoDp(o.total) === twoDp(e.total));
  if (tied.length < 2) return '';
  const machine = new Set(tied.map((o) => o.mech?.score ?? 0));
  return machine.size > 1 ? 'Tied on score; ranked by machine check' : 'Tied on score';
}

const rankSpan = (ep: Episode, e: Entry) => {
  const t = tieTitle(ep, e);
  return t ? `<span title="${t}">${e.rank}.</span>` : `${e.rank}.`;
};

function plate(season: string, ep: Episode, e: Entry, root: string): string {
  const base = `${root}${epPath(season, ep)}`;
  // Every dish sits on the same neutral mat under a fake browser bar, so light and dark apps read as one set.
  return e.forfeit
    ? `<div class="plate shot"><div class="noshot">No dish served.<br>${esc(e.forfeit)}</div></div>`
    : `<a class="plate shot" href="${base}/play-${e.contestant}.html"${evAttrs('dish_open', { ...dishProps(season, ep, e), from: 'thumbnail' })} aria-label="Open ${esc(e.title)}"><span class="chrome" aria-hidden="true"><i></i><i></i><i></i></span><img loading="lazy" src="${base}/shots/${e.contestant}-desktop.jpg" alt="Screenshot of ${esc(e.title)} at desktop width" width="1280" height="800"></a>`;
}

const scoreText = (ep: Episode, e: Entry) =>
  e.forfeit ? '–' : `<span title="${esc(SCORE_EXPLAINED)}">${episodeFmt(ep)(e.total)}</span><span class="outof">/10</span>`;
const openLink = (season: string, ep: Episode, e: Entry, root: string) =>
  e.forfeit ? '' : `<a class="play" href="${root}${epPath(season, ep)}/play-${e.contestant}.html"${evAttrs('dish_open', { ...dishProps(season, ep, e), from: 'link' })}>Open the dish &rarr;</a>`;
const presentation = (e: Entry) =>
  e.presentation ? `<details class="says"><summary>What the chef told the judges</summary><p>${esc(e.presentation)}</p></details>` : '';

export function card(season: string, ep: Episode, e: Entry, root = ''): string {
  return `<article class="card">${plate(season, ep, e, root)}<div class="body">
<div class="row"><h3>${rankSpan(ep, e)} ${esc(e.title)}</h3><span class="score">${scoreText(ep, e)}</span></div>
<div class="by">${esc(chefName(e.contestant))}</div>
${badgesFor(ep, e)}
${e.forfeit ? '' : `<p class="pitch">${esc(e.pitch)}</p>`}
${presentation(e)}
${judgeChips(ep, e)}${mechLine(e.mech, ep)}${notesBlock(ep, e, false)}
${openLink(season, ep, e, root)}
</div></article>`;
}

/** The episode's winning dish, larger, with the critiques on show. */
export function featuredCard(season: string, ep: Episode, e: Entry, root = ''): string {
  // A <details> cannot open by screen width, so the critiques render twice: bare on wide screens, folded on narrow ones.
  return `<article class="feature">${plate(season, ep, e, root)}<div class="body">
<div class="row"><h3>${rankSpan(ep, e)} ${esc(e.title)}</h3><span class="score">${scoreText(ep, e)}</span></div>
<div class="by">${esc(chefName(e.contestant))}</div>
${badgesFor(ep, e)}
${e.forfeit ? '' : `<p class="pitch">${esc(e.pitch)}</p>`}
${openLink(season, ep, e, root)}
${presentation(e)}
${judgeChips(ep, e)}${mechLine(e.mech, ep)}
<div class="wide-only">${notesBlock(ep, e, true)}</div><div class="narrow-only">${notesBlock(ep, e, false)}</div>
</div></article>`;
}

/** One judge's pressure-test vote, with chef names in place of "Dish A/B" and the model behind it. */
function voteItem(ep: Episode, v: DuelVote): string {
  return `<li><b>${monogram(v.judge, v.judgeName)}${esc(v.judgeName)}</b>${v.winner ? ` picked ${esc(chefName(v.winner))}.` : ''} ${nameDishes(v.reason, v.order)}${provenance(ep, v)}</li>`;
}

export function pressureBlock(season: string, ep: Episode, root = ''): string {
  const p = ep.pressure;
  if (!p) return '';
  const base = `${root}${epPath(season, ep)}`;
  const how =
    p.decidedBy === 'votes' ? 'The judges voted.'
    : p.decidedBy === 'forfeit' ? 'The other chef failed to serve a dish.'
    : 'The judges could not separate them, so the main-round score decided it.';
  const dishes = p.chefs
    .map((id) => (p.forfeits[id] ? `${esc(chefName(id))} (no dish)` : `<a href="${base}/play-pressure-${id}.html">${esc(chefName(id))}</a>`))
    .join(' vs ');
  const votes = p.votes
    .map((v) => voteItem(ep, v))
    .join('');
  return `<div class="pressure" id="${epAnchor(season, ep)}-pressure"><h3>Pressure test</h3>
<p>${dishes}</p>
<p><b>The spec:</b> ${esc(p.spec)}</p>
<p><b>${esc(chefName(p.eliminated))} went home.</b> ${how}</p>
${votes ? `<ul>${votes}</ul>` : ''}</div>`;
}

/** What the chefs were actually told: the episode's challenge, then the standing house rules. */
export function briefBlock(ep: Episode): string {
  // Episodes recorded before the brief was stored are rebuilt from their type and theme.
  const brief =
    ep.brief ?? challengeText({ type: ep.type, theme: ep.theme, ingredient: ep.ingredient?.text ?? null, guest: ep.guestJudge ?? null });
  return `<details class="brief"${evAttrs('brief_open', { episode: ep.number })}><summary>The brief the chefs were given</summary><p>${esc(brief).replace(/\n+/g, '</p><p>')}</p><pre>${esc(RULES)}</pre><p>Each chef also sees its own record, the judges' notes on its last dish, the standings, and what won the previous episode.</p></details>`;
}

/** Finale notes from the record: the guest sat out for lack of credit, or its single score was kept. */
export function guestNotes(ep: Episode): string {
  const notes: string[] = [];
  if (ep.guestSkipped) notes.push(`The guest judge did not take part. ${ep.guestSkipped}`);
  if (ep.guestRuleSkipped) {
    const guestId = GUEST_JUDGE?.id ?? 'guest';
    const scored = ep.entries.find((e) => e.judges.some((j) => j.judge === guestId));
    if (scored) notes.push(guestKeptNote(chefName(scored.contestant)));
  }
  return notes.map((n) => `<p class="sub note">${esc(n)}</p>`).join('');
}

/** One episode: heading, date, recap, the winner featured, the brief, the rest of the field, the pressure test. */
export function episodeBlock(season: string, ep: Episode, root = ''): string {
  const theme = ep.theme ? ` &ldquo;${esc(ep.theme)}&rdquo;` : '';
  const by = ep.themeChosenBy
    ? ` Theme chosen by ${esc(chefName(ep.themeChosenBy))}.`
    : ep.guestJudge && ep.theme
      ? ` Brief set by ${esc(ep.guestJudge)}.`
      : ep.guestJudge
        ? ` With ${esc(ep.guestJudge)}.`
        : '';
  const twist = ep.ingredient ? `<p class="sub"><b>Secret ingredient:</b> ${esc(ep.ingredient.text)}</p>` : '';
  const title = isPilot(season) ? 'Pilot' : `Episode ${ep.number}`;
  const winner = ep.entries.find((e) => e.contestant === ep.winner);
  const rest = ep.entries.filter((e) => e.contestant !== ep.winner);
  return `<h2 id="${esc(epAnchor(season, ep))}">${title}: ${TYPE_LABEL[ep.type]}${theme}</h2>
<p class="sub">${esc(fmtDate(ep.date))}.${by} ${ep.entries.length} dishes, judged blind.</p>${twist}${guestNotes(ep)}
<p class="recap">${recapHtml(season, ep)}</p>
${winner ? featuredCard(season, ep, winner, root) : ''}
${briefBlock(ep)}
<div class="grid">${rest.map((e) => card(season, ep, e, root)).join('')}</div>
${pressureBlock(season, ep, root)}`;
}

// ---------------------------------------------------------------------------
// The dish page: a bar over the sandboxed iframe, and a Verdict panel.

export interface DishLink {
  href: string;
  label: string;
}

/** The bar and Verdict panel for a dish page. The page shell and the iframe live in build-site.ts. */
export function dishChrome(
  season: string,
  ep: Episode,
  opts: { entry?: Entry; pressureChef?: string; prev?: DishLink; next?: DishLink; other?: DishLink },
): { bar: string; panel: string } {
  const back = `<a class="back" href="index.html"${evAttrs('episode_nav', { to: 'episode', from: 'dish', episode: ep.number })}>&larr;<span class="wl"> Episode ${ep.number}</span></a>`;
  const who = opts.entry?.contestant ?? opts.pressureChef ?? '';
  // The Verdict script sends verdict_open itself, only when the panel opens (not on close).
  const verdict = `<button type="button" class="vbtn" aria-expanded="false" aria-controls="verdict" data-ev-props="${esc(JSON.stringify({ season, episode: ep.number, chef: who, pressure: !opts.entry }))}">Verdict</button>`;
  const footer = `<p class="fine">Unedited model output. The dish runs sandboxed with the network blocked.</p>
<p><a href="../../../index.html">What is ModelChef? &rarr;</a></p>`;

  if (opts.entry) {
    const e = opts.entry;
    const nav = [
      opts.prev ? `<a href="${opts.prev.href}"${evAttrs('dish_nav', { dir: 'prev', episode: ep.number, from: who })} aria-label="Previous dish: ${esc(opts.prev.label)}">&lsaquo; Prev</a>` : '',
      opts.next ? `<a href="${opts.next.href}"${evAttrs('dish_nav', { dir: 'next', episode: ep.number, from: who })} aria-label="Next dish: ${esc(opts.next.label)}">Next &rsaquo;</a>` : '',
    ].join('');
    const bar = `<header class="bar">${back}<b class="t">${esc(e.title)}</b><span class="r2"><span class="m">by ${esc(chefName(e.contestant))} · #${e.rank} · ${episodeFmt(ep)(e.total)}/10</span><span class="pn">${nav}</span></span>${verdict}</header>`;
    const panel = `${e.contestant === ep.winner ? guestNotes(ep) : ''}${e.pitch ? `<p class="pitch">${esc(e.pitch)}</p>` : ''}
${e.judges.length ? notesBlock(ep, e, true) : '<p>Not judged.</p>'}
${mechLine(e.mech, ep)}
${footer}`;
    return { bar, panel };
  }

  const id = opts.pressureChef!;
  const p = ep.pressure!;
  const chef = chefName(id);
  const picks = p.votes.filter((v) => v.winner === id).length;
  const nav = opts.other ? `<a href="${opts.other.href}"${evAttrs('dish_nav', { dir: 'other', episode: ep.number, from: who })}>Other dish: ${esc(opts.other.label)} &rsaquo;</a>` : '';
  const bar = `<header class="bar">${back}<b class="t">Pressure test</b><span class="r2"><span class="m">by ${esc(chef)}</span><span class="pn">${nav}</span></span>${verdict}</header>`;
  const votes = p.votes
    .map((v) => voteItem(ep, v))
    .join('');
  const panel = `<p><b>The spec:</b> ${esc(p.spec)}</p>
<p>Picked by ${picks} of ${p.votes.length} judge${p.votes.length === 1 ? '' : 's'}.</p>
${votes ? `<ul class="votes">${votes}</ul>` : ''}
<p><b>${esc(chef)} ${p.eliminated === id ? 'went home' : 'survived the pressure test'}.</b></p>
${footer}`;
  return { bar, panel };
}

// ---------------------------------------------------------------------------
// The episode feed (Atom) and the next-episode line.

/** The first Saturday strictly after an ISO date (YYYY-MM-DD), in UTC. */
export function nextSaturday(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + (((6 - d.getUTCDay() + 7) % 7) || 7));
  return d.toISOString().slice(0, 10);
}

/** "Episodes air Saturdays; next expected November 21." or '' once that date has passed or the season is over. */
export function nextEpisodeLine(latestDate: string | undefined, seasonOver: boolean, today: string): string {
  if (!latestDate || seasonOver) return '';
  const next = nextSaturday(latestDate);
  if (next < today) return '';
  const label = new Date(`${next}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' });
  return `Episodes air Saturdays; next expected ${label}.`;
}

/** Text safe for XML: control characters XML 1.0 forbids are dropped, then the five specials escaped. */
export const xmlText = (s: unknown) =>
  esc(String(s ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')).replace(/&#39;/g, '&apos;');

export interface FeedItem {
  season: string;
  ep: Episode;
}

/** A complete Atom 1.0 feed, newest episode first. `siteUrl` is absolute, without a trailing slash. */
export function atomFeed(siteUrl: string, items: FeedItem[], now: Date): string {
  const multi = new Set(items.map((i) => i.season)).size > 1;
  const sorted = [...items].sort((a, b) => b.ep.date.localeCompare(a.ep.date) || b.season.localeCompare(a.season) || b.ep.number - a.ep.number);
  const stamp = (date: string) => `${date}T17:23:00Z`;
  const updated = sorted[0] ? stamp(sorted[0].ep.date) : now.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const entries = sorted
    .map(({ season, ep }) => {
      const url = `${siteUrl}/${epPath(season, ep)}/`;
      const title = `${multi ? `${seasonLabel(season)}, ` : ''}Episode ${ep.number}: ${TYPE_LABEL[ep.type]}${ep.theme ? ` "${ep.theme}"` : ''}`;
      return `  <entry>
    <title>${xmlText(title)}</title>
    <link href="${xmlText(url)}"/>
    <id>${xmlText(url)}</id>
    <updated>${stamp(ep.date)}</updated>
    <summary>${xmlText(recapText(season, ep))}</summary>
  </entry>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>ModelChef</title>
  <subtitle>A weekly cooking competition for language models.</subtitle>
  <id>${xmlText(siteUrl)}/</id>
  <link href="${xmlText(siteUrl)}/"/>
  <link rel="self" href="${xmlText(siteUrl)}/feed.xml"/>
  <updated>${updated}</updated>
  <author><name>ModelChef</name></author>
${entries}
</feed>
`;
}

// ---------------------------------------------------------------------------
// Search engines: sitemap.xml and robots.txt (absolute URLs, so only when the site URL is known).

export interface SitemapUrl {
  /** Site path with a leading slash, e.g. "/s/season-01/ep-01/". */
  path: string;
  /** YYYY-MM-DD */
  lastmod?: string;
}

/** A sitemaps.org 0.9 sitemap. `siteUrl` is absolute, without a trailing slash. */
export function sitemapXml(siteUrl: string, urls: SitemapUrl[]): string {
  const items = urls
    .map((u) => `  <url><loc>${xmlText(siteUrl + u.path)}</loc>${u.lastmod ? `<lastmod>${xmlText(u.lastmod)}</lastmod>` : ''}</url>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${items}
</urlset>
`;
}

/**
 * Crawl everything except the raw dishes: their sandboxed copies (apps/,
 * pressure/) are model output, shown on the dish pages. Names the sitemap
 * when there is one.
 */
export function robotsTxt(siteUrl: string): string {
  return `User-agent: *
Allow: /
Disallow: /s/*/apps/
Disallow: /s/*/pressure/
${siteUrl ? `\nSitemap: ${siteUrl}/sitemap.xml\n` : ''}`;
}
