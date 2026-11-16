import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { card, featuredCard, mechLine, mechProblems, recapText, tieTitle } from './site-lib';
import type { DuelVote, Entry, Episode, PressureTest } from './state';

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
