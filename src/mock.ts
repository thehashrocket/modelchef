// Canned responses so the whole pipeline can run with `MOCK=1` and no API
// keys. Set MOCK_FORFEIT=<contestant id> to make that chef return junk.
import type { ChatOpts, Msg } from './llm';

const NOUNS = ['Orbit', 'Ledger', 'Tide', 'Loom', 'Prism', 'Kettle', 'Atlas', 'Ember'];
const pick = <T>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)]!;
const score = () => 4 + Math.floor(Math.random() * 6);

function app(tag: string): string {
  const title = `${pick(NOUNS)} ${pick(['Board', 'Lab', 'Pad', 'Deck'])}`;
  const hue = Math.floor(Math.random() * 360);
  // One mock chef breaks the rules so the mechanical checks get exercised.
  const sloppy =
    tag === 'ernie'
      ? `fetch('https://example.com/data.json').catch(()=>{}); console.error('mock: something broke');`
      : '';
  return `<presentation>Judges, today I have made you ${title}. I chose it because clicking is universal. After your last notes, I made the button a different colour.</presentation>
\`\`\`html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="description" content="A mock dish from ${tag} that counts clicks.">
<style>
  body{font-family:system-ui;margin:0;min-height:100vh;display:grid;place-items:center;background:hsl(${hue} 40% 14%);color:#fff}
  main{text-align:center;padding:2rem}
  button{font-size:1.25rem;padding:.75rem 1.5rem;border:0;border-radius:.5rem;background:hsl(${hue} 80% 60%);cursor:pointer}
</style>
</head>
<body>
<main><h1>${title}</h1><p>Clicks: <span id="n">0</span></p><button id="b">Click</button></main>
<script>
  let n=0; document.getElementById('b').onclick=()=>{document.getElementById('n').textContent=++n};
  ${sloppy}
</script>
</body>
</html>
\`\`\``;
}

// MOCK_GUEST_FAIL targets only the finale guest: "brief" fails its brief (every
// attempt), "one-dish" fails its judging of whichever finalist it sees second,
// "balance" is read by episode.ts's mock credit reader.
let guestFirstChef: string | null = null;

export function mockChat(_messages: Msg[], opts: ChatOpts): string {
  const knob = process.env.MOCK_GUEST_FAIL;
  if (opts.kind === 'brief' && knob === 'brief') throw new Error('mock: the guest brief failed');
  if (opts.kind === 'judge' && knob === 'one-dish' && opts.tag?.startsWith('guest:')) {
    const chef = opts.tag.slice('guest:'.length);
    guestFirstChef ??= chef;
    if (chef !== guestFirstChef) throw new Error('mock: the guest could not judge this dish');
  }
  switch (opts.kind) {
    case 'brief':
      return JSON.stringify({ brief: `Mock finale brief about ${pick(NOUNS).toLowerCase()}s`, theme: 'Mock finale theme' });
    case 'cook':
      return opts.tag === process.env.MOCK_FORFEIT ? 'I would rather not cook today.' : app(opts.tag ?? 'chef');
    case 'judge':
      return JSON.stringify({
        scores: { usefulness: score(), craft: score(), originality: score(), theme: score() },
        critique: 'Mock critique: it counts clicks, and it does so with conviction.',
        improve: 'Mock suggestion: give the user a reason to click.',
      });
    case 'duel':
      return JSON.stringify({ winner: pick(['A', 'B']), reason: 'Mock reason: cleaner plate.' });
    case 'theme':
      return JSON.stringify({ theme: `Mock theme about ${pick(NOUNS).toLowerCase()}s` });
    default:
      return 'OK';
  }
}
