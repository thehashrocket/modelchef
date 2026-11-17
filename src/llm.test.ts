import assert from 'node:assert/strict';
import { it } from 'node:test';
import { clipSentences, parseJson } from './llm';

const reply = '{"scores":{"usefulness":7,"craft":6,"originality":8,"theme":9},"critique":"Bold {plate}.","improve":"Fix it."}';

it('parseJson reads a bare reply, fenced replies and prose around it', () => {
  assert.equal(parseJson<{ critique: string }>(reply).critique, 'Bold {plate}.');
  assert.equal(parseJson<{ critique: string }>('```json\n' + reply + '\n```').critique, 'Bold {plate}.');
  assert.equal(parseJson<{ critique: string }>('Here you go: ' + reply + ' Thanks!').critique, 'Bold {plate}.');
});

it('parseJson keeps the first object when a second follows it, as before', () => {
  assert.equal(parseJson<{ a: number }>('{"a":1} {"a":2}').a, 1);
});

it('parseJson ignores a stray closing brace after the answer (what broke ep-01 under the old parser)', () => {
  assert.equal(parseJson<{ critique: string }>(reply + ' Final score above. }').critique, 'Bold {plate}.');
});

it('parseJson skips a malformed opening object and reads the next one', () => {
  assert.equal(parseJson<{ a: number }>('Scores {usefulness: 7} then {"a":3}').a, 3);
});

it('parseJson still fails on replies with no usable object', () => {
  assert.throws(() => parseJson('no json here'), /no JSON object/);
  assert.throws(() => parseJson('{"a": 1'), /not closed|JSON/);
});

it('clipSentences leaves short text alone and cuts long text at a sentence end', () => {
  assert.equal(clipSentences('  Short.  ', 600), 'Short.');
  const long = 'First sentence is here. Second one runs on and on. ' + 'x'.repeat(100);
  assert.equal(clipSentences(long, 60), 'First sentence is here. Second one runs on and on.');
  const noStop = 'word '.repeat(40);
  const cut = clipSentences(noStop, 50);
  assert.ok(cut.endsWith('…') && cut.length <= 50, cut);
});

it('chat reports that no provider answered when none could be called', async () => {
  const { chat, ChatError } = await import('./llm');
  const saved = { ...process.env };
  for (const k of ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GROQ_API_KEY', 'OPENROUTER_API_KEY', 'XAI_API_KEY']) delete process.env[k];
  delete process.env.MOCK;
  try {
    await assert.rejects(
      chat([{ provider: 'groq', model: 'x' }] as never, [{ role: 'user', content: 'hi' }], { maxTokens: 10, kind: 'ping', patienceMs: 600_000 }),
      (err: unknown) => err instanceof ChatError && err.answered === false,
    );
  } finally {
    Object.assign(process.env, saved);
  }
});
