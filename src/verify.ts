// `pnpm verify`: the automated part of every site PR's Definition of done.
// Unit tests (and at least one must run), typecheck, then the site built from
// data/ and from each committed fixture, with every link checked after each
// build. Manual viewport checks are still needed.
import { spawnSync } from 'node:child_process';

function run(label: string, cmd: string, args: string[], env: Record<string, string> = {}): string {
  console.log(`\n[verify] ${label}`);
  const res = spawnSync(cmd, args, { env: { ...process.env, ...env }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
  process.stdout.write(res.stdout ?? '');
  if (res.status !== 0) {
    console.error(`[verify] FAILED: ${label}`);
    process.exit(res.status ?? 1);
  }
  return res.stdout ?? '';
}

const tap = run('unit tests', 'pnpm', ['exec', 'tsx', '--test', '--test-reporter=tap', 'src/**/*.test.ts']);
const tests = Number(/^# tests (\d+)/m.exec(tap)?.[1] ?? 0);
if (!tests) {
  console.error('[verify] FAILED: the test run reported 0 tests. Check the test glob in package.json and src/verify.ts.');
  process.exit(1);
}

run('typecheck', 'pnpm', ['exec', 'tsc', '--noEmit']);

/** Each build wipes dist/, so links are checked right after it. */
const builds: { label: string; env: Record<string, string>; episodes?: number }[] = [
  { label: 'data/', env: {} },
  { label: 'test/fixtures/data/three-episodes', env: { DATA_DIR: 'test/fixtures/data/three-episodes' }, episodes: 3 },
  { label: 'test/fixtures/data/two-seasons', env: { DATA_DIR: 'test/fixtures/data/two-seasons' }, episodes: 4 },
  // Absolute share tags: check-links maps this origin back onto dist/.
  { label: 'three-episodes with SITE_URL', env: { DATA_DIR: 'test/fixtures/data/three-episodes', SITE_URL: 'https://example.test' }, episodes: 3 },
];
for (const b of builds) {
  run(`build: ${b.label}`, 'pnpm', ['exec', 'tsx', 'src/build-site.ts'], b.env);
  run(`check-links: ${b.label}`, 'pnpm', ['exec', 'tsx', 'src/check-links.ts', ...(b.episodes ? ['--expect-episodes', String(b.episodes)] : [])], b.env);
}

console.log(`\n[verify] OK: ${tests} tests, typecheck, ${builds.length} builds with links checked.`);
