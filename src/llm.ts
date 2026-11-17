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
  kind: 'cook' | 'judge' | 'duel' | 'theme' | 'brief' | 'ping';
  /** Mock routing: a chef id, or "<judgeId>:<chefId>" on judge and duel calls. */
  tag?: string;
  /** Cancels the call, including its retries and backoff waits (the finale guest's time budget). */
  signal?: AbortSignal;
}

export interface ChatResult {
  text: string;
  /** The model that answered: the first in the list unless it failed. */
  used: ModelRef;
  stop: string;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A backoff wait that ends early, with the abort reason, when `signal` fires. */
function wait(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) return sleep(ms) as Promise<void>;
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(signal.reason);
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

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
): Promise<ChatResult> {
  // MOCK_FALLBACK=1 answers from the second model in the list, to exercise fallbacks without keys.
  if (process.env.MOCK) {
    opts.signal?.throwIfAborted();
    return { text: mockChat(messages, opts), used: (process.env.MOCK_FALLBACK && models[1]) || models[0]!, stop: 'stop' };
  }
  const signal = opts.signal;

  const errors: string[] = [];
  for (const ref of models) {
    const provider = PROVIDERS[ref.provider];
    const key = process.env[provider.keyEnv];
    if (!key) {
      errors.push(`${ref.provider}: ${provider.keyEnv} is not set`);
      continue;
    }
    for (let attempt = 1; attempt <= 3; attempt++) {
      signal?.throwIfAborted();
      await pace(ref.provider);
      signal?.throwIfAborted();
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
          signal: signal ? AbortSignal.any([AbortSignal.timeout(300_000), signal]) : AbortSignal.timeout(300_000),
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
          await wait(attempt * 5_000, signal);
          continue;
        }
        const body = (await res.text()).replace(/\s+/g, ' ').slice(0, 300);
        errors.push(`${ref.provider}/${ref.model}: HTTP ${res.status} ${body}`);
        if (res.status !== 429 && res.status < 500) break;
        const retryAfter = Number(res.headers.get('retry-after'));
        const backoff = retryAfter > 0 ? retryAfter * 1000 : attempt * 20_000;
        await wait(Math.min(backoff, 90_000), signal);
      } catch (err) {
        // Out of budget: stop now, with no more retries or fallbacks.
        if (signal?.aborted) throw new Error(`stopped: ${String((signal.reason as Error)?.message ?? signal.reason)} (${errors.join(' | ') || 'no reply yet'})`);
        errors.push(`${ref.provider}/${ref.model}: ${(err as Error).message}`);
        await wait(attempt * 5_000, signal);
      }
    }
  }
  throw new Error(errors.join(' | ') || 'no models configured');
}

/** Index of the brace that closes the object opening at `start`, or -1. Skips braces inside strings. */
function closingBrace(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === '\\') i++;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return i;
  }
  return -1;
}

/**
 * Pulls the first JSON object out of a reply that may be wrapped in prose or fences.
 * A reply that parsed before still parses to the same object: the fallbacks only run
 * where the first candidate fails, so they can rescue a reply but never change one.
 */
export function parseJson<T>(text: string): T {
  let start = text.indexOf('{');
  if (start < 0) throw new Error('no JSON object in reply');
  let firstError: Error | null = null;
  // Try the first balanced object; if it will not parse, try the next opening brace.
  while (start >= 0) {
    const end = closingBrace(text, start);
    const candidate = end < 0 ? text.slice(start) : text.slice(start, end + 1);
    try {
      return JSON.parse(candidate) as T;
    } catch (err) {
      firstError ??= end < 0 ? new Error('JSON object in reply is not closed') : (err as Error);
    }
    start = text.indexOf('{', start + 1);
  }
  throw firstError!;
}

/**
 * Shortens text to at most `max` characters, ending at the last full sentence that fits.
 * Falls back to the last word break plus an ellipsis when not even one sentence fits.
 */
export function clipSentences(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  const head = t.slice(0, max);
  const ends = [...head.matchAll(/[.!?…]["'”’)\]]*(?=\s|$)/g)];
  const last = ends.at(-1);
  if (last && last.index! + last[0].length >= max / 3) return head.slice(0, last.index! + last[0].length);
  const space = head.lastIndexOf(' ', max - 1);
  return `${head.slice(0, space > max / 2 ? space : max - 1).trimEnd()}…`;
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
