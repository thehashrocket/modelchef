import assert from 'node:assert/strict';
import { it } from 'node:test';
import { recapHtml } from './site-lib';
import type { Entry, Episode } from './state';

const entry = (contestant: string, total: number, rank: number): Entry => ({
  contestant, label: 'Dish A', model: null, forfeit: null, title: contestant, pitch: '', presentation: '', mech: null,
  judges: [], abstained: [], judgeAvg: total, total, rank,
});

it('recapHtml links the pressure test in the generated sentence, never inside a dish title', () => {
  const ep: Episode = {
    number: 1, date: '2026-11-14', type: 'mystery-box', theme: null, themeChosenBy: null, immune: null,
    entries: [{ ...entry('gemini-flash', 8.2, 1), title: 'A pressure test timer' }, entry('gpt-oss', 5.9, 2), entry('cohere-north', 5.7, 3)],
    winner: 'gemini-flash', eliminated: 'cohere-north',
    pressure: {
      spec: 'A spec.', chefs: ['gpt-oss', 'cohere-north'], forfeits: {}, eliminated: 'cohere-north', decidedBy: 'votes',
      votes: [{ judge: 'a', judgeName: 'A', winner: 'gpt-oss', reason: '' }, { judge: 'b', judgeName: 'B', winner: 'gpt-oss', reason: '' }],
    },
  };
  const html = recapHtml('season-01', ep);
  assert.match(html, /won with &quot;A pressure test timer&quot;/);
  assert.match(html, /lost the <a href="#season-01-ep-01-pressure">pressure test<\/a> 2–0/);
});
