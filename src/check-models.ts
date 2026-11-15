// Pings every model in the roster with the same output budget an episode
// uses, so dead IDs, missing keys and too-large max_tokens values show up
// before an episode does. Run after editing src/config.ts: `pnpm check-models`.
import { CONTESTANTS, JUDGES, PROVIDERS, type ModelRef } from './config';
import { chat } from './llm';

/** Judges are always called with this budget (see episode.ts). */
const JUDGE_MAX_TOKENS = 8000;

const checks = new Map<string, { ref: ModelRef; maxTokens: number; usedBy: string[] }>();
const add = (who: string, ref: ModelRef, maxTokens: number) => {
  const key = `${ref.provider}/${ref.model}`;
  const prev = checks.get(key);
  checks.set(key, { ref, maxTokens: Math.max(maxTokens, prev?.maxTokens ?? 0), usedBy: [...(prev?.usedBy ?? []), who] });
};
for (const c of CONTESTANTS) for (const ref of c.models) add(c.id, ref, c.maxTokens);
for (const j of JUDGES) for (const ref of j.models) add(j.id, ref, JUDGE_MAX_TOKENS);

// Extra arguments are tried as chef candidates, e.g.
//   pnpm check-models openrouter/some-lab/some-model:free
for (const arg of process.argv.slice(2)) {
  const slash = arg.indexOf('/');
  const provider = arg.slice(0, slash);
  if (slash < 1 || !(provider in PROVIDERS)) {
    console.log(`SKIP  ${arg}: write candidates as provider/model, with provider one of ${Object.keys(PROVIDERS).join(', ')}`);
    continue;
  }
  add('candidate', { provider: provider as keyof typeof PROVIDERS, model: arg.slice(slash + 1) }, 16000);
}

let failures = 0;
for (const [key, { ref, maxTokens, usedBy }] of checks) {
  const who = `(${usedBy.join(', ')}, max_tokens ${maxTokens})`;
  if (!process.env[PROVIDERS[ref.provider].keyEnv]) {
    console.log(`SKIP  ${key} ${who}: ${PROVIDERS[ref.provider].keyEnv} is not set`);
    continue;
  }
  try {
    await chat([ref], [{ role: 'user', content: 'Reply with the single word OK.' }], { maxTokens, kind: 'ping' });
    console.log(`OK    ${key} ${who}`);
  } catch (err) {
    failures++;
    console.log(`FAIL  ${key} ${who}: ${(err as Error).message.slice(0, 400)}`);
  }
}
process.exit(failures ? 1 : 0);
