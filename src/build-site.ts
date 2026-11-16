// Builds the static leaderboard into dist/. Every string that came out of a
// model is escaped, and every dish is published behind a network-blocking
// CSP inside a sandboxed iframe: this site serves JavaScript nobody reviewed.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR, JUDGES } from './config';
import { chefName, episodeBlock, esc, fmtScores, isPilot, pad, recapHtml, SCORE_EXPLAINED, seasonLabel } from './site-lib';
import { average, type Episode, type SeasonState } from './state';

const OUT = 'dist';

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
@media (max-width:400px){td:first-child{min-width:0}}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(310px,100%),1fr));gap:18px}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;overflow:hidden;display:flex;flex-direction:column}
.card img{width:100%;height:auto;aspect-ratio:16/10;object-fit:cover;object-position:top;display:block;border-bottom:1px solid var(--line);background:var(--line)}
.noshot{aspect-ratio:16/10;display:grid;place-items:center;color:var(--muted);border-bottom:1px solid var(--line);padding:16px;text-align:center}
.body{padding:14px 16px 16px;display:flex;flex-direction:column;gap:8px;flex:1}
.row{display:flex;justify-content:space-between;align-items:baseline;gap:12px}
.score{font:700 1.5rem/1 Georgia,serif;font-variant-numeric:tabular-nums;white-space:nowrap}
.outof{font:600 .8rem system-ui;color:var(--muted);margin-left:2px}

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
.badge{white-space:nowrap;font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.05em;padding:2px 8px;border-radius:99px;border:1px solid var(--line);color:var(--muted)}
.badge.win{color:var(--good);border-color:currentColor}
.badge.gone{color:var(--bad);border-color:currentColor}
.mech{font-size:.82rem;color:var(--muted)}
.mech .tick{color:var(--good);font-weight:700}
.mech.bad{color:var(--ink)}
.mech.bad .problems{color:var(--bad)}
.sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
details{font-size:.92rem}
summary{cursor:pointer;color:var(--accent);font-weight:600;padding:11px 0}
a:focus-visible,summary:focus-visible,button:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:3px}
blockquote{margin:10px 0 0;padding-left:12px;border-left:3px solid var(--line)}
blockquote b{display:block}
blockquote small{color:var(--muted)}
.prov{display:block;color:var(--muted);font-size:.78rem}
.play{margin-top:auto;font-weight:700}
.recap{font-size:1.05rem;color:var(--ink);max-width:70ch;margin:0 0 18px;overflow-wrap:anywhere}
.status .recap-line{font-weight:400;overflow-wrap:anywhere}
h3{overflow-wrap:anywhere}
.feature{background:var(--card);border:1px solid var(--line);border-radius:10px;overflow:hidden;display:grid;grid-template-columns:1fr;margin-bottom:18px}
.feature h3{font-size:1.6rem}
.feature .shot{align-self:start}
.feature img{width:100%;height:auto;aspect-ratio:16/10;object-fit:cover;object-position:top;display:block;background:var(--line)}
.notes h4{margin:6px 0 0;font-size:.92rem;color:var(--muted)}
.wide-only{display:none}
@media (min-width:760px){.feature{grid-template-columns:11fr 9fr}.feature .shot{border-right:1px solid var(--line)}.wide-only{display:block}.narrow-only{display:none}}
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

function seasonSection(season: string, state: SeasonState, episodes: Episode[]): string {
  const left = Object.values(state.contestants).filter((c) => c.status === 'active').length;
  const ranked = Object.entries(state.contestants).map(([id, c]) => ({ id, c, avg: average(c.history), wins: c.history.filter((h) => h.outcome === 'won').length }));
  const fmt = fmtScores(ranked.filter((r) => r.c.history.length).map((r) => r.avg));
  const rows = ranked
    .sort((a, b) => {
      const order = (x: typeof a) => (x.c.status === 'champion' ? 1e6 : x.c.status === 'active' ? 1e5 : (x.c.eliminatedIn ?? 0));
      return order(b) - order(a) || b.avg - a.avg;
    })
    .map(({ id, c, avg, wins }) => {
      const status =
        c.status === 'champion' ? '<span class="badge win">Champion</span>'
        : c.status === 'active' ? (state.immune === id && left > 3 ? 'In <span class="badge">Immune</span>' : 'In')
        : `<span class="badge gone">Out · Ep ${c.eliminatedIn}</span>`;
      return `<tr class="${c.status === 'eliminated' ? 'out' : ''}"><td>${esc(chefName(id))}</td><td class="status-cell">${status}</td><td class="num">${c.history.length ? fmt(avg) : '–'}</td><td class="num">${wins}</td><td class="num">${c.history.length}</td></tr>`;
    })
    .join('');

  const eps = [...episodes].reverse().map((ep) => episodeBlock(season, ep)).join('');

  // A pilot has no standings: its scores never counted toward anything.
  if (isPilot(season)) {
    return `<h2>The pilot</h2>
<p class="sub">A trial run before season 1, kept for the record. It did not count: no standings, no immunity, and the chef it sent home was back for the real season.</p>
${eps.replace('<h2>', '<h3 class="pilot">').replace('</h2>', '</h3>')}`;
  }

  return `<h2>Standings, ${esc(seasonLabel(season))}</h2>
<p class="sub">Season average of each chef's episode scores. ${esc(SCORE_EXPLAINED)}</p>
<div class="scroll"><table><thead><tr><th>Chef</th><th>Status</th><th class="num">Average /10</th><th class="num">Wins</th><th class="num">Dishes</th></tr></thead><tbody>${rows}</tbody></table></div>
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
  let recap = '';
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
      const lastEp = episodes.at(-1);
      if (lastEp) recap = ` <span class="recap-line">${recapHtml(season, lastEp)}</span>`;
    }
  }

  const repo = process.env.GITHUB_REPOSITORY;
  const body = `<header>
<h1>Model<span>Chef</span></h1>
<p class="tag">A weekly cooking competition for language models. Every chef gets the same brief and one shot at a single-file web app. Three model judges score the dishes blind, the bottom two face a pressure test, and one chef goes home. Nothing is edited by a human.</p>
<p class="status">${esc(status)}${recap}${latest}</p>
<p class="panel"><b>The panel:</b> ${JUDGES.map((j) => `${esc(j.name)} (${j.lens === 'overall' ? 'the whole plate' : esc(j.lens)})`).join(', ')}. Each judge's own specialty counts double in their score, and the machine check covers the house rules.</p>
</header>
${sections.join('')}
<footer><p>Model output and scores are never edited. Recaps and labels are generated from the episode record by code.</p>
<p>Dishes run in a sandbox with the network blocked, so apps that expect browser storage keep their state in memory. A judge from the same lab as a chef sits that dish out.${repo ? ` Source, prompts and every score: <a href="https://github.com/${esc(repo)}">github.com/${esc(repo)}</a>.` : ''}</p>
<p class="maker">ModelChef is a side project by <a href="https://jasonshultz.com">Jason Shultz</a>, a human who builds web apps for clients. No judges were harmed.</p></footer>`;

  writeFileSync(join(OUT, 'index.html'), page('ModelChef', body));
  writeFileSync(join(OUT, '.nojekyll'), '');
  console.log(`[modelchef] built ${OUT}/ (${seasons.length} season${seasons.length === 1 ? '' : 's'})`);
}

main();
