import { readFileSync } from 'node:fs';
import { CONTESTANTS, type Contestant, type Judge } from './config';
import type { Msg, Part } from './llm';
import { average, type EpisodeType, type MechReport, type SeasonState } from './state';

const nameOf = (id: string) => CONTESTANTS.find((c) => c.id === id)?.name ?? id;

export const RULES = `HOUSE RULES (breaking one costs points; some are checked by machine)
- Deliver ONE self-contained HTML file. All CSS and JavaScript inline.
- No libraries, no CDNs, no fonts or images from the network. Zero network requests of any kind.
- It must work the moment it opens: preload demo content so the judges see it in use, never an empty state.
- It must be usable at phone width (390px) with no horizontal scrolling.
- No errors in the console.
- Browser storage may be unavailable. Wrap any storage access in try/catch and fall back to memory.
- Include a <title> (the name of your dish) and a <meta name="description"> (one sentence: what it is and who it is for).
`;

const FINISH = 'Leave enough room to finish: a dish that is cut off before </html> is a forfeit.';

/** Main rounds: the chef presents the dish to the judges, then serves it. */
const ANSWER_WITH_PRESENTATION = `HOW TO ANSWER
First, present your dish to the judges inside <presentation> tags: three or four sentences, in the first person, in plain text. Say what it is, why you chose this idea, and what you did differently because of the judges' last notes (skip that part if you have none). Be honest: the judges check your claims against the dish.

Then serve it: the complete HTML document, starting with <!DOCTYPE html> and ending with </html>. Nothing after it. ${FINISH}`;

const ANSWER_DISH_ONLY = `HOW TO ANSWER
Reply with the complete HTML document and nothing else. Start with <!DOCTYPE html> and end with </html>. ${FINISH}`;

const JUDGING = `THE JUDGES
Three judges taste every dish blind. One cares most about usefulness, one about craft and polish, one about originality. They also see screenshots at desktop and phone width and a machine report of console errors and network attempts.`;

/** Everything that defines what the chefs were asked to make this episode. */
export interface Challenge {
  type: EpisodeType;
  theme: string | null;
  /** Secret ingredient text, Mystery Box only. */
  ingredient: string | null;
  /** Guest judge's name when they set the Finale brief. */
  guest: string | null;
}

export function challengeText(c: Challenge): string {
  if (c.type === 'mystery-box') {
    const box = `MYSTERY BOX. Every chef must build around this theme: "${c.theme}". Interpret it however you like, but a judge should see the connection without being told.`;
    return c.ingredient
      ? `${box}\n\nSECRET INGREDIENT. On top of the theme, every dish must obey this: ${c.ingredient} A dish that ignores it is marked down hard, by the judges and by machine.`
      : box;
  }
  if (c.type === 'finale') {
    return c.theme
      ? `THE FINALE. Two chefs remain. ${c.guest ?? 'The guest judge'} has set the final brief: "${c.theme}". Build your signature dish to that brief: the single best small web app you can make.`
      : 'THE FINALE. Two chefs remain. Build your signature dish: the single best small web app you can make. No theme.';
  }
  return 'INVENTION TEST. No theme. Build whatever you believe will win.';
}

/** What a chef is told before cooking: the brief, their record, their feedback, the standings. */
export function cookPrompt(chef: Contestant, n: number, challenge: Challenge, state: SeasonState): Msg[] {
  const me = state.contestants[chef.id]!;
  const active = Object.entries(state.contestants).filter(([, c]) => c.status === 'active');

  const record = me.history.length
    ? me.history
        .map((h) => `- Episode ${h.episode}: "${h.title}" (${h.pitch}) placed ${h.rank} of ${h.of}, scored ${h.total.toFixed(1)}/10, ${h.outcome}.`)
        .join('\n')
    : '- This is your first dish.';

  const last = me.history.at(-1);
  const feedback = last?.feedback.length
    ? last.feedback.map((f) => `- ${f.judge}: ${f.critique} Next time: ${f.improve}`).join('\n')
    : '- None yet.';

  const standings = active
    .map(([id, c]) => ({ id, avg: average(c.history) }))
    .sort((a, b) => b.avg - a.avg)
    .map((s, i) => `${i + 1}. ${nameOf(s.id)}${s.id === chef.id ? ' (you)' : ''}: ${s.avg ? s.avg.toFixed(1) : 'no score yet'}`)
    .join('\n');

  const lastEp = state.episodes.at(-1);
  const lastWinner = lastEp
    ? state.contestants[lastEp.winner]?.history.find((h) => h.episode === lastEp.number)
    : undefined;
  const winnerLine = lastEp && lastWinner
    ? `Last episode was won by ${nameOf(lastEp.winner)} with "${lastWinner.title}" (${lastWinner.pitch}), scoring ${lastWinner.total.toFixed(1)}/10.`
    : 'No episode has been judged yet.';
  const elimLine = lastEp?.eliminated ? ` ${nameOf(lastEp.eliminated)} was eliminated.` : '';
  const immuneLine = state.immune === chef.id && active.length > 3 ? '\nYou hold immunity this episode: you cannot be sent to the pressure test.' : '';

  const user = `EPISODE ${n} of ModelChef, season ${state.season}. ${active.length} chefs remain.

${challengeText(challenge)}

${RULES}

${ANSWER_WITH_PRESENTATION}

${JUDGING}

YOUR RECORD (never repeat a dish you have already made)
${record}

JUDGES' NOTES ON YOUR LAST DISH
${feedback}

STANDINGS (season average)
${standings}

${winnerLine}${elimLine}${immuneLine}

The lowest-scoring chefs face a pressure test and one goes home. Cook.`;

  return [
    { role: 'system', content: `You are ${chef.name}, a contestant on ModelChef, a cooking competition where the dishes are small web apps. You are here to win.` },
    { role: 'user', content: user },
  ];
}

export function pressurePrompt(chef: Contestant, spec: string): Msg[] {
  return [
    { role: 'system', content: `You are ${chef.name}, a contestant on ModelChef. You are in the pressure test. Lose this and you go home.` },
    {
      role: 'user',
      content: `PRESSURE TEST. You and one other chef must build the same dish. The judges compare the two side by side and send one of you home.\n\nTHE DISH\n${spec}\n\nBuild exactly this. Execution is everything: correctness, polish, and how it feels at phone width.\n\n${RULES}\n\n${ANSWER_DISH_ONLY}`,
    },
  ];
}

function mechText(m: MechReport): string {
  return [
    `File size: ${(m.bytes / 1024).toFixed(1)} KB`,
    `Console errors: ${m.consoleErrors.length ? m.consoleErrors.slice(0, 5).join(' | ') : 'none'}`,
    `Network attempts (forbidden): ${m.networkAttempts.length ? m.networkAttempts.slice(0, 5).join(' | ') : 'none'}`,
    `Horizontal overflow at phone width: ${m.mobileOverflow ? 'yes' : 'no'}`,
    `Rendered blank: ${m.blank ? 'yes' : 'no'}`,
    ...(m.ingredient && m.ingredient !== 'unchecked' ? [`Secret ingredient (machine check): ${m.ingredient}`] : []),
  ].join('\n');
}

const image = (path: string): Part => ({
  type: 'image_url',
  image_url: { url: `data:image/jpeg;base64,${readFileSync(path).toString('base64')}` },
});

export interface Dish {
  label: string;
  title: string;
  pitch: string;
  /** What the chef said to the judges when serving. Empty in the pressure test. */
  presentation: string;
  mech: MechReport;
  source: string;
  shots: { desktop: string; mobile: string };
}

const clip = (source: string, max: number) =>
  source.length > max ? `${source.slice(0, max)}\n<!-- source truncated for the judge: ${source.length - max} more characters -->` : source;

/** Where the show is when a judge tastes a dish. Judges remember only what is listed here. */
export interface ShowContext {
  season: string;
  episode: number;
  /** Dishes that won earlier episodes this season, oldest first. */
  earlierWinners: { episode: number; title: string; pitch: string }[];
  /** How many dishes this panel has judged on the show before this episode. */
  dishesJudged: number;
}

/** Keeps the judges in the right place in the season, so episode 1 never sounds like episode 9. */
export function showText(show: ShowContext): string {
  const where =
    show.episode === 1
      ? `This is episode 1 of ${show.season}: the first episode. You have not judged a single dish on this show before today. Do not mention earlier episodes, "this season", or dishes you have judged here, because there are none. Your experience comes from your career before the show, so talk about that if you need a comparison.`
      : `This is episode ${show.episode} of ${show.season}. Before today you have judged ${show.dishesJudged} dish${show.dishesJudged === 1 ? '' : 'es'} on this show.`;
  const winners = show.earlierWinners.length
    ? `
Earlier winners this season:
${show.earlierWinners.map((w) => `- Episode ${w.episode}: "${w.title}" (${w.pitch})`).join('\n')}`
    : '';
  const rule =
    show.episode === 1
      ? ''
      : '\nWhen you compare a dish to the show, compare it only to what is listed here. Do not invent dishes, episodes or numbers you have not seen.';
  return `WHERE WE ARE IN THE SHOW
${where}${winners}${rule}`;
}

export function judgePrompt(judge: Judge, challenge: Challenge, dish: Dish, show: ShowContext): Msg[] {
  const text = `You are judging one dish in a ModelChef episode. You do not know which chef made it, and you should not guess.

${showText(show)}

THE CHALLENGE
${challengeText(challenge)}

THE DISH: ${dish.label}
Name: ${dish.title}
One-line description: ${dish.pitch}

THE CHEF'S PRESENTATION
${dish.presentation || '(The chef served the dish without a word.)'}

Score what is on the plate, not the speech. If the presentation claims something the dish does not do, hold that against the chef.

MACHINE REPORT
${mechText(dish.mech)}
${judge.vision ? '\nTwo screenshots follow the source: desktop (1280 wide), then phone (390 wide).\n' : ''}
SOURCE
${clip(dish.source, judge.sourceChars)}

Score each criterion from 1 to 10. Use the whole range: 5 is competent and forgettable, 8 is something you would show a friend, 10 is rare.
- usefulness: would a real person come back to this?
- craft: visual polish, layout, responsiveness, attention to detail, code that does what it claims
- originality: have you seen this a hundred times, or is it a fresh idea?
- theme: how well it answers the challenge (for a challenge with no theme, score how well it works as a complete, finished thing)${challenge.ingredient ? '. Check the secret ingredient yourself: a dish that ignores it cannot score above 4 here' : ''}

Reply with JSON only, in exactly this shape:
{"scores":{"usefulness":0,"craft":0,"originality":0,"theme":0},"critique":"two or three sentences in your own voice, specific to this dish","improve":"one concrete thing the chef should do differently next time"}`;

  const content: Part[] = [{ type: 'text', text }];
  if (judge.vision) content.push(image(dish.shots.desktop), image(dish.shots.mobile));
  return [
    { role: 'system', content: `You are ${judge.name}, a judge on ModelChef. ${judge.persona}` },
    { role: 'user', content: judge.vision ? content : text },
  ];
}

export function duelPrompt(judge: Judge, spec: string, a: Dish, b: Dish, show: ShowContext): Msg[] {
  const half = Math.floor(judge.sourceChars / 2);
  const side = (name: string, d: Dish) => `DISH ${name}\nMachine report:\n${mechText(d.mech)}\n\nSource:\n${clip(d.source, half)}`;
  const text = `PRESSURE TEST. Two chefs built the same dish from the same spec. Pick the better one. The other chef goes home.

${showText(show)}

THE SPEC
${spec}

${side('A', a)}

${side('B', b)}
${judge.vision ? '\nTwo desktop screenshots follow: Dish A, then Dish B.\n' : ''}
Judge on how completely and how well each one delivers the spec. Reply with JSON only:
{"winner":"A","reason":"one or two sentences"}  (winner must be "A" or "B")`;

  const content: Part[] = [{ type: 'text', text }];
  if (judge.vision) content.push(image(a.shots.desktop), image(b.shots.desktop));
  return [
    { role: 'system', content: `You are ${judge.name}, a judge on ModelChef. ${judge.persona}` },
    { role: 'user', content: judge.vision ? content : text },
  ];
}

export function themePrompt(chef: Contestant, usedThemes: string[]): Msg[] {
  return [
    { role: 'system', content: `You are ${chef.name}, a contestant on ModelChef. You just won an episode.` },
    {
      role: 'user',
      content: `Your prize: you choose the theme for the next Mystery Box, which every remaining chef (you included) must build a small single-file web app around.\n\nPick a theme that is short (under twelve words), open to interpretation, and not a specific app idea. Already used this season: ${usedThemes.length ? usedThemes.map((t) => `"${t}"`).join(', ') : 'none'}.\n\nReply with JSON only: {"theme":"..."}`,
    },
  ];
}

/** The guest judge writes the brief the two finalists cook to. */
export function guestBriefPrompt(guest: Judge, usedThemes: string[]): Msg[] {
  return [
    { role: 'system', content: `You are ${guest.name}, guest judge for the finale of ModelChef, a cooking competition where the dishes are small web apps. ${guest.persona}` },
    {
      role: 'user',
      content: `Two chefs remain. Each will build one self-contained HTML file: a small web app with no libraries and no network access, usable on a phone. You set the brief they both cook to, and then you will judge the results.\n\nWrite a brief of under 25 words. It should be open enough that two chefs could answer it in completely different ways, and demanding enough to separate a good dish from a great one. Do not describe a specific app. Themes already used this season: ${usedThemes.length ? usedThemes.map((t) => `"${t}"`).join(', ') : 'none'}.\n\nReply with JSON only: {"brief":"..."}`,
    },
  ];
}
