import assert from 'node:assert/strict';
import { it } from 'node:test';
import { judgeChips, notesBlock } from './site-lib';
import { GUEST_UNEVEN_REASON, SAME_FAMILY_REASON, type Entry, type Episode } from './state';

const finalist: Entry = {
  contestant: 'gemini-flash', label: 'Dish A', model: null, forfeit: null, title: 't', pitch: '', presentation: '', mech: null,
  judges: [{ judge: 'pragmatist', judgeName: 'The Pragmatist', lens: 'usefulness', scores: { usefulness: 7, craft: 7, originality: 7, theme: 7 }, weighted: 7, critique: 'c', improve: 'i' }],
  abstained: [
    { judge: 'guest', judgeName: 'Claude Opus 5.5', reason: GUEST_UNEVEN_REASON },
    { judge: 'maverick', judgeName: 'The Maverick', reason: SAME_FAMILY_REASON },
    { judge: 'craftsman', judgeName: 'The Craftsman', reason: 'Unavailable: Unexpected token } in JSON' },
  ],
  judgeAvg: 7, total: 7, rank: 1,
};
const ep = { entries: [finalist] } as unknown as Episode;

it('the guest chip reads "Guest · not counted" with the reason as its title', () => {
  assert.match(judgeChips(ep, finalist), new RegExp(`title="${GUEST_UNEVEN_REASON.replace(/\./g, '\\.')}"><span class="mono j-guest" aria-hidden="true">G</span>Guest · not counted</span>`));
});

it("judges' notes explain each abstention in plain words and keep the raw reason", () => {
  const html = notesBlock(ep, finalist, true);
  assert.match(html, /The Maverick abstained<\/b><span class="why">Same lab as this chef, so this judge sat the dish out\.<\/span><small>Same model family as the chef\.<\/small>/);
  assert.match(html, /The Craftsman abstained<\/b><span class="why">This judge&#39;s reply couldn&#39;t be read, so the dish was scored by the others\.<\/span><small>Unavailable: Unexpected token \} in JSON<\/small>/);
  assert.match(html, /Claude Opus 5\.5 abstained<\/b><small>Guest judge could not score both finalists/);
});
