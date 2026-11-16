// Builds the static leaderboard into dist/. Every string that came out of a
// model is escaped, and every dish is published behind a network-blocking
// CSP inside a sandboxed iframe: this site serves JavaScript nobody reviewed.
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONTESTANTS, DATA_DIR, JUDGES, SEASON } from './config';
import {
  atomFeed,
  chefName,
  dishChrome,
  episodeBlock,
  epAnchor,
  epPath,
  esc,
  evAttrs,
  fmtScores,
  isPilot,
  judgeCss,
  metaTags,
  monogram,
  nextEpisodeLine,
  unknownJudgeIds,
  pad,
  recapHtml,
  recapText,
  resolveSiteUrl,
  robotsTxt,
  sitemapXml,
  type SitemapUrl,
  SCORE_EXPLAINED,
  seasonLabel,
  TYPE_LABEL,
  type DishLink,
  type FeedItem,
  type MetaInput,
} from './site-lib';
import { average, type Entry, type Episode, type SeasonState } from './state';

const OUT = 'dist';

const CSP =
  `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:; worker-src blob:; connect-src 'none'; form-action 'none'; base-uri 'none'">`;

/** Published copies of a dish cannot reach the network, whatever the code tries. */
function lockDown(html: string): string {
  const head = /<head[^>]*>/i.exec(html);
  if (head) return html.slice(0, head.index + head[0].length) + CSP + html.slice(head.index + head[0].length);
  return CSP + html;
}

/** Shared by every page, the dish pages included: tokens (light and dark), badges, chips, notes, focus. */
const BASE_STYLE = `
:root{--mat:#ece6dc;--bg:#faf7f2;--card:#fff;--ink:#1d1a16;--muted:#6f675c;--line:#e4dccf;--accent:#c2410c;--good:#15803d;--bad:#b91c1c}
@media (prefers-color-scheme:dark){:root{--mat:#2a2620;--bg:#15130f;--card:#1f1c17;--ink:#f1ece3;--muted:#a59c8e;--line:#342f27;--accent:#fb923c;--good:#4ade80;--bad:#f87171}}
*{box-sizing:border-box}
a{color:var(--accent)}
.jrow{display:flex;flex-wrap:wrap;gap:6px;font-size:.8rem;font-variant-numeric:tabular-nums}
.jrow .chip{display:inline-flex;align-items:center;gap:4px;background:var(--bg);border:1px solid var(--line);border-radius:6px;padding:1px 7px 1px 3px;color:var(--muted)}
.jrow .chip.out{border-style:dashed;background:none}
.jrow b{color:var(--ink);font-weight:600}
.mono{display:inline-grid;place-items:center;width:1.25em;height:1.25em;border-radius:50%;background:var(--j);color:#fff;font:700 .75em/1 system-ui,sans-serif;margin-right:4px;vertical-align:-.15em;flex-shrink:0}
.j-unknown{--j:var(--muted)}
.gm{font-size:.85em;border:1px solid var(--muted);border-radius:4px;padding:0 4px;margin-left:2px;color:var(--ink)}
@media (prefers-color-scheme:dark){.mono{color:#15130f}}
${judgeCss()}
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
blockquote .why{display:block}
.prov{display:block;color:var(--muted);font-size:.78rem}
.notes h4{margin:6px 0 0;font-size:.92rem;color:var(--muted)}
`;

const STYLE = `${BASE_STYLE}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif}
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
.plate{display:block;background:var(--mat);padding:14px 14px 0;border-bottom:1px solid var(--line)}
.plate .chrome{display:flex;gap:5px;align-items:center;height:22px;padding:0 9px;border-radius:8px 8px 0 0;background:var(--line)}
.plate .chrome i{width:7px;height:7px;border-radius:50%;background:var(--muted);opacity:.6}
.plate img{display:block;width:100%;height:auto;aspect-ratio:16/10;object-fit:cover;object-position:top;border-radius:0;box-shadow:0 6px 18px rgb(0 0 0 / .18);outline:1px solid var(--line);background:var(--line);transition:transform .15s ease}
.plate:hover img,.plate:focus-visible img{transform:translateY(-2px)}
@media (prefers-reduced-motion:reduce){.plate img{transition:none}.plate:hover img,.plate:focus-visible img{transform:none}}
.noshot{aspect-ratio:16/10;display:grid;place-items:center;color:var(--muted);padding:16px;text-align:center;background:var(--card);border:1px dashed var(--line);border-bottom:0;margin-top:22px}
.body{padding:14px 16px 16px;display:flex;flex-direction:column;gap:8px;flex:1}
.row{display:flex;justify-content:space-between;align-items:baseline;gap:12px}
.score{font:700 1.5rem/1 Georgia,serif;font-variant-numeric:tabular-nums;white-space:nowrap}
.outof{font:600 .8rem system-ui;color:var(--muted);margin-left:2px}
.by{color:var(--muted);font-size:.9rem}
.pitch{margin:0}
.says p{margin:8px 0 0;color:var(--muted);font-style:italic}
.panel{color:var(--muted);font-size:.92rem;margin:10px 0 0;max-width:72ch}
.panel b{color:var(--ink)}
.judges{list-style:none;margin:4px 0 0;padding:0;display:grid;gap:10px}
.judges li{padding-left:1.9em;text-indent:-1.9em}
.judges .mono{text-indent:0;width:1.5em;height:1.5em;margin-right:.4em}
.lens{color:var(--muted);font-size:.85em;text-transform:uppercase;letter-spacing:.04em}
.panel p{margin:8px 0 0}
.latest{font-weight:600}
.play{margin-top:auto;font-weight:700}
.recap{font-size:1.05rem;color:var(--ink);max-width:70ch;margin:0 0 18px;overflow-wrap:anywhere}
.status .recap-line{font-weight:400;overflow-wrap:anywhere}
.status .upnext{font-weight:400;color:var(--muted)}
h3{overflow-wrap:anywhere}
.feature{background:var(--card);border:1px solid var(--line);border-radius:10px;overflow:hidden;display:grid;grid-template-columns:1fr;margin-bottom:18px}
.feature h3{font-size:1.6rem}
.feature .shot{align-self:start}
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
header.compact{padding:28px 0 18px}
header.compact h1{font-size:2rem}
header.compact h1 a{color:inherit;text-decoration:none}
.toplinks{display:flex;flex-wrap:wrap;gap:4px 18px;margin:10px 0 0}
.toplinks a,.epnav a,.more a{display:inline-block;padding:10px 0;font-weight:600}
.epnav{display:flex;flex-wrap:wrap;gap:0 18px;margin:12px 0 0}
.epnav .next{margin-left:auto}
.more{margin:14px 0 0}
.earlier{list-style:none;margin:0;padding:0;background:var(--card);border:1px solid var(--line);border-radius:10px}
.earlier li{border-bottom:1px solid var(--line)}
.earlier li:last-child{border-bottom:0}
.earlier a{display:block;padding:12px 16px;text-decoration:none;color:var(--ink)}
.earlier a:hover b{color:var(--accent)}
.earlier span{display:block;color:var(--muted);font-size:.9rem;overflow-wrap:anywhere}
.consent{position:fixed;left:12px;right:12px;bottom:12px;z-index:10;max-width:560px;margin:0 auto;background:var(--card);color:var(--ink);border:1px solid var(--line);border-radius:10px;padding:12px 16px;box-shadow:0 8px 24px rgb(0 0 0 / .2);font-size:.92rem}
.consent[hidden]{display:none}
.consent p{margin:0}
.consent-buttons{display:flex;gap:10px;margin-top:10px!important}
.consent button{min-height:44px;padding:0 16px;border-radius:99px;border:1px solid var(--accent);background:var(--accent);color:var(--card);font:inherit;font-weight:700;cursor:pointer}
.consent button+button{background:none;color:var(--accent)}
.linkish{background:none;border:0;padding:10px 0;color:var(--accent);font:inherit;text-decoration:underline;cursor:pointer}
`;

/** Google Analytics 4 measurement id (GA_MEASUREMENT_ID), resolved in main(). Empty: no GA at all. */
let GA_ID = '';
/** Google Search Console HTML-tag verification token (GOOGLE_SITE_VERIFICATION), resolved in main(). */
let GSC_TOKEN = '';

/**
 * Analytics for the site's own pages, never inside a dish's sandbox:
 * - Vercel Web Analytics: cookie-free, served from this site's own origin
 *   (enable Analytics on the Vercel project). Relative path, so the site still
 *   works from a folder; locally it just 404s.
 * - Google Analytics 4, only when GA_MEASUREMENT_ID is set, under Consent Mode v2:
 *   analytics_storage is denied until the visitor accepts in the banner (see
 *   consentBanner), so without consent GA sends only cookieless pings.
 * - One listener sends tracked interactions to both: clicks on [data-ev]
 *   links/buttons and opening a [data-ev] <details>. window.mcTrack(name, props)
 *   lets page scripts (the Verdict button) send their own.
 */
function analyticsHead(root: string): string {
  const ga = GA_ID
    ? `
<script>
window.dataLayer = window.dataLayer || [];
function gtag(){ dataLayer.push(arguments); }
var mcConsent = null; try { mcConsent = localStorage.getItem('mc-consent'); } catch (e) {}
gtag('consent', 'default', { analytics_storage: mcConsent === 'granted' ? 'granted' : 'denied', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' });
gtag('js', new Date());
gtag('config', '${GA_ID}');
</script>
<script async src="https://www.googletagmanager.com/gtag/js?id=${GA_ID}"></script>`
    : '';
  return `${GSC_TOKEN ? `<meta name="google-site-verification" content="${esc(GSC_TOKEN)}">\n` : ''}<script>
window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments); };
window.mcTrack = function (name, props) {
  try { window.va('event', { name: name, data: props || {} }); if (window.gtag) window.gtag('event', name, props || {}); } catch (e) {}
};
(function () {
  function props(el) { try { return JSON.parse(el.getAttribute('data-ev-props') || '{}'); } catch (e) { return {}; } }
  document.addEventListener('click', function (e) {
    var el = e.target && e.target.closest ? e.target.closest('a[data-ev], button[data-ev]') : null;
    if (el) window.mcTrack(el.getAttribute('data-ev'), props(el));
  });
  document.addEventListener('toggle', function (e) {
    var el = e.target;
    if (el && el.open && el.getAttribute && el.getAttribute('data-ev')) window.mcTrack(el.getAttribute('data-ev'), props(el));
  }, true);
})();
</script>${ga}
<script defer src="${root}_vercel/insights/script.js"></script>`;
}

/** The cookie choice for Google Analytics: shown until the visitor picks, reopened from the footer. Only when GA is on. */
function consentBanner(): string {
  if (!GA_ID) return '';
  return `<div class="consent" id="consent" role="region" aria-label="Cookie choice" hidden>
<p>ModelChef uses Google Analytics cookies to count visits, if you allow it. Without them, visits are counted anonymously.</p>
<p class="consent-buttons"><button type="button" data-consent="granted">Allow</button><button type="button" data-consent="denied">No thanks</button></p>
</div>
<script>
(function () {
  var box = document.getElementById('consent'), saved = null;
  try { saved = localStorage.getItem('mc-consent'); } catch (e) {}
  if (!saved) box.hidden = false;
  box.addEventListener('click', function (e) {
    var v = e.target.getAttribute && e.target.getAttribute('data-consent');
    if (!v) return;
    try { localStorage.setItem('mc-consent', v); } catch (err) {}
    if (window.gtag) window.gtag('consent', 'update', { analytics_storage: v });
    box.hidden = true;
  });
  document.addEventListener('click', function (e) {
    if (e.target.closest && e.target.closest('[data-consent-open]')) { box.hidden = false; box.querySelector('button').focus(); }
  });
})();
</script>`;
}

function page(title: string, body: string, meta = '', root = ''): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="A weekly cooking competition for language models, where the dishes are single-file web apps and the judges are models too.">
${meta}${FEED ? `\n<link rel="alternate" type="application/atom+xml" title="ModelChef episodes" href="${root}feed.xml">` : ''}
${analyticsHead(root)}
<style>${STYLE}</style>
</head>
<body><div class="wrap">${body}</div>${consentBanner()}</body>
</html>
`;
}

/**
 * A dish on its own page: a bar (back, title, chef, rank, score, prev/next,
 * Verdict) over the sandboxed iframe. The Verdict script only toggles the
 * panel; it never reads from the dish or listens for messages.
 */
function playPage(opts: { title: string; pageTitle: string; bar: string; panel: string; src: string; meta: string }): string {
  const { title, src } = opts;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(opts.pageTitle)}</title>
${opts.meta}
${analyticsHead('../../../')}
<style>${BASE_STYLE}
html,body{height:100%;margin:0}
body{display:flex;flex-direction:column;font:15px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;background:var(--bg);color:var(--ink)}
.bar{display:grid;grid-template-columns:auto minmax(12ch,1fr) auto;grid-template-areas:"back t vbtn" "r2 r2 r2";align-items:center;gap:0 12px;padding:4px 12px;border-bottom:1px solid var(--line);background:var(--card)}
.bar .back{grid-area:back}.bar .t{grid-area:t}.bar .vbtn{grid-area:vbtn}
.r2{grid-area:r2;display:flex;align-items:center;gap:12px;min-width:0}
.bar a{font-weight:700;text-decoration:none;display:inline-flex;align-items:center;min-height:44px}
.t{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.m{flex:1;color:var(--muted);font-size:.85rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.pn{display:flex;gap:14px;flex-shrink:0;white-space:nowrap;font-size:.9rem}
.vbtn{min-height:44px;margin:0;padding:0 14px;border:1px solid var(--accent);border-radius:99px;background:none;color:var(--accent);font:inherit;font-weight:700;cursor:pointer}
.vbtn[aria-expanded="true"]{background:var(--accent);color:var(--card)}
@media (max-width:559px){.wl{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap}}
@media (min-width:560px){.bar{grid-template-columns:auto minmax(12ch,1fr) auto auto;grid-template-areas:"back t r2 vbtn"}.m{flex:0 1 auto}}
#verdict{max-height:45vh;overflow:auto;padding:4px 16px 14px;border-bottom:1px solid var(--line);background:var(--card)}
#verdict[hidden]{display:none}
#verdict>*{max-width:72ch}
#verdict .pitch{margin:10px 0 0}
#verdict .fine{color:var(--muted);font-size:.85rem;margin:12px 0 0}
#verdict ul{padding-left:20px}
iframe{flex:1;min-height:0;border:0;width:100%;background:#fff}
</style>
</head>
<body>
${opts.bar}
<section id="verdict" aria-label="Verdict" hidden>${opts.panel}</section>
<iframe src="${esc(src)}" sandbox="allow-scripts allow-forms allow-modals allow-downloads allow-pointer-lock" title="${esc(title)}"></iframe>
<script>
const b = document.querySelector('.vbtn'), v = document.getElementById('verdict');
const set = (open) => {
  v.hidden = !open; b.setAttribute('aria-expanded', String(open));
  if (open && window.mcTrack) window.mcTrack('verdict_open', JSON.parse(b.getAttribute('data-ev-props') || '{}'));
};
b.addEventListener('click', () => set(v.hidden));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !v.hidden) { set(false); b.focus(); } });
</script>
</body>
</html>
`;
}

const TAGLINE = 'A weekly cooking competition for language models, where the dishes are single-file web apps and the judges are models too.';
const epPage = (season: string, ep: Episode, root = '') => `${root}${epPath(season, ep)}/index.html`;
const epTitle = (ep: Episode) => `Episode ${ep.number}: ${TYPE_LABEL[ep.type]}${ep.theme ? ` "${ep.theme}"` : ''}`;

function standings(season: string, state: SeasonState): string {
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
  return `<h2>Standings, ${esc(seasonLabel(season))}</h2>
<p class="sub">Season average of each chef's episode scores. ${esc(SCORE_EXPLAINED)}</p>
<div class="scroll"><table><thead><tr><th>Chef</th><th>Status</th><th class="num">Average /10</th><th class="num">Wins</th><th class="num">Dishes</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

/** One line per episode, newest first, each linking to its page. Keeps the old home-page anchors alive. */
function episodeRows(season: string, episodes: Episode[]): string {
  return `<ol class="earlier">${[...episodes]
    .reverse()
    .map((ep) => {
      const win = ep.entries.find((e) => e.contestant === ep.winner);
      const dish = win && !win.forfeit ? ` (&ldquo;${esc(win.title)}&rdquo;)` : '';
      const out = ep.eliminated ? ` · ${ep.type === 'finale' ? 'Runner-up' : 'Went home'}: ${esc(chefName(ep.eliminated))}` : '';
      const theme = ep.theme ? `&ldquo;${esc(ep.theme)}&rdquo; · ` : '';
      return `<li id="${esc(epAnchor(season, ep))}"><a href="${epPage(season, ep)}"${evAttrs('episode_nav', { to: 'episode', from: 'earlier_row', season, episode: ep.number })}><b>Ep ${ep.number} · ${TYPE_LABEL[ep.type]}</b><span>${theme}Winner: ${esc(chefName(ep.winner))}${dish}${out}</span></a></li>`;
    })
    .join('')}</ol>`;
}

/**
 * A season on the home page. The newest season shows its latest episode in
 * full and the rest as rows; older seasons show standings and rows only.
 */
function seasonSection(season: string, state: SeasonState, episodes: Episode[], newest: boolean): string {
  // A pilot has no standings: its scores never counted toward anything.
  if (isPilot(season)) {
    const eps = [...episodes].reverse().map((ep) => episodeBlock(season, ep)).join('');
    return `<h2>The pilot</h2>
<p class="sub">A trial run before season 1, kept for the record. It did not count: no standings, no immunity, and the chef it sent home was back for the real season.</p>
${eps.replace('<h2>', '<h3 class="pilot">').replace('</h2>', '</h3>')}`;
  }
  if (!newest) return `${standings(season, state)}${episodes.length ? `<h2>${esc(seasonLabel(season))} episodes</h2>${episodeRows(season, episodes)}` : ''}`;

  const latest = episodes.at(-1);
  const earlier = episodes.slice(0, -1);
  const body = latest
    ? `${episodeBlock(season, latest)}
<p class="more"><a href="${epPage(season, latest)}"${evAttrs('episode_nav', { to: 'episode', from: 'home_latest', season, episode: latest.number })}>See the full episode page &rarr;</a></p>${earlier.length ? `\n<h2>Earlier episodes</h2>${episodeRows(season, earlier)}` : ''}`
    : `<p class="recap">${esc(seasonLabel(season))} starts Saturday.</p>`;
  return `${standings(season, state)}
<div id="episodes">${body}</div>`;
}

function siteHeader(opts: { compact: boolean; root: string; status?: string; latestLink?: string }): string {
  if (opts.compact) {
    return `<header class="compact">
<h1><a href="${opts.root}index.html">Model<span>Chef</span></a></h1>
<p class="tag">${esc(TAGLINE)}</p>
<p class="toplinks"><a href="${opts.root}index.html">About the show</a><a href="${opts.root}index.html#judges">Meet the judges &rarr;</a></p>
</header>`;
  }
  return `<header>
<h1>Model<span>Chef</span></h1>
<p class="tag">A weekly cooking competition for language models. Every chef gets the same brief and one shot at a single-file web app. Three model judges score the dishes blind, the bottom two face a pressure test, and one chef goes home. Nothing is edited by a human.</p>
<p class="status">${opts.status ?? ''}${opts.latestLink ?? ''}</p>
<details class="panel" id="judges"${evAttrs('judges_open')}><summary>Meet the judges</summary>
<ul class="judges">${JUDGES.map((j) => `<li>${monogram(j.id)}<b>${esc(j.name)}</b> <span class="lens">${j.lens === 'overall' ? 'the whole plate' : esc(j.lens)}</span><br>${esc(j.bio)}</li>`).join('')}</ul>
<p>Each judge's own specialty counts double in their score.</p>
</details>
</header>`;
}

function siteFooter(repo: string | undefined, root = ''): string {
  return `<footer><p>Model output and scores are never edited. Recaps and labels are generated from the episode record by code.</p>
<p>Dishes run in a sandbox with the network blocked, so apps that expect browser storage keep their state in memory. A judge from the same lab as a chef sits that dish out.${repo ? ` Source, prompts and every score: <a href="https://github.com/${esc(repo)}"${evAttrs('outbound', { target: 'github' })}>github.com/${esc(repo)}</a>.` : ''}</p>
${FEED ? `\n<p><a href="${root}feed.xml"${evAttrs('outbound', { target: 'feed' })}>Episode feed (Atom)</a></p>` : ''}${GA_ID ? `\n<p><button type="button" class="linkish" data-consent-open>Cookie settings</button></p>` : ''}</footer>`;
}

/** The episode's own page, at s/<season>/ep-NN/index.html. */
function episodePage(season: string, ep: Episode, prev: Episode | undefined, next: Episode | undefined, repo: string | undefined): string {
  const root = '../../../';
  const nav = `<nav class="epnav" aria-label="Episodes"><a href="${root}index.html#episodes"${evAttrs('episode_nav', { to: 'all', from: 'episode', episode: ep.number })}>&larr; All episodes</a>${prev ? `<a href="${epPage(season, prev, root)}"${evAttrs('episode_nav', { to: 'prev', from: 'episode', episode: ep.number })}>&larr; Episode ${prev.number}</a>` : ''}${next ? `<a class="next" href="${epPage(season, next, root)}"${evAttrs('episode_nav', { to: 'next', from: 'episode', episode: ep.number })}>Episode ${next.number} &rarr;</a>` : ''}</nav>`;
  const meta = share({ title: `${epTitle(ep)} · ModelChef`, description: recapText(season, ep), path: `/${epPath(season, ep)}/` }, `${epPath(season, ep)}/og.jpg`, 1200, 630);
  return page(
    `${epTitle(ep)} · ModelChef`,
    `${siteHeader({ compact: true, root })}
${nav}
${episodeBlock(season, ep, root)}
${nav}
${siteFooter(repo, root)}`,
    meta,
    root,
  );
}

/** The site's absolute URL for share tags, resolved once in main(). */
let SITE_URL = '';
/** Whether this build writes feed.xml (it needs absolute URLs). */
let FEED = false;
const imageVersions = new Map<string, string>();
/**
 * Share tags for a page. `image` is a path inside dist/; it is used only if the
 * file is there, and versioned by content so a re-render busts unfurl caches.
 */
function share(m: Omit<MetaInput, 'image' | 'width' | 'height'>, image?: string, width?: number, height?: number): string {
  let img: string | undefined;
  if (image && existsSync(join(OUT, image))) {
    if (!imageVersions.has(image)) imageVersions.set(image, createHash('sha256').update(readFileSync(join(OUT, image))).digest('hex').slice(0, 8));
    img = `/${image}?v=${imageVersions.get(image)}`;
  }
  return metaTags({ ...m, image: img, width, height }, SITE_URL);
}

function publishEpisode(season: string, ep: Episode, prev: Episode | undefined, next: Episode | undefined, repo: string | undefined) {
  const src = join(DATA_DIR, season, `ep-${pad(ep.number)}`);
  const out = join(OUT, 's', season, `ep-${pad(ep.number)}`);
  mkdirSync(join(out, 'apps'), { recursive: true });
  mkdirSync(join(out, 'pressure'), { recursive: true });
  if (existsSync(join(src, 'shots'))) cpSync(join(src, 'shots'), join(out, 'shots'), { recursive: true });
  if (existsSync(join(src, 'og.jpg'))) cpSync(join(src, 'og.jpg'), join(out, 'og.jpg'));

  const base = epPath(season, ep);
  const served = ep.entries.filter((e) => !e.forfeit).sort((a, b) => a.rank - b.rank);
  const link = (e: Entry): DishLink => ({ href: `play-${e.contestant}.html`, label: `${e.title} by ${chefName(e.contestant)}` });
  served.forEach((e, i) => {
    writeFileSync(join(out, 'apps', `${e.contestant}.html`), lockDown(readFileSync(join(src, 'apps', `${e.contestant}.html`), 'utf8')));
    const pageTitle = `${e.title} by ${chefName(e.contestant)} · ModelChef`;
    const meta = share(
      { title: pageTitle, description: e.pitch || `${e.title} by ${chefName(e.contestant)}, Episode ${ep.number} of ModelChef`, path: `/${base}/play-${e.contestant}.html` },
      `${base}/shots/${e.contestant}-desktop.jpg`,
      1280,
      800,
    );
    const prev = served[i - 1];
    const next = served[i + 1];
    const chrome = dishChrome(season, ep, { entry: e, prev: prev && link(prev), next: next && link(next) });
    writeFileSync(join(out, `play-${e.contestant}.html`), playPage({ title: e.title, pageTitle, ...chrome, src: `apps/${e.contestant}.html`, meta }));
  });
  const p = ep.pressure;
  for (const id of p?.chefs ?? []) {
    if (p!.forfeits[id]) continue;
    writeFileSync(join(out, 'pressure', `${id}.html`), lockDown(readFileSync(join(src, 'pressure', `${id}.html`), 'utf8')));
    const pageTitle = `Pressure test: ${chefName(id)} · ModelChef`;
    const meta = share(
      { title: pageTitle, description: p!.spec, path: `/${base}/play-pressure-${id}.html` },
      `${base}/shots/pressure-${id}-desktop.jpg`,
      1280,
      800,
    );
    // The other chef's dish, when there was one.
    const otherId = p!.chefs.find((c) => c !== id);
    const other = otherId && !p!.forfeits[otherId] ? { href: `play-pressure-${otherId}.html`, label: chefName(otherId) } : undefined;
    const chrome = dishChrome(season, ep, { pressureChef: id, other });
    writeFileSync(join(out, `play-pressure-${id}.html`), playPage({ title: 'Pressure test', pageTitle, ...chrome, src: `pressure/${id}.html`, meta }));
  }
  // The pilot stays on the home page only.
  if (!isPilot(season)) writeFileSync(join(out, 'index.html'), episodePage(season, ep, prev, next, repo));
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
  // An explicit DATA_DIR with nothing in it is a mistake (usually build:mock before episode:mock).
  if (!seasons.length && process.env.DATA_DIR) {
    console.error(`DATA_DIR=${process.env.DATA_DIR} has no seasons. Run pnpm episode:mock first.`);
    process.exit(1);
  }

  const site = resolveSiteUrl(process.env);
  SITE_URL = site.url;
  FEED = !!SITE_URL;
  console.log(`[modelchef] ${site.note}`);
  const ga = (process.env.GA_MEASUREMENT_ID ?? '').trim();
  GA_ID = /^G-[A-Z0-9]{4,}$/.test(ga) ? ga : '';
  if (ga && !GA_ID) console.log(`[modelchef] warning: GA_MEASUREMENT_ID must look like G-XXXXXXX (got "${ga}"); building without Google Analytics`);
  console.log(`[modelchef] google analytics: ${GA_ID ? `on (${GA_ID}, consent banner)` : 'off (GA_MEASUREMENT_ID unset)'}`);
  GSC_TOKEN = (process.env.GOOGLE_SITE_VERIFICATION ?? '').trim();
  const feedItems: FeedItem[] = [];

  const repo = process.env.GITHUB_REPOSITORY;
  let status = esc(`${seasonLabel(SEASON)} starts Saturday.`);
  let latestLink = '';
  let homeImage: string | undefined;
  const sections: string[] = [];
  for (const [i, season] of seasons.entries()) {
    const state = JSON.parse(readFileSync(join(DATA_DIR, season, 'state.json'), 'utf8')) as SeasonState;
    const episodes = state.episodes.map(
      (e) => JSON.parse(readFileSync(join(DATA_DIR, season, `ep-${pad(e.number)}`, 'episode.json'), 'utf8')) as Episode,
    );
    episodes.forEach((ep, j) => publishEpisode(season, ep, episodes[j - 1], episodes[j + 1], repo));
    if (!isPilot(season)) feedItems.push(...episodes.map((ep) => ({ season, ep })));
    for (const ep of episodes)
      for (const id of unknownJudgeIds(ep))
        console.log(`[modelchef] unknown judge id "${id}" in ${season}/ep-${pad(ep.number)}; add it to JUDGES in src/config.ts, or ignore for a retired judge`);
    const newest = i === 0 && !isPilot(season);
    sections.push(seasonSection(season, state, episodes, newest));
    if (newest) {
      const left = Object.values(state.contestants).filter((c) => c.status === 'active').length;
      const last = episodes.at(-1);
      status = state.champion
        ? esc(`${seasonLabel(season)} champion: ${chefName(state.champion)}.`)
        : last
          ? esc(`${seasonLabel(season)}, ${episodes.length} episode${episodes.length === 1 ? '' : 's'} in. ${left} chefs remain.`)
          : esc(`${seasonLabel(season)} starts Saturday.`);
      if (last) {
        homeImage = `${epPath(season, last)}/og.jpg`;
        status += ` <span class="recap-line">${recapHtml(season, last)}</span>`;
        latestLink = ` <a class="latest" href="#${esc(epAnchor(season, last))}">Watch episode ${last.number} &darr;</a>`;
      }
      const upNext = nextEpisodeLine(last?.date, !!state.champion, new Date().toISOString().slice(0, 10));
      if (upNext) status += ` <span class="upnext">${esc(upNext)}</span>`;
    }
  }
  // Before the first episode: the roster, with nothing scored yet.
  if (!sections.length) {
    const empty: SeasonState = {
      season: SEASON,
      contestants: Object.fromEntries(CONTESTANTS.map((c) => [c.id, { status: 'active' as const, eliminatedIn: null, history: [] }])),
      episodes: [],
      immune: null,
      nextTheme: null,
      champion: null,
    };
    sections.push(seasonSection(SEASON, empty, [], true));
  }

  const body = `${siteHeader({ compact: false, root: '', status, latestLink })}
${sections.join('')}
${siteFooter(repo)}`;

  const homeMeta = share({ title: 'ModelChef', description: TAGLINE, path: '/' }, homeImage, 1200, 630);
  writeFileSync(join(OUT, 'index.html'), page('ModelChef', body, homeMeta));
  writeFileSync(join(OUT, '.nojekyll'), '');
  if (FEED) {
    writeFileSync(join(OUT, 'feed.xml'), atomFeed(SITE_URL, feedItems, new Date()));
    console.log(`[modelchef] feed: dist/feed.xml (${feedItems.length} episode${feedItems.length === 1 ? '' : 's'})`);
  } else console.log('[modelchef] feed: skipped (no SITE_URL)');

  // Search engines: robots.txt always; sitemap.xml only with absolute URLs.
  writeFileSync(join(OUT, 'robots.txt'), robotsTxt(SITE_URL));
  if (SITE_URL) {
    const newest = [...feedItems].sort((a, b) => b.ep.date.localeCompare(a.ep.date))[0]?.ep.date;
    const urls: SitemapUrl[] = [{ path: '/', ...(newest ? { lastmod: newest } : {}) }];
    for (const { season, ep } of feedItems) {
      const base = `/${epPath(season, ep)}`;
      urls.push({ path: `${base}/`, lastmod: ep.date });
      for (const e of ep.entries) if (!e.forfeit) urls.push({ path: `${base}/play-${e.contestant}.html`, lastmod: ep.date });
      for (const id of ep.pressure?.chefs ?? []) if (!ep.pressure!.forfeits[id]) urls.push({ path: `${base}/play-pressure-${id}.html`, lastmod: ep.date });
    }
    writeFileSync(join(OUT, 'sitemap.xml'), sitemapXml(SITE_URL, urls));
    console.log(`[modelchef] sitemap: dist/sitemap.xml (${urls.length} URLs)`);
  } else console.log('[modelchef] sitemap: skipped (no SITE_URL)');
  console.log(`[modelchef] built ${OUT}/ (${seasons.length} season${seasons.length === 1 ? '' : 's'})`);
}

main();
