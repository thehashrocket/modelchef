import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONTESTANTS, DATA_DIR, SEASON, type Lens } from './config';

export type EpisodeType = 'mystery-box' | 'invention' | 'finale';
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
  lens: Lens;
  scores: Scores;
  /** This judge's 0-10 score with their lens counted double. */
  weighted: number;
  critique: string;
  improve: string;
}

export interface MechReport {
  bytes: number;
  consoleErrors: string[];
  networkAttempts: string[];
  mobileOverflow: boolean;
  blank: boolean;
  hasTitle: boolean;
  hasDescription: boolean;
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
  abstained: { judge: string; reason: string }[];
  judgeAvg: number;
  total: number;
  rank: number;
}

export interface DuelVote {
  judge: string;
  judgeName: string;
  winner: string | null;
  reason: string;
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
  episodes: { number: number; date: string; type: EpisodeType; theme: string | null; winner: string; eliminated: string | null }[];
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
