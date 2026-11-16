import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { decodeEntities, extractIds, extractLinks, isSitePage, resolveLink } from './links';

describe('check-links resolution', () => {
  const page = 's/season-01/ep-01/index.html';
  it('resolves relative links against the page', () => {
    assert.deepEqual(resolveLink(page, '../../../index.html#episodes'), { kind: 'file', path: 'index.html', fragment: 'episodes' });
    assert.deepEqual(resolveLink(page, 'shots/a-desktop.jpg?v=1'), { kind: 'file', path: 's/season-01/ep-01/shots/a-desktop.jpg', fragment: null });
  });
  it('maps a trailing slash to index.html', () => {
    assert.deepEqual(resolveLink('index.html', 's/season-01/ep-01/'), { kind: 'file', path: 's/season-01/ep-01/index.html', fragment: null });
  });
  it('keeps a same-page fragment on the page itself', () => {
    assert.deepEqual(resolveLink(page, '#season-01-ep-01-pressure'), { kind: 'file', path: page, fragment: 'season-01-ep-01-pressure' });
  });
  it('rejects root-relative and javascript: links', () => {
    assert.equal(resolveLink(page, '/index.html').kind, 'error');
    assert.equal(resolveLink(page, 'javascript:alert(1)').kind, 'error');
  });
  it('rejects links that leave the site', () => {
    assert.equal(resolveLink('index.html', '../x.html').kind, 'error');
  });
  it('skips other sites, mail and data URLs', () => {
    for (const h of ['https://github.com/x', 'http://a.b', 'mailto:a@b.c', 'data:image/png;base64,AA']) assert.equal(resolveLink(page, h).kind, 'skip');
  });
  it('maps absolute links on the site origin back onto the site', () => {
    const o = 'https://example.test';
    assert.deepEqual(resolveLink(page, `${o}/s/season-01/ep-01/og.jpg?v=abc`, o), { kind: 'file', path: 's/season-01/ep-01/og.jpg', fragment: null });
    assert.deepEqual(resolveLink(page, `${o}/s/season-01/ep-01/`, o), { kind: 'file', path: 's/season-01/ep-01/index.html', fragment: null });
    assert.deepEqual(resolveLink(page, `${o}/`, o), { kind: 'file', path: 'index.html', fragment: null });
  });
});

describe('check-links parsing', () => {
  it('reads href and src, decoding entities', () => {
    assert.deepEqual(extractLinks(`<a class="x" href="a.html?x=1&amp;y=2">x</a><img loading="lazy" src='b.jpg'><iframe src="apps/c.html" title="t"></iframe>`), ['a.html?x=1&y=2', 'b.jpg', 'apps/c.html']);
  });
  it('reads ids', () => {
    assert.deepEqual([...extractIds(`<h2 id="season-01-ep-01">x</h2><div id='episodes'>`)], ['season-01-ep-01', 'episodes']);
  });
  it('decodes numeric entities', () => {
    assert.equal(decodeEntities('&#39;&#x27;&quot;'), `''"`);
  });
  it("only reads the site's own pages, never dishes", () => {
    assert.ok(isSitePage('index.html'));
    assert.ok(isSitePage('s/season-01/ep-01/index.html'));
    assert.ok(isSitePage('s/season-01/ep-01/play-ernie.html'));
    assert.ok(!isSitePage('s/season-01/ep-01/apps/ernie.html'));
    assert.ok(!isSitePage('s/season-01/ep-01/pressure/ernie.html'));
  });
});
