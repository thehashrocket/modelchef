// Everything you are likely to tune lives in this file: the roster, the
// judges, the themes, and the scoring weights.
//
// Roster last checked against live `pnpm list-models` output on 2026-11-15.
// MODEL IDS GO STALE. Free tiers rename and retire models constantly.
// `pnpm list-models` prints what each of your keys can actually reach, and
// `pnpm check-models` pings every model named here. Run both before the first
// live run and whenever a chef starts forfeiting.

export type ProviderId = 'gemini' | 'groq' | 'openrouter' | 'xai';

/** Gemini, Groq and OpenRouter are free tiers; xAI is paid. All four speak the OpenAI chat-completions format. */
export const PROVIDERS: Record<ProviderId, { baseUrl: string; keyEnv: string }> = {
  gemini: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', keyEnv: 'GEMINI_API_KEY' },
  groq: { baseUrl: 'https://api.groq.com/openai/v1', keyEnv: 'GROQ_API_KEY' },
  openrouter: { baseUrl: 'https://openrouter.ai/api/v1', keyEnv: 'OPENROUTER_API_KEY' },
  xai: { baseUrl: 'https://api.x.ai/v1', keyEnv: 'XAI_API_KEY' },
};

export interface ModelRef {
  provider: ProviderId;
  model: string;
}

export interface Contestant {
  id: string;
  name: string;
  /** Lab that trained the model. A judge from the same family abstains. */
  family: string;
  /**
   * Tried in order. Fallbacks should be the SAME model on another host,
   * otherwise the contestant quietly becomes a different chef.
   */
  models: ModelRef[];
  /** Thinking models spend output budget on reasoning, so give them room. */
  maxTokens: number;
}

export type Lens = 'usefulness' | 'craft' | 'originality';

export interface Judge {
  id: string;
  name: string;
  family: string;
  /** This judge's own criterion counts double in their score. 'overall' weighs all four equally. */
  lens: Lens | 'overall';
  persona: string;
  /** Send screenshots. Costs image tokens; turn off for tight free tiers. */
  vision: boolean;
  /** How much of the source the judge reads. Lower it for small TPM limits. */
  sourceChars: number;
  models: ModelRef[];
}

export const SEASON = 'season-01';
export const DATA_DIR = process.env.DATA_DIR ?? 'data';

export const CONTESTANTS: Contestant[] = [
  {
    id: 'gemini-flash',
    name: 'Gemini 3.8 Flash',
    family: 'google',
    models: [{ provider: 'gemini', model: 'gemini-3.8-flash' }],
    maxTokens: 32000,
  },
  {
    id: 'gemma',
    name: 'Gemma 4 31B',
    family: 'google',
    models: [{ provider: 'gemini', model: 'gemma-4-31b-it' }],
    maxTokens: 16000,
  },
  {
    id: 'gpt-oss',
    name: 'GPT-OSS 120B',
    family: 'openai',
    models: [{ provider: 'groq', model: 'openai/gpt-oss-120b' }],
    maxTokens: 24000,
  },
  // Groq's free tier caps Qwen at 1,000 output tokens a minute, which cannot
  // fit an app, so the sixth seat went to an OpenRouter model instead.
  {
    id: 'ernie',
    name: 'ERNIE 5.5 Flash',
    family: 'baidu',
    models: [{ provider: 'openrouter', model: 'baidu/ernie-5.5-flash-preview:free' }],
    maxTokens: 16000,
  },
  {
    id: 'nemotron',
    name: 'Nemotron 3 Ultra',
    family: 'nvidia',
    models: [{ provider: 'openrouter', model: 'nvidia/nemotron-3-ultra-550b-a55b:free' }],
    maxTokens: 16000,
  },
  {
    id: 'cohere-north',
    name: 'Cohere North Mini Code',
    family: 'cohere',
    models: [{ provider: 'openrouter', model: 'cohere/north-mini-code:free' }],
    maxTokens: 16000,
  },
];

export const JUDGES: Judge[] = [
  {
    id: 'pragmatist',
    name: 'The Pragmatist',
    // No chef comes from this lab, so this judge scores every dish. (It ran on
    // Gemini in the pilot and had to sit out both Google chefs.)
    family: 'inclusionai',
    lens: 'usefulness',
    persona:
      'You run a small business and have no patience for demos. You ask one question of every dish: would a real person open this a second time? You are blunt, specific, and fair.',
    vision: false,
    sourceChars: 80000,
    // The fallback is another lab with no chef in the kitchen.
    models: [
      { provider: 'openrouter', model: 'inclusionai/ling-3.2-flash:free' },
      { provider: 'openrouter', model: 'dots-studio/dots-3-note-preview:free' },
    ],
  },
  {
    id: 'craftsman',
    name: 'The Craftsman',
    family: 'xai',
    lens: 'craft',
    persona:
      'You are a veteran front-end engineer and designer. You notice spacing, contrast, focus states, empty states, and what happens at phone width. Sloppy plating offends you; restraint impresses you.',
    vision: true,
    sourceChars: 80000,
    // The one paid seat on the panel. Judging is mostly reading, so it is cheap.
    models: [{ provider: 'xai', model: 'grok-4.5' }],
  },
  {
    id: 'maverick',
    name: 'The Maverick',
    family: 'nvidia',
    lens: 'originality',
    persona:
      'In your career you have seen ten thousand to-do lists and pomodoro timers and you are tired of them. You reward ideas you have not seen before and penalise anything that chases last week\'s winner. A flawed surprise beats a polished cliche.',
    vision: true,
    sourceChars: 30000,
    // A judge may fall back to a sibling model: the seat matters, not the exact weights.
    models: [
      { provider: 'openrouter', model: 'nvidia/nemotron-3.5-super-vl:free' },
      { provider: 'openrouter', model: 'nvidia/nemotron-3.5-lightning:free' },
    ],
  },
];

/**
 * The Finale's guest judge: a frontier model that sets the final brief and
 * scores both finalists alongside the regular panel. Paid, via OpenRouter
 * credits, but it only ever reads two dishes. Leave as null for no guest.
 *
 * Pick a lab with no chef in the kitchen: a guest who shares a family with a
 * finalist still sets the brief but does not score, because scoring one
 * finalist and not the other would decide the season.
 * Find the exact model ID with `pnpm list-models <name>`, e.g. `pnpm list-models claude`.
 */
export const GUEST_JUDGE: Judge | null = {
  id: 'guest',
  name: 'Claude Opus 5.5',
  // Anthropic has no chef in the kitchen, so this guest can score any finalist.
  family: 'anthropic',
  lens: 'overall',
  persona:
    'You are the guest of honour at the finale. You have tasted the best there is and you are generous with praise only when it is earned. You judge the whole plate: idea, execution, and whether it answers the brief you set.',
  vision: true,
  sourceChars: 60000,
  // A fixed version on purpose: the "-latest" aliases change underneath you,
  // and the ":batch" variants do not answer in real time.
  models: [{ provider: 'openrouter', model: 'anthropic/claude-opus-5.5' }],
};

export interface SecretIngredient {
  id: string;
  /** Told to the chefs and the judges, word for word. */
  text: string;
  /** Optional machine check. Returns false when the ingredient is plainly missing. */
  test?: (html: string, bytes: number) => boolean;
}

/** Mystery Box episodes add one of these on top of the theme, never repeating within a season. */
export const SECRET_INGREDIENTS: SecretIngredient[] = [
  { id: 'sound', text: 'Sound. The dish must make sound using the Web Audio API (no audio files), and sound must matter to how it works.', test: (html) => /AudioContext/.test(html) },
  { id: 'canvas', text: 'Canvas only. Everything the user sees must be drawn on a single <canvas> element: no HTML buttons, inputs, or text outside it.', test: (html) => /<canvas/i.test(html) },
  { id: 'tiny', text: 'Tiny kitchen. The whole file must be under 8 KB (8,192 bytes).', test: (_html, bytes) => bytes <= 8192 },
  { id: 'drag', text: 'Hands on. The main interaction must be dragging things with a mouse or finger.', test: (html) => /pointermove|mousemove|touchmove|dragstart/i.test(html) },
  { id: 'keyboard', text: 'No mouse. The dish must be fully usable from the keyboard alone, and must show the keys on screen.', test: (html) => /keydown|keyup/i.test(html) },
  { id: 'wordless', text: 'No words. Apart from numbers, the dish may show no text at all: everything must be communicated with shape, colour, and motion.' },
  { id: 'one-colour', text: 'One colour. The dish may use a single hue plus black, white, and greys.' },
];

/** First episode that uses a secret ingredient. Season 1 introduced the twist in episode 3. */
export const SECRET_INGREDIENT_FROM_EPISODE = 3;

/** Used for Mystery Box episodes until a winner has chosen one. */
export const MYSTERY_THEMES = [
  'Something for a kitchen',
  'A tool for one specific profession',
  'Time, but not a clock, timer, or calendar',
  'Sound you can see',
  'A game with exactly one rule',
  'Something a ten-year-old would show their friends',
];

/** Pressure Test: both chefs build this exact spec. One is picked at random. */
export const PRESSURE_SPECS = [
  'A unit converter covering length, weight, temperature, and volume, with a swap button and a history of the last ten conversions.',
  'A tip and bill splitter: bill amount, tip percentage, number of people, per-person rounding, and a way to mark who has paid.',
  'A colour palette builder: pick a base colour, generate five harmonious colours, show hex and HSL, click any swatch to copy.',
  'A countdown board that tracks up to six named countdowns to dates the user enters, sorted by soonest.',
  'A markdown previewer with a split pane, live rendering of headings, lists, emphasis, links and code blocks, and a word count.',
];

export const SCORING = {
  /** Final score = judges * judgeWeight + mechanical * mechanicalWeight. Both are 0-10. */
  judgeWeight: 0.8,
  mechanicalWeight: 0.2,
};
