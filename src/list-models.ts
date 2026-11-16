// Prints the model IDs each of your API keys can reach right now, so the
// roster in src/config.ts can be built from what exists instead of from
// memory. Models already in the roster are marked with a star.
//
// With no arguments it lists everything, but only the free models on
// OpenRouter. With search words it lists every model, paid included, whose ID
// contains one of them: `pnpm list-models claude gpt`.
import { CONTESTANTS, JUDGES, PROVIDERS, type ProviderId } from './config';

const search = process.argv.slice(2).map((s) => s.toLowerCase());

const inRoster = new Set([...CONTESTANTS, ...JUDGES].flatMap((w) => w.models.map((m) => `${m.provider}/${m.model}`)));

for (const [id, provider] of Object.entries(PROVIDERS) as [ProviderId, (typeof PROVIDERS)[ProviderId]][]) {
  const key = process.env[provider.keyEnv];
  console.log(`\n== ${id} ==`);
  if (!key) {
    console.log(`  ${provider.keyEnv} is not set`);
    continue;
  }
  try {
    const res = await fetch(`${provider.baseUrl}/models`, {
      headers: { authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text()).replace(/\s+/g, ' ').slice(0, 200)}`);
    const body = (await res.json()) as { data?: { id?: string }[] };
    let ids = (body.data ?? []).map((m) => String(m.id ?? '').replace(/^models\//, '')).filter(Boolean);
    // OpenRouter lists hundreds of paid models; only the free ones matter here.
    if (search.length) ids = ids.filter((m) => search.some((s) => m.toLowerCase().includes(s)));
    else if (id === 'openrouter') ids = ids.filter((m) => m.endsWith(':free'));
    if (!ids.length) console.log('  (no models returned)');
    for (const m of ids.sort()) console.log(`  ${inRoster.has(`${id}/${m}`) ? '*' : ' '} ${m}`);
  } catch (err) {
    console.log(`  failed: ${(err as Error).message}`);
  }
}

