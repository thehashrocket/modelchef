// Everything you are likely to tune lives in this file: the roster, the
// judges, the themes, and the scoring weights.
//
// MODEL IDS GO STALE. Free tiers rename and retire models constantly. Run
// `pnpm check-models` after editing this file and before the first live run.

export type ProviderId = 'gemini' | 'groq' | 'mistral' | 'openrouter';

/** All four speak the OpenAI chat-completions format. */
export const PROVIDERS: Record<ProviderId, { baseUrl: string; keyEnv: string }> = {
  gemini: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', keyEnv: 'GEMINI_API_KEY' },
  groq: { baseUrl: 'https://api.groq.com/openai/v1', keyEnv: 'GROQ_API_KEY' },
  mistral: { baseUrl: 'https://api.mistral.ai/v1', keyEnv: 'MISTRAL_API_KEY' },
  openrouter: { baseUrl: 'https://openrouter.ai/api/v1', keyEnv: 'OPENROUTER_API_KEY' },
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
  /** This judge's own criterion counts double in their score. */
  lens: Lens;
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
    name: 'Gemini 2.5 Flash',
    family: 'google',
    models: [{ provider: 'gemini', model: 'gemini-2.5-flash' }],
    maxTokens: 32000,
  },
  {
    id: 'llama',
    name: 'Llama 3.3 70B',
    family: 'meta',
    models: [
      { provider: 'groq', model: 'llama-3.3-70b-versatile' },
      { provider: 'openrouter', model: 'meta-llama/llama-3.3-70b-instruct:free' },
    ],
    maxTokens: 16000,
  },
  {
    id: 'gpt-oss',
    name: 'GPT-OSS 120B',
    family: 'openai',
    models: [
      { provider: 'groq', model: 'openai/gpt-oss-120b' },
      { provider: 'openrouter', model: 'openai/gpt-oss-120b:free' },
    ],
    maxTokens: 24000,
  },
  {
    id: 'mistral-large',
    name: 'Mistral Large',
    family: 'mistral',
    models: [{ provider: 'mistral', model: 'mistral-large-latest' }],
    maxTokens: 16000,
  },
  {
    id: 'qwen-coder',
    name: 'Qwen3 Coder',
    family: 'alibaba',
    models: [{ provider: 'openrouter', model: 'qwen/qwen3-coder:free' }],
    maxTokens: 16000,
  },
  {
    id: 'kimi',
    name: 'Kimi K2',
    family: 'moonshot',
    models: [
      { provider: 'groq', model: 'moonshotai/kimi-k2-instruct-0905' },
      { provider: 'openrouter', model: 'moonshotai/kimi-k2:free' },
    ],
    maxTokens: 16000,
  },
];

export const JUDGES: Judge[] = [
  {
    id: 'pragmatist',
    name: 'The Pragmatist',
    family: 'google',
    lens: 'usefulness',
    persona:
      'You run a small business and have no patience for demos. You ask one question of every dish: would a real person open this a second time? You are blunt, specific, and fair.',
    vision: true,
    sourceChars: 60000,
    models: [{ provider: 'gemini', model: 'gemini-2.5-pro' }],
  },
  {
    id: 'craftsman',
    name: 'The Craftsman',
    family: 'mistral',
    lens: 'craft',
    persona:
      'You are a veteran front-end engineer and designer. You notice spacing, contrast, focus states, empty states, and what happens at phone width. Sloppy plating offends you; restraint impresses you.',
    vision: true,
    sourceChars: 40000,
    models: [{ provider: 'mistral', model: 'mistral-medium-latest' }],
  },
  {
    id: 'maverick',
    name: 'The Maverick',
    family: 'meta',
    lens: 'originality',
    persona:
      'You have seen ten thousand to-do lists and pomodoro timers and you are tired. You reward ideas you have not seen before and penalise anything that chases last week\'s winner. A flawed surprise beats a polished cliche.',
    vision: false,
    sourceChars: 16000,
    models: [{ provider: 'groq', model: 'llama-3.3-70b-versatile' }],
  },
];

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
