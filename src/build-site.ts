// Builds the static leaderboard into dist/. Every string that came out of a
// model is escaped, and every dish is published behind a network-blocking
// CSP inside a sandboxed iframe: this site serves JavaScript nobody reviewed.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONTESTANTS, DATA_DIR, JUDGES } from './config';
import { challengeText, RULES } from './prompts';
import { average, type Entry, type Episode, type SeasonState } from './state';

const OUT = 'dist';
const esc = (s: unknown) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const chefName = (id: string) => CONTESTANTS.find((c) => c.id === id)?.name ?? id;
const judgeName = (id: string) => JUDGES.find((j) => j.id === id)?.name ?? id;
const pad = (n: number) => String(n).padStart(2, '0');
/** A folder named "pilot" is a trial run: shown on the site, never counted. */
const isPilot = (season: string) => season === 'pilot';
const seasonLabel = (season: string) => {
  if (isPilot(season)) return 'Pilot';
  const m = /^season-0*(\d+)$/.exec(season);
  return m ? `Season ${m[1]}` : season;
};
const fmtDate = (iso: string) => {
  const d = new Date(`${iso}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
};
/** Judges see the pressure-test pair as "Dish A" and "Dish B"; readers should see who they mean. */
function nameDishes(reason: string, order?: [string, string]): string {
  if (!order) return esc(reason);
  const name = (l: string) => chefName(l === 'A' ? order[0] : order[1]);
  return esc(reason.replace(/\bDish ([AB])\b/g, (_, l: string) => name(l)).replace(/\b([AB])(['’]s)\b/g, (_, l: string, s: string) => name(l) + s));
}
const TYPE_LABEL = { 'mystery-box': 'Mystery Box', invention: 'Invention Test', finale: 'Finale' } as const;

const CSP =
  `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:; worker-src blob:; connect-src 'none'; form-action 'none'; base-uri 'none'">`;

/** Published copies of a dish cannot reach the network, whatever the code tries. */
function lockDown(html: string): string {
  const head = /<head[^>]*>/i.exec(html);
  if (head) return html.slice(0, head.index + head[0].length) + CSP + html.slice(head.index + head[0].length);
  return CSP + html;
}

const STYLE = `
:root{--bg:#faf7f2;--card:#fff;--ink:#1d1a16;--muted:#6f675c;--line:#e4dccf;--accent:#c2410c;--good:#15803d;--bad:#b91c1c}
@media (prefers-color-scheme:dark){:root{--bg:#15130f;--card:#1f1c17;--ink:#f1ece3;--muted:#a59c8e;--line:#342f27;--accent:#fb923c;--good:#4ade80;--bad:#f87171}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif}
a{color:var(--accent)}
.wrap{max-width:1120px;margin:0 auto;padding:0 20px 80px}
header{padding:56px 0 28px;border-bottom:1px solid var(--line)}
h1{font:700 clamp(2.4rem,6vw,3.6rem)/1 Georgia,"Times New Roman",serif;margin:0;letter-spacing:-.02em}
h1 span{color:var(--accent)}
.tag{color:var(--muted);max-width:62ch;margin:14px 0 0}
.status{margin-top:18px;font-weight:600}
h2{font:700 1.6rem/1.2 Georgia,serif;margin:56px 0 6px}
h3{font:700 1.25rem/1.25 Georgia,serif;margin:0}
h3.pilot{font-size:1.4rem;margin:18px 0 6px}
.sub{color:var(--muted);margin:0 0 18px}
table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--line);border-radius:10px;overflow:hidden}
th,td{padding:10px 14px;text-align:left;border-bottom:1px solid var(--line)}
th{font-size:.75rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}
tr:last-child td{border-bottom:0}
td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
tr.out td{color:var(--muted)}
.scroll{overflow-x:auto}
@media (max-width:560px){th,td{padding:9px 10px}th:nth-child(n+4),td:nth-child(n+4){display:none}td:first-child{min-width:9.5em}}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(310px,1fr));gap:18px}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;overflow:hidden;display:flex;flex-direction:column}
.card img{width:100%;aspect-ratio:16/10;object-fit:cover;object-position:top;display:block;border-bottom:1px solid var(--line);background:var(--line)}
.noshot{aspect-ratio:16/10;display:grid;place-items:center;color:var(--muted);border-bottom:1px solid var(--line);padding:16px;text-align:center}
.body{padding:14px 16px 16px;display:flex;flex-direction:column;gap:8px;flex:1}
.row{display:flex;justify-content:space-between;align-items:baseline;gap:12px}
.score{font:700 1.5rem/1 Georgia,serif;font-variant-numeric:tabular-nums}
.by{color:var(--muted);font-size:.9rem}
.pitch{margin:0}
.says p{margin:8px 0 0;color:var(--muted);font-style:italic}
.jrow{display:flex;flex-wrap:wrap;gap:6px;font-size:.8rem;font-variant-numeric:tabular-nums}
.jrow span{background:var(--bg);border:1px solid var(--line);border-radius:6px;padding:1px 7px;color:var(--muted)}
.jrow b{color:var(--ink);font-weight:600}
.panel{color:var(--muted);font-size:.92rem;margin:10px 0 0;max-width:72ch}
.panel b{color:var(--ink)}
.latest{font-weight:600}
.badges{display:flex;flex-wrap:wrap;gap:6px}
.badge{font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.05em;padding:2px 8px;border-radius:99px;border:1px solid var(--line);color:var(--muted)}
.badge.win{color:var(--good);border-color:currentColor}
.badge.gone{color:var(--bad);border-color:currentColor}
.mech{font-size:.82rem;color:var(--muted)}
details{font-size:.92rem}
summary{cursor:pointer;color:var(--accent);font-weight:600;padding:2px 0}
summary:focus-visible,a:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:3px}
blockquote{margin:10px 0 0;padding-left:12px;border-left:3px solid var(--line)}
blockquote b{display:block}
blockquote small{color:var(--muted)}
.play{margin-top:auto;font-weight:700}
.brief{margin:0 0 18px;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 16px}
.brief p{margin:10px 0 0}
.brief pre{margin:10px 0 0;white-space:pre-wrap;font:inherit;font-size:.9rem;color:var(--muted)}
.pressure{margin-top:18px;background:var(--card);border:1px solid var(--line);border-left:4px solid var(--accent);border-radius:10px;padding:16px 18px}
.pressure p{margin:6px 0}
.pressure ul{margin:8px 0 0;padding-left:20px}
footer{margin-top:64px;padding-top:20px;border-top:1px solid var(--line);color:var(--muted);font-size:.9rem}
footer p{margin:0 0 8px}
.maker a{font-weight:600}
`;

function page(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="A weekly cooking competition for language models, where the dishes are single-file web apps and the judges are models too.">
<style>${STYLE}</style>
</head>
<body><div class="wrap">${body}</div></body>
</html>
`;
}

function playPage(title: string, chef: string, src: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · ModelChef</title>
<style>
html,body{height:100%;margin:0}
body{display:flex;flex-direction:column;font:15px system-ui,sans-serif;background:#15130f;color:#f1ece3}
nav{display:flex;gap:14px;align-items:center;padding:8px 14px;border-bottom:1px solid #342f27;white-space:nowrap;overflow:hidden}
nav a{color:#fb923c;font-weight:700;text-decoration:none}
nav span{overflow:hidden;text-overflow:ellipsis;color:#a59c8e}
iframe{flex:1;border:0;width:100%;background:#fff}
</style>
</head>
<body>
<nav><a href="../../../index.html">&larr; ModelChef</a><b>${esc(title)}</b><span>by ${esc(chef)} · unedited model output</span></nav>
<iframe src="${esc(src)}" sandbox="allow-scripts allow-forms allow-modals allow-downloads allow-pointer-lock" title="${esc(title)}"></iframe>
</body>
</html>
`;
}

function card(season: string, ep: Episode, e: Entry): string {
  const base = `s/${season}/ep-${pad(ep.number)}`;
  const badges: string[] = [];
  if (e.contestant === ep.winner) badges.push(`<span class="badge win">${ep.type === 'finale' ? 'Champion' : 'Winner'}</span>`);
  if (e.contestant === ep.immune) badges.push('<span class="badge">Immune</span>');
  if (ep.pressure?.chefs.includes(e.contestant)) badges.push('<span class="badge">Pressure test</span>');
  if (e.contestant === ep.eliminated) badges.push('<span class="badge gone">Eliminated</span>');
  if (e.forfeit) badges.push('<span class="badge gone">Forfeit</span>');

  const shot = e.forfeit
    ? `<div class="noshot">No dish served.<br>${esc(e.forfeit)}</div>`
    : `<a href="${base}/play-${e.contestant}.html"><img loading="lazy" src="${base}/shots/${e.contestant}-desktop.jpg" alt="Screenshot of ${esc(e.title)}"></a>`;

  const m = e.mech;
  const mech = m
    ? `<div class="mech">Machine check ${m.score}/10 · ${(m.bytes / 1024).toFixed(0)} KB · ${m.consoleErrors.length} console error${m.consoleErrors.length === 1 ? '' : 's'} · ${m.networkAttempts.length} network attempt${m.networkAttempts.length === 1 ? '' : 's'}${m.mobileOverflow ? ' · overflows on phone' : ''}${m.ingredient === 'missing' ? ' · secret ingredient missing' : ''}</div>`
    : '';

  const short = (name: string) => name.replace(/^The /, '');
  const jrow = e.judges.length
    ? `<div class="jrow" aria-label="Judge scores">${e.judges.map((j) => `<span>${esc(short(j.judgeName))} <b>${j.weighted.toFixed(1)}</b></span>`).join('')}</div>`
    : '';
  const notes = e.judges.length
    ? `<details><summary>Judges' notes</summary>${e.judges
        .map(
          (j) =>
            `<blockquote><b>${esc(j.judgeName)} · ${j.weighted.toFixed(1)}</b>${esc(j.critique)}<br><small>Use ${j.scores.usefulness} · Craft ${j.scores.craft} · Originality ${j.scores.originality} · Theme ${j.scores.theme}</small></blockquote>`,
        )
        .join('')}${e.abstained.map((a) => `<blockquote><b>${esc(judgeName(a.judge))} abstained</b><small>${esc(a.reason)}</small></blockquote>`).join('')}</details>`
    : '';

  return `<article class="card">${shot}<div class="body">
<div class="row"><h3>${e.rank}. ${esc(e.title)}</h3><span class="score">${e.forfeit ? '–' : e.total.toFixed(1)}</span></div>
<div class="by">${esc(chefName(e.contestant))}</div>
<div class="badges">${badges.join('')}</div>
${e.forfeit ? '' : `<p class="pitch">${esc(e.pitch)}</p>`}
${e.presentation ? `<details class="says"><summary>What the chef told the judges</summary><p>${esc(e.presentation)}</p></details>` : ''}
${jrow}${mech}${notes}
${e.forfeit ? '' : `<a class="play" href="${base}/play-${e.contestant}.html">Open the dish &rarr;</a>`}
</div></article>`;
}

function pressureBlock(season: string, ep: Episode): string {
  const p = ep.pressure;
  if (!p) return '';
  const base = `s/${season}/ep-${pad(ep.number)}`;
  const how =
    p.decidedBy === 'votes' ? 'The judges voted.'
    : p.decidedBy === 'forfeit' ? 'The other chef failed to serve a dish.'
    : 'The judges could not separate them, so the main-round score decided it.';
  const dishes = p.chefs
    .map((id) => (p.forfeits[id] ? `${esc(chefName(id))} (no dish)` : `<a href="${base}/play-pressure-${id}.html">${esc(chefName(id))}</a>`))
    .join(' vs ');
  const votes = p.votes
    .map((v) => `<li><b>${esc(v.judgeName)}</b>${v.winner ? ` picked ${esc(chefName(v.winner))}.` : ''} ${nameDishes(v.reason, v.order)}</li>`)
    .join('');
  return `<div class="pressure"><h3>Pressure test</h3>
<p>${dishes}</p>
<p><b>The spec:</b> ${esc(p.spec)}</p>
<p><b>${esc(chefName(p.eliminated))} went home.</b> ${how}</p>
${votes ? `<ul>${votes}</ul>` : ''}</div>`;
}

/** What the chefs were actually told: the episode's challenge, then the standing house rules. */
function briefBlock(ep: Episode): string {
  // Episodes recorded before the brief was stored are rebuilt from their type and theme.
  const brief =
    ep.brief ?? challengeText({ type: ep.type, theme: ep.theme, ingredient: ep.ingredient?.text ?? null, guest: ep.guestJudge ?? null });
  return `<details class="brief"><summary>The brief the chefs were given</summary><p>${esc(brief).replace(/\n+/g, '</p><p>')}</p><pre>${esc(RULES)}</pre><p>Each chef also sees its own record, the judges' notes on its last dish, the standings, and what won the previous episode.</p></details>`;
}

function seasonSection(season: string, state: SeasonState, episodes: Episode[]): string {
  const left = Object.values(state.contestants).filter((c) => c.status === 'active').length;
  const rows = Object.entries(state.contestants)
    .map(([id, c]) => ({ id, c, avg: average(c.history), wins: c.history.filter((h) => h.outcome === 'won').length }))
    .sort((a, b) => {
      const order = (x: typeof a) => (x.c.status === 'champion' ? 1e6 : x.c.status === 'active' ? 1e5 : (x.c.eliminatedIn ?? 0));
      return order(b) - order(a) || b.avg - a.avg;
    })
    .map(({ id, c, avg, wins }) => {
      const status =
        c.status === 'champion' ? 'Champion'
        : c.status === 'active' ? (state.immune === id && left > 3 ? 'In (immune)' : 'In')
        : `Out in episode ${c.eliminatedIn}`;
      return `<tr class="${c.status === 'eliminated' ? 'out' : ''}"><td>${esc(chefName(id))}</td><td>${status}</td><td class="num">${c.history.length ? avg.toFixed(2) : '–'}</td><td class="num">${wins}</td><td class="num">${c.history.length}</td></tr>`;
    })
    .join('');

  const eps = [...episodes]
    .reverse()
    .map((ep) => {
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
      return `<h2 id="${esc(season)}-ep-${pad(ep.number)}">${title}: ${TYPE_LABEL[ep.type]}${theme}</h2>
<p class="sub">${esc(fmtDate(ep.date))}.${by} ${ep.entries.length} dishes, judged blind.</p>${twist}
${briefBlock(ep)}
<div class="grid">${ep.entries.map((e) => card(season, ep, e)).join('')}</div>
${pressureBlock(season, ep)}`;
    })
    .join('');

  // A pilot has no standings: its scores never counted toward anything.
  if (isPilot(season)) {
    return `<h2>The pilot</h2>
<p class="sub">A trial run before season 1, kept for the record. It did not count: no standings, no immunity, and the chef it sent home was back for the real season.</p>
${eps.replace('<h2>', '<h3 class="pilot">').replace('</h2>', '</h3>')}`;
  }

  return `<h2>Standings, ${esc(seasonLabel(season))}</h2>
<p class="sub">Season average of each chef's episode scores, out of 10.</p>
<div class="scroll"><table><thead><tr><th>Chef</th><th>Status</th><th class="num">Average</th><th class="num">Wins</th><th class="num">Dishes</th></tr></thead><tbody>${rows}</tbody></table></div>
${eps}`;
}

function publishEpisode(season: string, ep: Episode) {
  const src = join(DATA_DIR, season, `ep-${pad(ep.number)}`);
  const out = join(OUT, 's', season, `ep-${pad(ep.number)}`);
  mkdirSync(join(out, 'apps'), { recursive: true });
  mkdirSync(join(out, 'pressure'), { recursive: true });
  if (existsSync(join(src, 'shots'))) cpSync(join(src, 'shots'), join(out, 'shots'), { recursive: true });

  for (const e of ep.entries) {
    if (e.forfeit) continue;
    writeFileSync(join(out, 'apps', `${e.contestant}.html`), lockDown(readFileSync(join(src, 'apps', `${e.contestant}.html`), 'utf8')));
    writeFileSync(join(out, `play-${e.contestant}.html`), playPage(e.title, chefName(e.contestant), `apps/${e.contestant}.html`));
  }
  for (const id of ep.pressure?.chefs ?? []) {
    if (ep.pressure!.forfeits[id]) continue;
    writeFileSync(join(out, 'pressure', `${id}.html`), lockDown(readFileSync(join(src, 'pressure', `${id}.html`), 'utf8')));
    writeFileSync(join(out, `play-pressure-${id}.html`), playPage('Pressure test', chefName(id), `pressure/${id}.html`));
  }
}

function main() {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  const seasons = existsSync(DATA_DIR)
    ? readdirSync(DATA_DIR)
        .filter((s) => existsSync(join(DATA_DIR, s, 'state.json')))
        // Newest season first, the pilot always last.
        .sort((a, b) => Number(isPilot(a)) - Number(isPilot(b)) || b.localeCompare(a))
    : [];

  let status = 'The first episode has not aired yet.';
  let latest = '';
  const sections: string[] = [];
  for (const [i, season] of seasons.entries()) {
    const state = JSON.parse(readFileSync(join(DATA_DIR, season, 'state.json'), 'utf8')) as SeasonState;
    const episodes = state.episodes.map(
      (e) => JSON.parse(readFileSync(join(DATA_DIR, season, `ep-${pad(e.number)}`, 'episode.json'), 'utf8')) as Episode,
    );
    episodes.forEach((ep) => publishEpisode(season, ep));
    sections.push(seasonSection(season, state, episodes));
    if (i === 0 && !isPilot(season)) {
      const left = Object.values(state.contestants).filter((c) => c.status === 'active').length;
      status = state.champion
        ? `${chefName(state.champion)} won ${seasonLabel(season)}.`
        : `${seasonLabel(season)}, ${state.episodes.length} episode${state.episodes.length === 1 ? '' : 's'} in. ${left} chefs remain.`;
      const last = state.episodes.at(-1);
      if (last) latest = ` <a class="latest" href="#${esc(season)}-ep-${pad(last.number)}">Watch episode ${last.number} &darr;</a>`;
    }
  }

  const repo = process.env.GITHUB_REPOSITORY;
  const body = `<header>
<h1>Model<span>Chef</span></h1>
<p class="tag">A weekly cooking competition for language models. Every chef gets the same brief and one shot at a single-file web app. Three model judges score the dishes blind, the bottom two face a pressure test, and one chef goes home. Nothing is edited by a human.</p>
<p class="status">${esc(status)}${latest}</p>
<p class="panel"><b>The panel:</b> ${JUDGES.map((j) => `${esc(j.name)} (${j.lens === 'overall' ? 'the whole plate' : esc(j.lens)})`).join(', ')}. Each judge's own specialty counts double in their score, and the machine check covers the house rules.</p>
</header>
${sections.join('')}
<footer><p>Dishes run in a sandbox with the network blocked, so apps that expect browser storage keep their state in memory. A judge from the same lab as a chef sits that dish out.${repo ? ` Source, prompts and every score: <a href="https://github.com/${esc(repo)}">github.com/${esc(repo)}</a>.` : ''}</p>
<p class="maker">ModelChef is a side project by <a href="https://jasonshultz.com">Jason Shultz</a>, a human who builds web apps for clients. No judges were harmed.</p></footer>`;

  writeFileSync(join(OUT, 'index.html'), page('ModelChef', body));
  writeFileSync(join(OUT, '.nojekyll'), '');
  console.log(`[modelchef] built ${OUT}/ (${seasons.length} season${seasons.length === 1 ? '' : 's'})`);
}

main();
