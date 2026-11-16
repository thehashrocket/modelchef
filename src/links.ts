// Pure link checking for the built site: which pages to read, how a link
// resolves, and whether its target (and #fragment) exists. No I/O here; the
// CLI in check-links.ts supplies a file system.
import { posix } from 'node:path';

/** The site's own pages (and its feed). Never dishes under apps/ or pressure/: those are model output. */
export function isSitePage(rel: string): boolean {
  return rel === 'index.html' || rel === 'feed.xml' || /^s\/[^/]+\/ep-[^/]+\/(index|play-[^/]+)\.html$/.test(rel);
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
export const decodeEntities = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') return String.fromCodePoint(e[1]?.toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
    return ENTITIES[e.toLowerCase()] ?? m;
  });

/** Every href and src on a page, entity-decoded, once each. */
export function extractLinks(html: string): string[] {
  const out = new Set<string>();
  for (const [tag] of html.matchAll(/<[a-z][^>]*>/gi)) {
    for (const a of tag.matchAll(/\s(?:href|src)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) out.add(decodeEntities(a[1] ?? a[2] ?? ''));
    // Share tags point at pages and images too.
    if (/^<meta\b/i.test(tag) && /\s(?:property|name)\s*=\s*["'](?:og:url|og:image|twitter:image)["']/i.test(tag)) {
      const c = /\scontent\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag);
      if (c) out.add(decodeEntities(c[1] ?? c[2] ?? ''));
    }
  }
  return [...out];
}

/** Every id on a page. */
export function extractIds(html: string): Set<string> {
  return new Set([...html.matchAll(/\sid\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)].map((m) => decodeEntities(m[1] ?? m[2] ?? '')));
}

export type Resolved =
  | { kind: 'skip' }
  | { kind: 'error'; why: string }
  | { kind: 'file'; path: string; fragment: string | null };

/**
 * Resolves a link found on `page` (a path relative to the site root).
 * `origin`, when given, is the absolute site URL whose links are mapped back
 * onto the site (used to check og:image and friends in a SITE_URL build).
 */
export function resolveLink(page: string, href: string, origin?: string): Resolved {
  let h = href.trim();
  // Absolute links on the site's own origin resolve from the site root.
  let fromRoot = false;
  if (origin && (h === origin || h.startsWith(origin + '/') || h.startsWith(origin + '?') || h.startsWith(origin + '#'))) {
    h = h.slice(origin.length).replace(/^\//, '');
    fromRoot = true;
  } else {
    if (/^javascript:/i.test(h)) return { kind: 'error', why: 'javascript: link' };
    if (/^(https?:|mailto:|data:)/i.test(h) || h.startsWith('//')) return { kind: 'skip' };
    if (h.startsWith('/')) return { kind: 'error', why: 'root-relative link (breaks when the site is opened from a folder); use a relative path' };
  }
  const hash = h.indexOf('#');
  const fragment = hash >= 0 ? h.slice(hash + 1) : null;
  const path = (hash >= 0 ? h.slice(0, hash) : h).replace(/\?.*$/, '');
  if (!path && !fromRoot) return { kind: 'file', path: page, fragment };
  let resolved = posix.normalize(fromRoot ? path || '.' : posix.join(posix.dirname(page), path));
  if (resolved.startsWith('..')) return { kind: 'error', why: 'points outside the site' };
  if (resolved === '.' || path.endsWith('/')) resolved = posix.join(resolved, 'index.html');
  return { kind: 'file', path: resolved, fragment };
}
