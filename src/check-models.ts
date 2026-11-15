// Pings every model in the roster so dead IDs and missing keys show up before
// an episode does. Run after editing src/config.ts: `pnpm check-models`.
import { CONTESTANTS, JUDGES, PROVIDERS, type ModelRef } from './config';
import { chat } from './llm';

const seen = new Map<string, { ref: ModelRef; usedBy: string[] }>();
for (const who of [...CONTESTANTS, ...JUDGES]) {
  for (const ref of who.models) {
    const key = `${ref.provider}/${ref.model}`;
    seen.set(key, { ref, usedBy: [...(seen.get(key)?.usedBy ?? []), who.id] });
  }
}

let failures = 0;
for (const [key, { ref, usedBy }] of seen) {
  const who = `(${usedBy.join(', ')})`;
  if (!process.env[PROVIDERS[ref.provider].keyEnv]) {
    console.log(`SKIP  ${key} ${who}: ${PROVIDERS[ref.provider].keyEnv} is not set`);
    continue;
  }
  try {
    await chat([ref], [{ role: 'user', content: 'Reply with the single word OK.' }], { maxTokens: 2000, kind: 'ping' });
    console.log(`OK    ${key} ${who}`);
  } catch (err) {
    failures++;
    console.log(`FAIL  ${key} ${who}: ${(err as Error).message.slice(0, 240)}`);
  }
}
process.exit(failures ? 1 : 0);
