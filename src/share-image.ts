// Renders an episode's 1200x630 share image (og.jpg) with the browser the
// episode already has open. The Vercel build has no Chromium, so this runs in
// episode.ts (and the backfill script) and the image is committed under data/.
import { readFileSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { Browser } from 'playwright';
import { chefName, esc } from './site-lib';
import { seasonLabel, TYPE_LABEL, type Entry, type Episode } from './state';

export interface ShareCard {
  /** e.g. "Season 1" */
  season: string;
  episode: number;
  /** "Mystery Box" | "Invention Test" | "Finale" */
  typeLabel: string;
  theme: string | null;
  /** The winning dish's title. */
  title: string;
  /** The winning chef's display name. */
  chef: string;
  score: number;
  /** The winner's -desktop.jpg. */
  screenshotPath: string;
}

const STEP_TIMEOUT_MS = 20_000;

/** The card for an episode's winner, from the record. The episode folder holds the winner's screenshot. */
export function shareCardFor(season: string, ep: Pick<Episode, 'number' | 'type' | 'theme'>, winner: Entry | undefined, dir: string): ShareCard {
  if (!winner || winner.forfeit) throw new Error('the winner has no dish to show');
  return {
    season: seasonLabel(season),
    episode: ep.number,
    typeLabel: TYPE_LABEL[ep.type],
    theme: ep.theme,
    title: winner.title,
    chef: chefName(winner.contestant),
    score: winner.total,
    screenshotPath: join(dir, 'shots', `${winner.contestant}-desktop.jpg`),
  };
}

export function shareHtml(card: ShareCard, screenshotDataUrl: string): string {
  const pill = card.typeLabel === 'Finale' ? 'CHAMPION' : 'WINNER';
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box;margin:0}
html,body{width:1200px;height:630px;overflow:hidden}
body{display:grid;grid-template-columns:46% 54%;background:#15130f;color:#f1ece3;font-family:system-ui,-apple-system,"Segoe UI",sans-serif}
.l{padding:52px 40px 48px 56px;display:flex;flex-direction:column;gap:14px;min-width:0}
.mark{font:700 44px/1 Georgia,"Times New Roman",serif;letter-spacing:-.02em}
.mark span{color:#fb923c}
.meta{color:#a59c8e;font-size:20px}
.theme{color:#a59c8e;font-size:18px;font-style:italic;display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical;overflow:hidden}
h1{font:700 40px/1.15 Georgia,serif;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere;margin-top:10px}
.by{font-size:22px;color:#f1ece3}
.foot{margin-top:auto;display:flex;align-items:baseline;gap:16px}
.score{font:700 72px/1 Georgia,serif}
.score small{font:600 24px system-ui;color:#a59c8e;margin-left:4px}
.pill{border:2px solid #fb923c;color:#fb923c;border-radius:99px;padding:4px 14px;font-weight:800;letter-spacing:.08em;font-size:18px}
.r{padding:40px 40px 40px 0;display:flex;align-items:center}
.r img{width:100%;height:100%;object-fit:cover;object-position:left top;border-radius:14px;border:1px solid #342f27;display:block}
</style></head><body>
<div class="l">
<div class="mark">Model<span>Chef</span></div>
<div class="meta">${esc(card.season)} · Episode ${card.episode} · ${esc(card.typeLabel)}</div>
${card.theme ? `<div class="theme">&ldquo;${esc(card.theme)}&rdquo;</div>` : ''}
<h1>${esc(card.title)}</h1>
<div class="by">by ${esc(card.chef)}</div>
<div class="foot"><div class="score">${card.score.toFixed(1)}<small>/10</small></div><div class="pill">${pill}</div></div>
</div>
<div class="r"><img src="${screenshotDataUrl}" alt=""></div>
</body></html>`;
}

/**
 * Writes outPath (via outPath.tmp, then a rename). JavaScript is off and every
 * request is aborted: the template is self-contained, and the embedded
 * screenshot is a data: URL, which is never routed.
 */
export async function renderShareImage(browser: Browser, outPath: string, card: ShareCard): Promise<void> {
  const tmp = `${outPath}.tmp`;
  const dataUrl = `data:image/jpeg;base64,${readFileSync(card.screenshotPath).toString('base64')}`;
  const context = await browser.newContext({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1, javaScriptEnabled: false });
  let blocked = 0;
  try {
    await context.route('**/*', (r) => {
      blocked++;
      return r.abort();
    });
    const page = await context.newPage();
    await page.setContent(shareHtml(card, dataUrl), { timeout: STEP_TIMEOUT_MS });
    await page.screenshot({ path: tmp, type: 'jpeg', quality: 82, timeout: STEP_TIMEOUT_MS });
    renameSync(tmp, outPath);
    if (blocked) console.log(`[modelchef] share image: blocked ${blocked} request(s)`);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  } finally {
    await context.close();
  }
}
