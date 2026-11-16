// Pings every model in the roster with the same output budget an episode
// uses, so dead IDs, missing keys and too-large max_tokens values show up
// before an episode does. Run after editing src/config.ts: `pnpm check-models`.
// A model skipped for a missing key fails the check unless --allow-skip is given.
import { CONTESTANTS, GUEST_JUDGE, JUDGES, PROVIDERS, type ModelRef } from './config';
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
for (const j of [...JUDGES, ...(GUEST_JUDGE ? [GUEST_JUDGE] : [])]) for (const ref of j.models) add(j.id, ref, JUDGE_MAX_TOKENS);

// Extra arguments are tried as chef candidates, e.g.
//   pnpm check-models openrouter/some-lab/some-model:free
const args = process.argv.slice(2);
const allowSkip = args.includes('--allow-skip');
for (const arg of args.filter((a) => a !== '--allow-skip')) {
  const slash = arg.indexOf('/');
  const provider = arg.slice(0, slash);
  if (slash < 1 || !(provider in PROVIDERS)) {
    console.log(`SKIP  ${arg}: write candidates as provider/model, with provider one of ${Object.keys(PROVIDERS).join(', ')}`);
    continue;
  }
  add('candidate', { provider: provider as keyof typeof PROVIDERS, model: arg.slice(slash + 1) }, 16000);
}

let failures = 0;
let skipped = 0;
let passed = 0;
for (const [key, { ref, maxTokens, usedBy }] of checks) {
  const who = `(${usedBy.join(', ')}, max_tokens ${maxTokens})`;
  const keyEnv = PROVIDERS[ref.provider].keyEnv;
  if (!process.env[keyEnv]) {
    skipped++;
    console.log(`SKIP  ${key} ${who}: ${keyEnv} is not set. Set ${keyEnv} in .env to check it.`);
    continue;
  }
  try {
    await chat([ref], [{ role: 'user', content: 'Reply with the single word OK.' }], { maxTokens, kind: 'ping' });
    passed++;
    console.log(`OK    ${key} ${who}`);
  } catch (err) {
    failures++;
    console.log(`FAIL  ${key} ${who}: ${(err as Error).message.slice(0, 400)}`);
  }
}
console.log(`checked ${checks.size}, passed ${passed}, failed ${failures}, skipped ${skipped}`);
if (skipped && !allowSkip) console.log('Skipped models were not checked. Set the missing keys, or pass --allow-skip to accept that.');
process.exit(failures || (skipped && !allowSkip) ? 1 : 0);
