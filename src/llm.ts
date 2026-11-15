import { PROVIDERS, type ModelRef } from './config';
import { mockChat } from './mock';

export type Part =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export interface Msg {
  role: 'system' | 'user';
  content: string | Part[];
}

export interface ChatOpts {
  maxTokens: number;
  temperature?: number;
  /** Only used to route mock responses and label logs. */
  kind: 'cook' | 'judge' | 'duel' | 'theme' | 'ping';
  tag?: string;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Free tiers are requests-per-minute limited, and nobody is waiting on this
// job, so space calls to each provider well apart instead of racing 429s.
const MIN_GAP_MS = Number(process.env.PACE_MS ?? 13_000);
const lastCall = new Map<string, number>();

async function pace(provider: string) {
  const wait = (lastCall.get(provider) ?? 0) + MIN_GAP_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastCall.set(provider, Date.now());
}

/**
 * Calls the first model that answers. Retries rate limits and server errors,
 * then falls through to the next model in the list. Throws if none answer.
 */
export async function chat(
  models: ModelRef[],
  messages: Msg[],
  opts: ChatOpts,
): Promise<{ text: string; used: ModelRef; stop: string }> {
  if (process.env.MOCK) return { text: mockChat(messages, opts), used: models[0]!, stop: 'stop' };

  const errors: string[] = [];
  for (const ref of models) {
    const provider = PROVIDERS[ref.provider];
    const key = process.env[provider.keyEnv];
    if (!key) {
      errors.push(`${ref.provider}: ${provider.keyEnv} is not set`);
      continue;
    }
    for (let attempt = 1; attempt <= 3; attempt++) {
      await pace(ref.provider);
      try {
        const res = await fetch(`${provider.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            model: ref.model,
            messages,
            max_tokens: opts.maxTokens,
            temperature: opts.temperature ?? 0.8,
          }),
          signal: AbortSignal.timeout(300_000),
        });
        if (res.ok) {
          const data = (await res.json()) as { choices?: { finish_reason?: string; message?: { content?: unknown } }[] };
          const choice = data.choices?.[0];
          const text = choice?.message?.content;
          // `stop` says why the model stopped: "length" means it hit max_tokens.
          const stop = String(choice?.finish_reason ?? 'unknown');
          if (typeof text === 'string' && text.trim()) return { text, used: ref, stop };
          // An empty reply is usually a blip, or a thinking model that spent its
          // whole budget before writing anything. Worth another attempt.
          errors.push(`${ref.provider}/${ref.model}: empty reply (stop reason: ${stop})`);
          await sleep(attempt * 5_000);
          continue;
        }
        const body = (await res.text()).replace(/\s+/g, ' ').slice(0, 300);
        errors.push(`${ref.provider}/${ref.model}: HTTP ${res.status} ${body}`);
        if (res.status !== 429 && res.status < 500) break;
        const retryAfter = Number(res.headers.get('retry-after'));
        const backoff = retryAfter > 0 ? retryAfter * 1000 : attempt * 20_000;
        await sleep(Math.min(backoff, 90_000));
      } catch (err) {
        errors.push(`${ref.provider}/${ref.model}: ${(err as Error).message}`);
        await sleep(attempt * 5_000);
      }
    }
  }
  throw new Error(errors.join(' | ') || 'no models configured');
}

/** Pulls the first JSON object out of a reply that may be wrapped in prose or fences. */
export function parseJson<T>(text: string): T {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('no JSON object in reply');
  return JSON.parse(text.slice(start, end + 1)) as T;
}

/**
 * Pulls a complete HTML document out of a model reply. Returns null when the
 * reply has no document or the document was cut off, which is a forfeit.
 */
export function extractHtml(text: string): string | null {
  const start = text.search(/<!doctype html|<html[\s>]/i);
  const end = text.toLowerCase().lastIndexOf('</html>');
  if (start < 0 || end < start) return null;
  return text.slice(start, end + '</html>'.length) + '\n';
}
