// `pnpm verify`: the automated part of every site PR's Definition of done.
// Unit tests (and at least one must run), typecheck, the real build, then a
// build of each committed fixture. Manual viewport checks are still needed.
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
run('build: data/', 'pnpm', ['exec', 'tsx', 'src/build-site.ts']);

const FIXTURES = ['three-episodes'];
for (const name of FIXTURES) {
  run(`build: test/fixtures/data/${name}`, 'pnpm', ['exec', 'tsx', 'src/build-site.ts'], { DATA_DIR: `test/fixtures/data/${name}` });
}

console.log(`\n[verify] OK: ${tests} tests, typecheck, real build, ${FIXTURES.length} fixture build(s).`);
