import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { extractLinks } from './links';
import { evAttrs, metaTags, robotsTxt, sitemapXml } from './site-lib';

describe('evAttrs', () => {
  it('marks an element with an event name and JSON props, escaped for an attribute', () => {
    assert.equal(evAttrs('dish_open', { chef: 'ernie', rank: 2, featured: false }), ' data-ev="dish_open" data-ev-props="{&quot;chef&quot;:&quot;ernie&quot;,&quot;rank&quot;:2,&quot;featured&quot;:false}"');
  });
  it('cannot break out of the attribute', () => {
    const html = `<a${evAttrs('x', { chef: `"><script>x</script>'&` })}>`;
    assert.ok(!html.includes('<script'));
    assert.equal((html.match(/"/g) ?? []).length, 4, 'only the four attribute quotes are raw');
  });
});

describe('sitemapXml', () => {
  const xml = sitemapXml('https://e.test', [{ path: '/', lastmod: '2026-11-21' }, { path: '/s/season-01/ep-01/' , lastmod: '2026-11-16' }, { path: '/a&b.html' }]);
  it('is a sitemaps.org urlset with absolute, escaped locations', () => {
    assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>\n<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
    assert.match(xml, /<url><loc>https:\/\/e\.test\/<\/loc><lastmod>2026-11-21<\/lastmod><\/url>/);
    assert.match(xml, /<loc>https:\/\/e\.test\/a&amp;b\.html<\/loc><\/url>/);
  });
  it('its locations are read by check-links', () => {
    assert.deepEqual(extractLinks(xml), ['https://e.test/', 'https://e.test/s/season-01/ep-01/', 'https://e.test/a&b.html']);
  });
});

describe('canonical URL', () => {
  const m = { title: 't', description: 'd', path: '/s/season-01/ep-01/' };
  it('points every page at the main domain when the site URL is known', () =>
    assert.match(metaTags(m, 'https://modelchef.tv'), /<link rel="canonical" href="https:\/\/modelchef\.tv\/s\/season-01\/ep-01\/">/));
  it('is left out without a site URL (no relative canonical)', () => assert.ok(!metaTags(m, '').includes('canonical')));
});

describe('robotsTxt', () => {
  it('allows the site, keeps raw dishes out, and names the sitemap', () => {
    const txt = robotsTxt('https://e.test');
    assert.match(txt, /^User-agent: \*\nAllow: \/\nDisallow: \/s\/\*\/apps\/\nDisallow: \/s\/\*\/pressure\/\n/);
    assert.match(txt, /\nSitemap: https:\/\/e\.test\/sitemap\.xml\n$/);
  });
  it('has no sitemap line without a site URL', () => assert.ok(!robotsTxt('').includes('Sitemap')));
});
