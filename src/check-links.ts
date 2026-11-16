// `pnpm check-links [--expect-episodes N]`: every link, image and iframe on the
// built site's own pages must point at a file that exists in dist/, and every
// #fragment at an id on its target page. Run after `pnpm build`.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { extractIds, extractLinks, isSitePage, resolveLink } from './links';

const DIST = 'dist';
const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const expectEpisodes = flag('--expect-episodes');
// Absolute links on this origin (og:image, feed links) are checked against dist/ too.
const origin = (process.env.SITE_URL ?? '').replace(/\/+$/, '') || undefined;

if (!existsSync(join(DIST, 'index.html'))) {
  console.error('check-links: dist/index.html not found. Run pnpm build first.');
  process.exit(1);
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [relative(DIST, full).split(sep).join('/')];
  });
}

const files = new Set(walk(DIST));
const pages = [...files].filter(isSitePage).sort();
const ids = new Map<string, Set<string>>();
const idsOf = (path: string) => {
  if (!ids.has(path)) ids.set(path, extractIds(readFileSync(join(DIST, path), 'utf8')));
  return ids.get(path)!;
};

let links = 0;
const missing: string[] = [];
for (const page of pages) {
  for (const href of extractLinks(readFileSync(join(DIST, page), 'utf8'))) {
    const r = resolveLink(page, href, origin);
    if (r.kind === 'skip') continue;
    links++;
    if (r.kind === 'error') {
      missing.push(`${page} -> ${href} (${r.why})`);
      continue;
    }
    if (!files.has(r.path)) {
      missing.push(`${page} -> ${href}`);
      continue;
    }
    if (r.fragment && r.path.endsWith('.html') && !idsOf(r.path).has(r.fragment)) missing.push(`${page} -> ${href} (no id="${r.fragment}" on ${r.path})`);
  }
}

const episodePages = pages.filter((p) => /^s\/[^/]+\/ep-[^/]+\/index\.html$/.test(p)).length;
console.log(`checked ${pages.length} pages, ${links} links, ${missing.length} missing`);
let failed = false;
if (missing.length) {
  for (const m of missing) console.error(m);
  console.error('Re-run pnpm build (or build:mock) after fixing; a missing shots/ or apps/ file means publishEpisode() did not copy it.');
  failed = true;
}
if (expectEpisodes !== undefined && episodePages !== Number(expectEpisodes)) {
  console.error(`check-links: expected ${expectEpisodes} episode pages, found ${episodePages}.`);
  failed = true;
}
process.exit(failed ? 1 : 0);
