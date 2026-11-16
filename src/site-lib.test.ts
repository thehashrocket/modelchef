import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { abstentionKind, atomFeed, card, guestNotes, nextEpisodeLine, nextSaturday, dishChrome, featuredCard, fmtScores, judgeChips, judgeClass, judgeCss, panelJudges, unknownJudgeIds, mechLine, mechProblems, metaTags, recapText, resolveSiteUrl, tieTitle } from './site-lib';
import { GUEST_SKIPPED_NO_CREDIT, GUEST_UNEVEN_REASON, SAME_FAMILY_REASON, type DuelVote, type Entry, type Episode, type PressureTest } from './state';

const entry = (contestant: string, total: number, over: Partial<Entry> = {}): Entry => ({
  contestant,
  label: 'Dish A',
  model: null,
  forfeit: null,
  title: `${contestant} dish`,
  pitch: 'A pitch.',
  presentation: '',
  mech: { bytes: 2048, consoleErrors: [], networkAttempts: [], mobileOverflow: false, blank: false, hasTitle: true, hasDescription: true, score: 10 },
  judges: [],
  abstained: [],
  judgeAvg: total,
  total,
  rank: 0,
  ...over,
});

const vote = (winner: string | null): DuelVote => ({ judge: 'j', judgeName: 'The Judge', winner, reason: winner ? 'Cleaner.' : 'Abstained: no clear winner in reply' });

function episode(pressure: Partial<PressureTest> | null, over: Partial<Episode> = {}): Episode {
  const entries = [entry('gemini-flash', 8.24), entry('gpt-oss', 5.9), entry('cohere-north', 5.7)];
  entries.forEach((e, i) => (e.rank = i + 1));
  return {
    number: 1,
    date: '2026-11-14',
    type: 'mystery-box',
    theme: 'Something for a kitchen',
    themeChosenBy: null,
    immune: null,
    entries,
    winner: 'gemini-flash',
    pressure: pressure && {
      spec: 'A spec.',
      chefs: ['gpt-oss', 'cohere-north'],
      forfeits: {},
      votes: [],
      eliminated: 'cohere-north',
      decidedBy: 'votes',
      ...pressure,
    },
    eliminated: 'cohere-north',
    ...over,
  };
}

const WIN = 'Gemini 3.8 Flash won with "gemini-flash dish" (8.2).';

describe('recapText', () => {
  it('reports a vote by counted votes, en dash', () => {
    const ep = episode({ votes: [vote('gpt-oss'), vote('gpt-oss'), vote('gpt-oss')] });
    assert.equal(recapText('season-01', ep), `${WIN} Cohere North Mini Code lost the pressure test 3–0 to GPT-OSS 120B and went home.`);
  });

  it('does not count abstentions', () => {
    const ep = episode({ votes: [vote('gpt-oss'), vote(null), vote(null)] });
    assert.match(recapText('season-01', ep), /lost the pressure test 1–0 to/);
  });

  it('counts by chef id, not by the order a judge saw the dishes', () => {
    const ep = episode({ votes: [{ ...vote('gpt-oss'), order: ['cohere-north', 'gpt-oss'] }, vote('cohere-north'), vote('gpt-oss')] });
    assert.match(recapText('season-01', ep), /2–1 to GPT-OSS 120B/);
  });

  it('a pressure-test forfeit', () => {
    const ep = episode({ decidedBy: 'forfeit', forfeits: { 'cohere-north': 'Model unavailable' } });
    assert.equal(recapText('season-01', ep), `${WIN} Cohere North Mini Code didn't serve a pressure-test dish and went home.`);
  });

  it('a tied vote', () => {
    const ep = episode({ decidedBy: 'main-round score', votes: [vote('gpt-oss'), vote('cohere-north'), vote(null)] });
    assert.equal(recapText('season-01', ep), `${WIN} The judges tied 1–1 on the pressure test, so the main-round score sent Cohere North Mini Code home.`);
  });

  it('no valid votes', () => {
    const ep = episode({ decidedBy: 'main-round score', votes: [vote(null), vote(null)] });
    assert.equal(recapText('season-01', ep), `${WIN} No judge could pick a pressure-test winner, so the main-round score sent Cohere North Mini Code home.`);
  });

  it('both chefs forfeited the pressure test', () => {
    const ep = episode({ decidedBy: 'main-round score', forfeits: { 'gpt-oss': 'x', 'cohere-north': 'y' } });
    assert.equal(recapText('season-01', ep), `${WIN} Neither chef served a pressure-test dish, so the main-round score sent Cohere North Mini Code home.`);
  });

  it('the finale names the champion and the runner-up', () => {
    const ep = episode(null, { type: 'finale', eliminated: 'gpt-oss' });
    assert.equal(recapText('season-01', ep), 'Gemini 3.8 Flash is the Season 1 champion, beating GPT-OSS 120B 8.2 to 5.9.');
  });

  it('falls back when the winner forfeited', () => {
    const ep = episode(null);
    ep.entries[0]!.forfeit = 'Model unavailable';
    assert.equal(recapText('season-01', ep), 'Gemini 3.8 Flash won.');
  });

  it('omits the second sentence when there is no pressure test', () => {
    assert.equal(recapText('season-01', episode(null)), WIN);
  });
});

describe('tieTitle', () => {
  it('is empty without a tie', () => {
    const ep = episode(null);
    assert.equal(tieTitle(ep, ep.entries[0]!), '');
  });

  it('names the machine check when it broke the tie', () => {
    const ep = episode(null);
    ep.entries[1]!.total = 5.701;
    ep.entries[2]!.mech!.score = 9;
    assert.equal(tieTitle(ep, ep.entries[1]!), 'Tied on score; ranked by machine check');
  });

  it('does not invent a reason when machine checks were equal too', () => {
    const ep = episode(null);
    ep.entries[1]!.total = 5.7;
    assert.equal(tieTitle(ep, ep.entries[2]!), 'Tied on score');
  });
});

describe('escaping', () => {
  const HOSTILE = `"><script>x</script>'&`;
  const hostileEp = () => {
    const ep = episode({ votes: [vote('gpt-oss')] });
    for (const e of ep.entries) {
      e.title = HOSTILE;
      e.pitch = HOSTILE;
      e.presentation = HOSTILE;
      e.judges = [{ judge: 'craftsman', judgeName: HOSTILE, lens: 'craft', scores: { usefulness: 5, craft: 5, originality: 5, theme: 5 }, weighted: 5, critique: HOSTILE, improve: HOSTILE, model: HOSTILE }];
      e.abstained = [{ judge: 'maverick', judgeName: HOSTILE, reason: HOSTILE, model: HOSTILE }];
    }
    return ep;
  };

  for (const [name, render] of [
    ['card', (ep: Episode) => card('season-01', ep, ep.entries[1]!)],
    ['featuredCard', (ep: Episode) => featuredCard('season-01', ep, ep.entries[0]!)],
  ] as const) {
    it(`${name} escapes model text in text and attributes`, () => {
      const html = render(hostileEp());
      assert.ok(!html.includes('<script'), 'raw <script');
      assert.ok(!html.includes(HOSTILE), 'unescaped hostile string');
      assert.ok(html.includes('&quot;&gt;&lt;script&gt;x&lt;/script&gt;&#39;&amp;'), 'escaped form present');
    });
  }
});

describe('mechLine', () => {
  const ok = (): NonNullable<Entry['mech']> => ({ bytes: 60_000, consoleErrors: [], networkAttempts: [], mobileOverflow: false, blank: false, hasTitle: true, hasDescription: true, score: 10 });
  const ep = (over: Partial<Episode> = {}) => episode(null, over);

  it('collapses to "passed" with the detail for screen readers', () => {
    const html = mechLine(ok(), ep());
    assert.match(html, /class="mech ok"/);
    assert.match(html, /✓<\/span> Machine check passed<\/span>/);
    assert.match(html, /<span class="sr">Machine check passed, 10\/10 · 59 KB · no console errors · no network attempts<\/span>/);
  });

  it('lists every problem in order, counts only', () => {
    const m = { ...ok(), score: 1, blank: true, networkAttempts: ['https://x'], consoleErrors: ['<b>boom</b>', 'two'], mobileOverflow: true, ingredient: 'missing' as const, hasTitle: false };
    assert.deepEqual(mechProblems(m), ['Rendered blank', '1 network attempt', '2 console errors', 'Overflows on phone', 'Secret ingredient missing', 'Missing title or description']);
    const html = mechLine(m, ep());
    assert.match(html, /⚠<\/span> Machine check <b>1\/10<\/b>: <span class="problems">Rendered blank · 1 network attempt/);
    assert.ok(!html.includes('boom'), 'console text never shown');
  });

  it('a single problem', () => {
    assert.match(mechLine({ ...ok(), score: 9, consoleErrors: ['x'] }, ep()), /9\/10<\/b>: <span class="problems">1 console error<\/span>/);
  });

  it('always shows the size when size is the secret ingredient', () => {
    const tiny = ep({ ingredient: { id: 'tiny', text: 'Tiny kitchen.' } });
    assert.match(mechLine({ ...ok(), bytes: 8090, ingredient: 'present' }, tiny), /Machine check passed · 7\.9 KB · secret ingredient check passed/);
    assert.match(mechLine({ ...ok(), bytes: 9000, score: 7, ingredient: 'missing' }, tiny), /Secret ingredient missing<\/span> · 8\.8 KB/);
  });

  it('states the ingredient result on every line of an ingredient episode', () => {
    const sound = ep({ ingredient: { id: 'sound', text: 'Sound.' } });
    assert.match(mechLine({ ...ok(), ingredient: 'present' }, sound), /secret ingredient check passed.*a source check, not a play test/);
    assert.match(mechLine({ ...ok(), ingredient: 'unchecked' }, sound), /passed · secret ingredient not machine-checked<\/span>/);
    assert.match(mechLine({ ...ok(), score: 9, mobileOverflow: true, ingredient: 'unchecked' }, sound), /Overflows on phone<\/span> · secret ingredient not machine-checked/);
  });
});

describe('fmtScores', () => {
  it('uses 2 decimals for the whole set when two different values collide at 1', () => {
    const f = fmtScores([6.04, 6.01, 5.5]);
    assert.deepEqual([6.04, 6.01, 5.5].map(f), ['6.04', '6.01', '5.50']);
  });
  it('uses 1 decimal when nothing collides', () => {
    const f = fmtScores([8.24, 7.92, 6.96, 6.6, 5.907, 5.733]);
    assert.deepEqual([8.24, 7.92, 6.96, 6.6, 5.907, 5.733].map(f), ['8.2', '7.9', '7.0', '6.6', '5.9', '5.7']);
  });
  it('ignores float noise and true equals', () => {
    assert.equal(fmtScores([0.1 + 0.2, 0.3, 4])(0.3), '0.3');
  });
});

describe('metaTags', () => {
  const m = { title: 'Mise by Gemini', description: 'A pitch.', path: '/s/season-01/ep-01/', image: '/s/season-01/ep-01/og.jpg?v=abcd1234', width: 1200, height: 630 };
  it('emits no absolute tags without a site URL, and no relative image URLs', () => {
    const html = metaTags(m, '');
    assert.match(html, /og:title" content="Mise by Gemini"/);
    assert.match(html, /twitter:card" content="summary_large_image"/);
    assert.ok(!/og:image|og:url|twitter:image/.test(html));
  });
  it('emits absolute og:url, og:image with size, and twitter:image with a site URL', () => {
    const html = metaTags(m, 'https://modelchef.example');
    assert.match(html, /og:url" content="https:\/\/modelchef\.example\/s\/season-01\/ep-01\/"/);
    assert.match(html, /og:image" content="https:\/\/modelchef\.example\/s\/season-01\/ep-01\/og\.jpg\?v=abcd1234"/);
    assert.match(html, /og:image:width" content="1200"/);
    assert.match(html, /og:image:height" content="630"/);
    assert.match(html, /twitter:image" content="https:\/\/modelchef\.example\/s\/season-01\/ep-01\/og\.jpg/);
  });
  it('escapes model text', () => {
    const html = metaTags({ ...m, title: `"><script>x</script>'&`, description: `"><script>x</script>'&` }, 'https://a.example');
    assert.ok(!html.includes('<script'));
    assert.ok(!html.includes(`"><`));
  });
});

describe('resolveSiteUrl', () => {
  it('is relative-only when unset', () => assert.equal(resolveSiteUrl({}).url, ''));
  it('trims a trailing slash', () => assert.equal(resolveSiteUrl({ SITE_URL: 'https://a.example/' }).url, 'https://a.example'));
  it('an empty SITE_URL disables absolute tags, even on Vercel production', () =>
    assert.equal(resolveSiteUrl({ SITE_URL: '', VERCEL_ENV: 'production', VERCEL_PROJECT_PRODUCTION_URL: 'x.vercel.app' }).url, ''));
  it('warns and ignores a malformed value instead of failing', () => {
    const r = resolveSiteUrl({ SITE_URL: 'modelchef.app' });
    assert.equal(r.url, '');
    assert.match(r.note, /^warning: SITE_URL must start with https:\/\/ \(got "modelchef\.app"\)/);
  });
  it('uses the Vercel production URL only on production builds', () => {
    assert.equal(resolveSiteUrl({ VERCEL_ENV: 'production', VERCEL_PROJECT_PRODUCTION_URL: 'x.vercel.app' }).url, 'https://x.vercel.app');
    assert.equal(resolveSiteUrl({ VERCEL_ENV: 'preview', VERCEL_PROJECT_PRODUCTION_URL: 'x.vercel.app' }).url, '');
  });
});

describe('dishChrome', () => {
  it('main-round bar: title, chef, rank, score; no dead links at the ends', () => {
    const ep = episode(null);
    const { bar } = dishChrome('season-01', ep, { entry: ep.entries[0]!, next: { href: 'play-gpt-oss.html', label: 'x' } });
    assert.match(bar, /<b class="t">gemini-flash dish<\/b>/);
    assert.match(bar, /by Gemini 3\.8 Flash · #1 · 8\.2\/10/);
    assert.match(bar, /href="play-gpt-oss\.html"[^>]*>Next/);
    assert.ok(!bar.includes('Prev'));
    assert.match(bar, /<button type="button" class="vbtn" aria-expanded="false" aria-controls="verdict" data-ev-props="[^"]*">Verdict<\/button>/);
  });
  it('a dish with no judges says so', () => {
    const ep = episode(null);
    assert.match(dishChrome('season-01', ep, { entry: ep.entries[1]! }).panel, /<p>Not judged\.<\/p>/);
  });
  it('pressure panel: picks, outcome, and the other dish only when it was served', () => {
    const ep = episode({ votes: [vote('gpt-oss'), vote('gpt-oss'), vote(null)] });
    const lost = dishChrome('season-01', ep, { pressureChef: 'cohere-north', other: { href: 'play-pressure-gpt-oss.html', label: 'GPT-OSS 120B' } });
    assert.match(lost.panel, /Picked by 0 of 3 judges\./);
    assert.match(lost.panel, /Cohere North Mini Code went home\./);
    assert.match(lost.bar, /Other dish: GPT-OSS 120B/);
    const won = dishChrome('season-01', ep, { pressureChef: 'gpt-oss' });
    assert.match(won.panel, /Picked by 2 of 3 judges\..*GPT-OSS 120B survived the pressure test\./s);
    assert.ok(!won.bar.includes('Other dish'));
  });
  it('escapes model text', () => {
    const ep = episode(null);
    const e = { ...ep.entries[0]!, title: `"><script>x</script>'&`, pitch: `"><script>x</script>'&` };
    const { bar, panel } = dishChrome('season-01', ep, { entry: e, prev: { href: 'p.html', label: `"><script>` } });
    assert.ok(!(bar + panel).includes('<script'));
  });
});

describe('judge identity', () => {
  const scored = (judge: string, judgeName: string): Entry['judges'][number] => ({ judge, judgeName, lens: 'craft', scores: { usefulness: 7, craft: 7, originality: 7, theme: 7 }, weighted: 7, critique: 'c', improve: 'i' });
  const withPanel = (abstained: Entry['abstained']) => {
    const ep = episode(null);
    const e = { ...ep.entries[0]!, judges: [scored('pragmatist', 'The Pragmatist'), scored('craftsman', 'The Craftsman')], abstained };
    return judgeChips(ep, e);
  };

  it('same family: "sat out" with a plain explanation, no number', () => {
    const html = withPanel([{ judge: 'maverick', reason: SAME_FAMILY_REASON }]);
    assert.match(html, /class="chip out" title="Same lab as this chef, so this judge sat the dish out\.">.*Maverick · sat out<\/span>/);
  });
  it('older records with the legacy wording still read as "sat out"', () => {
    assert.equal(abstentionKind('Same model family as the chef.'), 'sat-out');
    assert.equal(abstentionKind('Abstained: same model family as one of the chefs.'), 'sat-out');
  });
  it('an unreadable reply: "no score", and the raw error stays out of the chip', () => {
    const html = withPanel([{ judge: 'maverick', reason: 'Unavailable: Unexpected non-whitespace character after JSON at position 382' }]);
    assert.match(html, /Maverick · no score<\/span>/);
    assert.ok(!html.includes('Unexpected'));
  });
  it('the uneven guest rule: "not counted"', () => {
    assert.equal(abstentionKind(GUEST_UNEVEN_REASON, GUEST_UNEVEN_REASON), 'not-counted');
  });
  it('one chip per panel judge', () => {
    const html = withPanel([{ judge: 'maverick', reason: SAME_FAMILY_REASON }]);
    assert.equal((html.match(/class="chip/g) ?? []).length, 3);
  });
  it('an unknown judge id gets a neutral monogram and its recorded name, never a crash', () => {
    const ep = episode(null);
    const e = { ...ep.entries[0]!, judges: [scored('retired', 'The Retired Judge')] };
    const html = judgeChips(ep, e);
    assert.match(html, /<span class="mono j-unknown" aria-hidden="true">R<\/span>Retired Judge <b>7\.0<\/b>/);
    assert.deepEqual(unknownJudgeIds({ ...ep, entries: [e] }), ['retired']);
  });
  it('the guest chip names the guest from the record and marks it', () => {
    const ep = episode(null);
    const e = { ...ep.entries[0]!, judges: [scored('guest', 'Someone Recorded')] };
    assert.match(judgeChips(ep, e), /Someone Recorded <span class="gm">Guest<\/span> <b>7\.0<\/b>/);
  });
  it('builds colour variables for the panel, with or without a guest', () => {
    const withGuest = judgeCss();
    assert.match(withGuest, /\.j-pragmatist\{--j:#0369a1\}/);
    assert.match(withGuest, /\.j-guest\{--j:/);
    const noGuest = judgeCss(panelJudges(null));
    assert.ok(!noGuest.includes('j-guest'));
    assert.match(noGuest, /@media \(prefers-color-scheme:dark\)\{\.j-pragmatist\{--j:#7dd3fc\}/);
  });
  it('sanitises ids into class names', () => {
    assert.equal(judgeClass('The "Odd" Judge!'), 'j-theoddjudge');
  });
});

describe('nextSaturday', () => {
  it('a Saturday goes to the following Saturday', () => assert.equal(nextSaturday('2026-11-14'), '2026-11-21'));
  it('a Sunday', () => assert.equal(nextSaturday('2026-11-15'), '2026-11-21'));
  it('a Friday', () => assert.equal(nextSaturday('2026-11-20'), '2026-11-21'));
  it('month rollover', () => assert.equal(nextSaturday('2026-11-28'), '2026-12-05'));
  it('year rollover', () => assert.equal(nextSaturday('2026-12-26'), '2027-01-02'));
});

describe('nextEpisodeLine', () => {
  it('names the next Saturday', () => assert.equal(nextEpisodeLine('2026-11-14', false, '2026-11-15'), 'Episodes air Saturdays; next expected November 21.'));
  it('is shown on the day itself', () => assert.match(nextEpisodeLine('2026-11-14', false, '2026-11-21'), /November 21/));
  it('hides once that date has passed', () => assert.equal(nextEpisodeLine('2026-11-14', false, '2026-11-22'), ''));
  it('hides after a finale and before any episode', () => {
    assert.equal(nextEpisodeLine('2026-11-14', true, '2026-11-15'), '');
    assert.equal(nextEpisodeLine(undefined, false, '2026-11-15'), '');
  });
});

describe('atomFeed', () => {
  const now = new Date('2026-11-15T10:00:00.123Z');
  const required = (xml: string) => {
    for (const re of [/^<\?xml version="1\.0" encoding="utf-8"\?>/, /<feed xmlns="http:\/\/www\.w3\.org\/2005\/Atom">/, /<title>ModelChef<\/title>/, /<id>https:\/\/e\.test\/<\/id>/, /<link rel="self" href="https:\/\/e\.test\/feed\.xml"\/>/, /<updated>\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ<\/updated>/, /<author><name>ModelChef<\/name><\/author>/, /<\/feed>\s*$/])
      assert.match(xml, re);
  };
  it('is a valid empty feed with no episodes', () => {
    const xml = atomFeed('https://e.test', [], now);
    required(xml);
    assert.ok(!xml.includes('<entry>'));
    assert.match(xml, /<updated>2026-11-15T10:00:00Z<\/updated>/);
  });
  it('one entry per episode, absolute links, recap as summary', () => {
    const ep = episode({ votes: [vote('gpt-oss')] });
    const xml = atomFeed('https://e.test', [{ season: 'season-01', ep }], now);
    required(xml);
    assert.match(xml, /<title>Episode 1: Mystery Box &quot;Something for a kitchen&quot;<\/title>/);
    assert.match(xml, /<link href="https:\/\/e\.test\/s\/season-01\/ep-01\/"\/>\s*<id>https:\/\/e\.test\/s\/season-01\/ep-01\/<\/id>\s*<updated>2026-11-14T17:23:00Z<\/updated>/);
    assert.match(xml, /<summary>Gemini 3\.8 Flash won with &quot;gemini-flash dish&quot;/);
  });
  it('strips XML-illegal characters and escapes markup', () => {
    const ep = episode(null, { theme: `bell\u0007 "><script>x</script>'&` });
    const xml = atomFeed('https://e.test', [{ season: 'season-01', ep }], now);
    assert.ok(!xml.includes('\u0007'));
    assert.ok(!xml.includes('<script'));
    assert.match(xml, /bell &quot;&gt;&lt;script&gt;x&lt;\/script&gt;&apos;&amp;/);
  });
  it('two seasons with finales: newest first, season-labelled titles', () => {
    const f1 = episode(null, { type: 'finale', number: 5, date: '2026-12-12', eliminated: 'gpt-oss', theme: null });
    const f2 = episode(null, { type: 'finale', number: 5, date: '2027-03-06', eliminated: 'gpt-oss', theme: null });
    const xml = atomFeed('https://e.test', [{ season: 'season-01', ep: f1 }, { season: 'season-02', ep: f2 }], now);
    const titles = [...xml.matchAll(/<entry>\s*<title>([^<]*)<\/title>/g)].map((m) => m[1]);
    assert.deepEqual(titles, ['Season 2, Episode 5: Finale', 'Season 1, Episode 5: Finale']);
    assert.match(xml, /<feed[^>]*>[\s\S]*?<updated>2027-03-06T17:23:00Z<\/updated>/);
    assert.match(xml, /is the Season 2 champion/);
  });
});

describe('guestNotes', () => {
  it('says why the guest sat out', () => {
    const ep = episode(null, { type: 'finale', guestSkipped: GUEST_SKIPPED_NO_CREDIT });
    assert.equal(guestNotes(ep), '<p class="sub note">The guest judge did not take part. There was not enough credit for it.</p>');
  });
  it('says the single guest score was kept, naming the chef', () => {
    const ep = episode(null, { type: 'finale', guestRuleSkipped: 'dropping the guest would leave gpt-oss unjudged' });
    ep.entries[1]!.judges = [{ judge: 'guest', judgeName: 'Claude Opus 5.5', lens: 'overall', scores: { usefulness: 8, craft: 8, originality: 8, theme: 8 }, weighted: 8, critique: '', improve: '' }];
    assert.match(guestNotes(ep), /The guest judge scored only GPT-OSS 120B\. That score was kept so both finalists have a score; the panels differed\./);
  });
  it('is empty otherwise', () => assert.equal(guestNotes(episode(null)), ''));
});
