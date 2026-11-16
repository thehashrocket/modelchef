// Pure renderers for the static site. No file system access and nothing runs at
// import time, so tests can import these directly. build-site.ts does the I/O.
//
// Every string that came out of a model goes through esc() before it reaches HTML.
import { CONTESTANTS, JUDGES } from './config';
import { challengeText, RULES } from './prompts';
import { SAME_FAMILY_REASON, type Abstention, type DuelVote, type Entry, type Episode, type JudgeScore, type MechReport } from './state';

export const esc = (s: unknown) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
export const chefName = (id: string) => CONTESTANTS.find((c) => c.id === id)?.name ?? id;
export const judgeName = (id: string) => JUDGES.find((j) => j.id === id)?.name ?? id;
export const pad = (n: number) => String(n).padStart(2, '0');
/** A folder named "pilot" is a trial run: shown on the site, never counted. */
export const isPilot = (season: string) => season === 'pilot';
export const seasonLabel = (season: string) => {
  if (isPilot(season)) return 'Pilot';
  const m = /^season-0*(\d+)$/.exec(season);
  return m ? `Season ${m[1]}` : season;
};
export const fmtDate = (iso: string) => {
  const d = new Date(`${iso}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
};
export const TYPE_LABEL = { 'mystery-box': 'Mystery Box', invention: 'Invention Test', finale: 'Finale' } as const;
/** Where an episode's files live, relative to the site root. */
export const epPath = (season: string, ep: Episode) => `s/${season}/ep-${pad(ep.number)}`;
export const epAnchor = (season: string, ep: Episode) => `${season}-ep-${pad(ep.number)}`;

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
  const win = ep.entries.find((e) => e.contestant === ep.winner);
  const winner = chefName(ep.winner);
  if (ep.type === 'finale') {
    const runnerUp = ep.entries.find((e) => e.contestant === ep.eliminated);
    if (!win || win.forfeit || !runnerUp) return `${winner} won.`;
    return `${winner} is the ${seasonLabel(season)} champion, beating ${chefName(runnerUp.contestant)} ${win.total.toFixed(1)} to ${runnerUp.total.toFixed(1)}.`;
  }
  const first = !win || win.forfeit ? `${winner} won.` : `${winner} won with "${win.title}" (${win.total.toFixed(1)}).`;
  const p = ep.pressure;
  if (!p) return first;
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
  return `${first} ${second}`;
}

/** The recap as HTML, with "pressure test" linking to the pressure block (always on the same page as the recap). */
export function recapHtml(season: string, ep: Episode): string {
  const text = esc(recapText(season, ep));
  if (!ep.pressure) return text;
  return text.replace('pressure test', `<a href="#${epAnchor(season, ep)}-pressure">pressure test</a>`);
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

export function mechLine(m: MechReport | null, _ep: Episode): string {
  if (!m) return '';
  return `<div class="mech">Machine check ${m.score}/10 · ${(m.bytes / 1024).toFixed(0)} KB · ${m.consoleErrors.length} console error${m.consoleErrors.length === 1 ? '' : 's'} · ${m.networkAttempts.length} network attempt${m.networkAttempts.length === 1 ? '' : 's'}${m.mobileOverflow ? ' · overflows on phone' : ''}${m.ingredient === 'missing' ? ' · secret ingredient missing' : ''}</div>`;
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

const scoreText = (e: Entry) => (e.forfeit ? '–' : e.total.toFixed(1));
const openLink = (season: string, ep: Episode, e: Entry, root: string) =>
  e.forfeit ? '' : `<a class="play" href="${root}${epPath(season, ep)}/play-${e.contestant}.html">Open the dish &rarr;</a>`;
const presentation = (e: Entry) =>
  e.presentation ? `<details class="says"><summary>What the chef told the judges</summary><p>${esc(e.presentation)}</p></details>` : '';

export function card(season: string, ep: Episode, e: Entry, root = ''): string {
  return `<article class="card">${plate(season, ep, e, root)}<div class="body">
<div class="row"><h3>${rankSpan(ep, e)} ${esc(e.title)}</h3><span class="score">${scoreText(e)}</span></div>
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
<div class="row"><h3>${rankSpan(ep, e)} ${esc(e.title)}</h3><span class="score">${scoreText(e)}</span></div>
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
