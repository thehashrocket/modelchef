// Pure renderers for the static site. No file system access and nothing runs at
// import time, so tests can import these directly. build-site.ts does the I/O.
//
// Every string that came out of a model goes through esc() before it reaches HTML.
import { CONTESTANTS, JUDGES, SCORING } from './config';
import { challengeText, RULES } from './prompts';
import { isPilot, SAME_FAMILY_REASON, seasonLabel, TYPE_LABEL, type Abstention, type DuelVote, type Entry, type Episode, type JudgeScore, type MechReport } from './state';

export const esc = (s: unknown) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
export const chefName = (id: string) => CONTESTANTS.find((c) => c.id === id)?.name ?? id;
export const judgeName = (id: string) => JUDGES.find((j) => j.id === id)?.name ?? id;
export const pad = (n: number) => String(n).padStart(2, '0');
export { isPilot, seasonLabel, TYPE_LABEL };
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

const shortName = (name: string) => name.replace(/^The /, '');

export function judgeChips(_ep: Episode, e: Entry): string {
  if (!e.judges.length) return '';
  return `<div class="jrow" aria-label="Judge scores">${e.judges.map((j) => `<span>${esc(shortName(j.judgeName))} <b>${j.weighted.toFixed(1)}</b></span>`).join('')}</div>`;
}

/** The judges' critiques. `open` renders them bare instead of inside a closed disclosure. */
export function notesBlock(ep: Episode, e: Entry, open: boolean): string {
  if (!e.judges.length) return '';
  const quotes =
    e.judges
      .map(
        (j) =>
          `<blockquote><b>${esc(j.judgeName)} · ${j.weighted.toFixed(1)}</b>${esc(j.critique)}<br><small>Use ${j.scores.usefulness} · Craft ${j.scores.craft} · Originality ${j.scores.originality} · Theme ${j.scores.theme}</small>${provenance(ep, j)}</blockquote>`,
      )
      .join('') +
    e.abstained.map((a) => `<blockquote><b>${esc(a.judgeName ?? judgeName(a.judge))} abstained</b><small>${esc(a.reason)}</small>${provenance(ep, a)}</blockquote>`).join('');
  return open ? `<div class="notes"><h4>Judges' notes</h4>${quotes}</div>` : `<details><summary>Judges' notes</summary>${quotes}</details>`;
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
  return e.forfeit
    ? `<div class="noshot">No dish served.<br>${esc(e.forfeit)}</div>`
    : `<a class="shot" href="${base}/play-${e.contestant}.html"><img loading="lazy" src="${base}/shots/${e.contestant}-desktop.jpg" alt="Screenshot of ${esc(e.title)}" width="1280" height="800"></a>`;
}

const scoreText = (ep: Episode, e: Entry) =>
  e.forfeit ? '–' : `<span title="${esc(SCORE_EXPLAINED)}">${episodeFmt(ep)(e.total)}</span><span class="outof">/10</span>`;
const openLink = (season: string, ep: Episode, e: Entry, root: string) =>
  e.forfeit ? '' : `<a class="play" href="${root}${epPath(season, ep)}/play-${e.contestant}.html">Open the dish &rarr;</a>`;
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
    .map((v) => `<li><b>${esc(v.judgeName)}</b>${v.winner ? ` picked ${esc(chefName(v.winner))}.` : ''} ${nameDishes(v.reason, v.order)}${provenance(ep, v)}</li>`)
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
  return `<details class="brief"><summary>The brief the chefs were given</summary><p>${esc(brief).replace(/\n+/g, '</p><p>')}</p><pre>${esc(RULES)}</pre><p>Each chef also sees its own record, the judges' notes on its last dish, the standings, and what won the previous episode.</p></details>`;
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
<p class="sub">${esc(fmtDate(ep.date))}.${by} ${ep.entries.length} dishes, judged blind.</p>${twist}
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
  const back = `<a class="back" href="index.html">&larr;<span class="wl"> Episode ${ep.number}</span></a>`;
  const verdict = `<button type="button" class="vbtn" aria-expanded="false" aria-controls="verdict">Verdict</button>`;
  const footer = `<p class="fine">Unedited model output. The dish runs sandboxed with the network blocked.</p>
<p><a href="../../../index.html">What is ModelChef? &rarr;</a></p>`;

  if (opts.entry) {
    const e = opts.entry;
    const nav = [
      opts.prev ? `<a href="${opts.prev.href}" aria-label="Previous dish: ${esc(opts.prev.label)}">&lsaquo; Prev</a>` : '',
      opts.next ? `<a href="${opts.next.href}" aria-label="Next dish: ${esc(opts.next.label)}">Next &rsaquo;</a>` : '',
    ].join('');
    const bar = `<header class="bar">${back}<b class="t">${esc(e.title)}</b><span class="r2"><span class="m">by ${esc(chefName(e.contestant))} · #${e.rank} · ${episodeFmt(ep)(e.total)}/10</span><span class="pn">${nav}</span></span>${verdict}</header>`;
    const panel = `${e.pitch ? `<p class="pitch">${esc(e.pitch)}</p>` : ''}
${e.judges.length ? notesBlock(ep, e, true) : '<p>Not judged.</p>'}
${mechLine(e.mech, ep)}
${footer}`;
    return { bar, panel };
  }

  const id = opts.pressureChef!;
  const p = ep.pressure!;
  const chef = chefName(id);
  const picks = p.votes.filter((v) => v.winner === id).length;
  const nav = opts.other ? `<a href="${opts.other.href}">Other dish: ${esc(opts.other.label)} &rsaquo;</a>` : '';
  const bar = `<header class="bar">${back}<b class="t">Pressure test</b><span class="r2"><span class="m">by ${esc(chef)}</span><span class="pn">${nav}</span></span>${verdict}</header>`;
  const votes = p.votes
    .map((v) => `<li><b>${esc(v.judgeName)}</b>${v.winner ? ` picked ${esc(chefName(v.winner))}.` : ''} ${nameDishes(v.reason, v.order)}${provenance(ep, v)}</li>`)
    .join('');
  const panel = `<p><b>The spec:</b> ${esc(p.spec)}</p>
<p>Picked by ${picks} of ${p.votes.length} judge${p.votes.length === 1 ? '' : 's'}.</p>
${votes ? `<ul class="votes">${votes}</ul>` : ''}
<p><b>${esc(chef)} ${p.eliminated === id ? 'went home' : 'survived the pressure test'}.</b></p>
${footer}`;
  return { bar, panel };
}
