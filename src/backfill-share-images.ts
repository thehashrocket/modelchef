// `pnpm backfill-share-images [<season>/ep-NN] [--force] [--dry-run]`
// Renders og.jpg for recorded episodes that are missing one. Each file is
// written on its own, so a failed run can be fixed and re-run.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium, type Browser } from 'playwright';
import { DATA_DIR } from './config';
import { renderShareImage, shareCardFor } from './share-image';
import type { Episode } from './state';

const USAGE = 'usage: pnpm backfill-share-images [<season>/ep-NN] [--force] [--dry-run]';
const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log(`${USAGE}

Renders data/<season>/ep-NN/og.jpg for every episode without one (or the one
named). --force re-renders existing images; --dry-run only lists them.`);
  process.exit(0);
}
const unknown = args.filter((a) => a.startsWith('-') && !['--force', '--dry-run'].includes(a));
const positional = args.filter((a) => !a.startsWith('-'));
if (unknown.length || positional.length > 1) {
  console.error(unknown.length ? `unknown option: ${unknown.join(' ')}` : 'name at most one episode');
  console.error(USAGE);
  process.exit(2);
}
const force = args.includes('--force');
const dryRun = args.includes('--dry-run');
const only = positional[0]?.replace(/\/+$/, '');

console.log(`DATA_DIR=${resolve(DATA_DIR)}`);
const dirs: string[] = [];
for (const season of existsSync(DATA_DIR) ? readdirSync(DATA_DIR).sort() : []) {
  if (!existsSync(join(DATA_DIR, season, 'state.json'))) continue;
  for (const ep of readdirSync(join(DATA_DIR, season)).filter((d) => /^ep-\d+$/.test(d)).sort()) {
    if (existsSync(join(DATA_DIR, season, ep, 'episode.json')) && (!only || only === `${season}/${ep}`)) dirs.push(`${season}/${ep}`);
  }
}
if (only && !dirs.length) {
  console.error(`no recorded episode ${only} under ${DATA_DIR}`);
  process.exit(1);
}

let rendered = 0;
let skipped = 0;
const failed: string[] = [];
let browser: Browser | null = null;
try {
  for (const rel of dirs) {
    const dir = join(DATA_DIR, rel);
    const out = join(dir, 'og.jpg');
    if (existsSync(out) && !force) {
      skipped++;
      continue;
    }
    if (dryRun) {
      console.log(`would render ${out}`);
      continue;
    }
    try {
      if (!browser) {
        try {
          browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
        } catch (err) {
          throw new Error(`${(err as Error).message.split('\n')[0]} Run pnpm exec playwright install chromium (or set CHROME_PATH).`);
        }
      }
      const ep = JSON.parse(readFileSync(join(dir, 'episode.json'), 'utf8')) as Episode;
      const winner = ep.entries.find((e) => e.contestant === ep.winner);
      await renderShareImage(browser, out, shareCardFor(rel.split('/')[0]!, ep, winner, dir));
      rendered++;
      console.log(`rendered ${out}`);
    } catch (err) {
      failed.push(`${out}: ${(err as Error).message.split('\n')[0]}`);
    }
  }
} finally {
  await (browser as Browser | null)?.close();
}

console.log(`rendered ${rendered}, skipped ${skipped} (exists), failed ${failed.length}`);
for (const f of failed) console.error(`  failed ${f}`);
process.exit(failed.length ? 1 : 0);
