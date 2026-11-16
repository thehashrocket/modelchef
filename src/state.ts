import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONTESTANTS, DATA_DIR, SEASON, type Lens } from './config';

export type IngredientCheck = 'present' | 'missing' | 'unchecked';

export type EpisodeType = 'mystery-box' | 'invention' | 'finale';
export const TYPE_LABEL: Record<EpisodeType, string> = { 'mystery-box': 'Mystery Box', invention: 'Invention Test', finale: 'Finale' };

/** A folder named "pilot" is a trial run: shown on the site, never counted. */
export const isPilot = (season: string) => season === 'pilot';
/** "season-01" → "Season 1". */
export const seasonLabel = (season: string) => {
  if (isPilot(season)) return 'Pilot';
  const m = /^season-0*(\d+)$/.exec(season);
  return m ? `Season ${m[1]}` : season;
};
export type Outcome = 'won' | 'safe' | 'survived the pressure test' | 'eliminated';

export interface Scores {
  usefulness: number;
  craft: number;
  originality: number;
  theme: number;
}

export interface JudgeScore {
  judge: string;
  judgeName: string;
  lens: Lens | 'overall';
  scores: Scores;
  /** This judge's 0-10 score with their lens counted double. */
  weighted: number;
  critique: string;
  improve: string;
  /** The model that answered, as "<provider>/<model>". Absent in records made before it was kept. */
  model?: string;
}

export interface MechReport {
  bytes: number;
  consoleErrors: string[];
  networkAttempts: string[];
  mobileOverflow: boolean;
  blank: boolean;
  hasTitle: boolean;
  hasDescription: boolean;
  /** Result of the secret ingredient's machine check, when the episode has one. */
  ingredient?: IngredientCheck;
  /** 0-10 */
  score: number;
}

export interface Entry {
  contestant: string;
  /** Anonymous label the judges see, e.g. "Dish C". */
  label: string;
  model: string | null;
  forfeit: string | null;
  title: string;
  pitch: string;
  /** The chef's own words to the judges. */
  presentation: string;
  mech: MechReport | null;
  judges: JudgeScore[];
  /** Judges who sat this one out and why. */
  abstained: Abstention[];
  judgeAvg: number;
  total: number;
  rank: number;
}

export interface Abstention {
  judge: string;
  /** The judge's name when it sat out. Absent in older records. */
  judgeName?: string;
  reason: string;
  /** Set when a model replied but the reply could not be used. */
  model?: string;
}

/** Why a judge sits out a dish from its own lab. The site recognises this text. */
export const SAME_FAMILY_REASON = 'Same model family as the chef.';
/** Why neither finalist's guest score counts when the guest could score only one of them. */
export const GUEST_UNEVEN_REASON = 'Guest judge could not score both finalists, so neither guest score counts.';

export interface DuelVote {
  judge: string;
  judgeName: string;
  winner: string | null;
  reason: string;
  /** The model that answered, when one did. */
  model?: string;
  /** Chef ids in the order this judge saw them: [Dish A, Dish B]. */
  order?: [string, string];
}

export interface PressureTest {
  spec: string;
  chefs: string[];
  forfeits: Record<string, string>;
  votes: DuelVote[];
  eliminated: string;
  decidedBy: 'votes' | 'forfeit' | 'main-round score';
}

export interface Episode {
  number: number;
  date: string;
  type: EpisodeType;
  theme: string | null;
  themeChosenBy: string | null;
  /** Mystery Box twist: a required element on top of the theme. */
  ingredient?: { id: string; text: string } | null;
  /** The challenge exactly as the chefs were given it. */
  brief?: string;
  /** Name of the Finale's guest judge, when there was one. */
  guestJudge?: string | null;
  /** The model that wrote the guest's brief, when it did. */
  guestBriefModel?: string | null;
  immune: string | null;
  entries: Entry[];
  winner: string;
  pressure: PressureTest | null;
  eliminated: string | null;
}

export interface HistoryItem {
  episode: number;
  type: EpisodeType;
  theme: string | null;
  title: string;
  pitch: string;
  rank: number;
  of: number;
  total: number;
  outcome: Outcome;
  feedback: { judge: string; critique: string; improve: string }[];
}

export interface SeasonState {
  season: string;
  contestants: Record<string, { status: 'active' | 'eliminated' | 'champion'; eliminatedIn: number | null; history: HistoryItem[] }>;
  episodes: { number: number; date: string; type: EpisodeType; theme: string | null; ingredient?: string | null; winner: string; eliminated: string | null }[];
  /** Safe from elimination in the next episode. */
  immune: string | null;
  nextTheme: { theme: string; chosenBy: string } | null;
  champion: string | null;
}

export const seasonDir = () => join(DATA_DIR, SEASON);
export const episodeDir = (n: number) => join(seasonDir(), `ep-${String(n).padStart(2, '0')}`);
const statePath = () => join(seasonDir(), 'state.json');

export function loadState(): SeasonState {
  if (existsSync(statePath())) return JSON.parse(readFileSync(statePath(), 'utf8')) as SeasonState;
  return {
    season: SEASON,
    contestants: Object.fromEntries(
      CONTESTANTS.map((c) => [c.id, { status: 'active' as const, eliminatedIn: null, history: [] }]),
    ),
    episodes: [],
    immune: null,
    nextTheme: null,
    champion: null,
  };
}

export function writeJson(path: string, value: unknown) {
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
}

export function saveState(state: SeasonState) {
  mkdirSync(seasonDir(), { recursive: true });
  writeJson(statePath(), state);
}

export function loadEpisode(n: number): Episode {
  return JSON.parse(readFileSync(join(episodeDir(n), 'episode.json'), 'utf8')) as Episode;
}

/** Mean total across the episodes a chef has cooked in. */
export function average(history: HistoryItem[]): number {
  if (!history.length) return 0;
  return history.reduce((sum, h) => sum + h.total, 0) / history.length;
}
