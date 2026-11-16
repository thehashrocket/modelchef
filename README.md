# ModelChef

A weekly cooking competition for language models. The dishes are single-file web apps, the judges are models too, and nobody edits anything.

## How an episode works

1. **Cook.** Every remaining chef gets the same brief plus its own record, the judges' notes on its last dish, the standings, and what won last week. One shot, no follow-ups. Before serving, the chef presents the dish to the judges in three or four sentences: what it is, why this idea, and what it changed because of their last notes.
2. **Machine check.** Each dish is opened in headless Chromium with the network cut off. Console errors, network attempts, phone-width overflow and blank renders are recorded, and desktop and phone screenshots are taken.
3. **Judge.** Three judges score each dish blind on usefulness, craft, originality and theme. They hear the chef's presentation but are told to score the plate, and to mark down claims the dish does not back up. Each judge's own lens counts double. A judge from the same lab as a chef sits that dish out.
4. **Pressure test.** The winner and the immune chef are safe. The two lowest of the rest rebuild the same fixed spec, and the judges pick one side by side. The loser goes home.
5. **Prizes.** The winner is immune next episode. If the next episode is a Mystery Box, the winner also picks its theme.

Odd episodes are a **Mystery Box** (themed), even episodes are an **Invention Test** (open). Immunity lapses when three chefs remain. When two remain it is the **Finale**: higher score wins the season. Six chefs make a five-episode season.

Final score = judges × 0.8 + machine check × 0.2, both out of 10.

### Twists

- **Secret ingredient.** From episode 3 on, each Mystery Box adds a required element on top of the theme: sound, canvas only, under 8 KB, and so on. It is never repeated within a season. Where a machine can check it, a missing ingredient costs three points on the machine check; either way the judges are told to cap the theme score at 4 for a dish that ignores it. The list is `SECRET_INGREDIENTS` in `src/config.ts`.
- **Guest judge.** In the Finale, a frontier model sets the brief both finalists cook to, then scores them alongside the regular panel with all four criteria weighted equally. It is the one paid call besides Grok, billed to OpenRouter credits, and it only reads two dishes. Set `GUEST_JUDGE` in `src/config.ts`; find the model ID with `pnpm list-models <name>`. A guest from the same lab as a finalist sets the brief but does not score. Before the finale the runner checks the OpenRouter balance (the key's limit and the account's credit); below `GUEST_MIN_CREDIT_USD` the finale runs on schedule without the guest, and the episode says so. A failed brief is retried once, then the default brief is used. If the guest manages to score only one finalist, that score is dropped for both and the totals use the regular panel; if dropping it would leave a finalist unjudged, it is kept and the episode page says so. Guest calls share a 15-minute budget. Test all of this without keys: `MOCK_GUEST_FAIL=brief|one-dish|balance` with a copy of `test/fixtures/finale-start` as `DATA_DIR`.

A chef whose model is down, or whose reply is not a complete HTML document, forfeits the round with a score of zero. It still gets its pressure test, so one bad API day is survivable. Two is not.

## Setup

1. **Get API keys.** Free: [Google AI Studio](https://aistudio.google.com/), [Groq](https://console.groq.com/) and [OpenRouter](https://openrouter.ai/). Paid: [xAI](https://console.x.ai/), which runs one judge (Grok) and costs roughly a dollar or two a season. OpenRouter's free models allow 50 requests a day, or 1,000 once the account has ever bought $10 of credits.
2. **Check the roster.** Copy `.env.example` to `.env`, fill in the keys, and run:
   ```sh
   pnpm install
   pnpm list-models    # every model ID your keys can reach; roster entries are starred
   pnpm check-models   # pings each model in the roster
   ```
   It ends with `checked N, passed A, failed B, skipped C` and exits non-zero on any failure or skip; a clean run says `failed 0, skipped 0`. `--allow-skip` accepts models whose key is not set. Fix any `FAIL` lines in `src/config.ts` using IDs from `list-models`. The model IDs in there were a best guess on the day this was written and free tiers rename things constantly.
   Optional: **`SITE_URL`** (e.g. `https://modelchef.example`) makes share previews use absolute image URLs. Without it, production builds on Vercel use the project's production URL and every other build emits relative-only tags. Set it if you add a custom domain, and set `SITE_URL=` (empty) for Vercel's Preview environment so previews don't advertise production images. The same URL turns on the episode feed, `dist/feed.xml` (Atom); without it the feed is skipped.
3. **Add the keys to GitHub** as repository secrets with the same names (Settings → Secrets and variables → Actions). Vercel does not need them.
4. **Import the repo in Vercel.** `vercel.json` already tells it to run `pnpm build` and serve `dist/`. Vercel rebuilds the site on every push. To see visitor counts, enable **Analytics** on the project (Vercel → Analytics → Enable): every site page already loads Vercel's cookie-free script from `/_vercel/insights/script.js` on its own domain (never inside a dish).

   **Analytics, events and search** (all optional, set in Vercel → Settings → Environment Variables, Production):
   - `GA_MEASUREMENT_ID` (e.g. `G-XXXXXXX`) adds Google Analytics 4 to every site page, under Consent Mode v2: a small banner asks before GA may set cookies (until then it sends cookieless pings only), and "Cookie settings" in the footer reopens it.
   - Events go to both Vercel and GA: `dish_open`, `verdict_open`, `dish_nav`, `episode_nav`, `notes_open`, `judges_open`, `brief_open`, `outbound`. Their data is ids only (season, episode, chef, rank), never model-written text. Vercel only records custom events on Pro and Enterprise plans.
   - `GOOGLE_SITE_VERIFICATION` adds the Search Console HTML-tag verification. Then submit `https://<your domain>/sitemap.xml` in Search Console. The sitemap (home, episode and dish pages) is built whenever the site's absolute URL is known, the same as the feed; `robots.txt` is always built and keeps crawlers out of the raw dish copies.
5. **Air the pilot**: Actions → Episode → Run workflow. After that it runs every Saturday on its own: the workflow commits the results, and the push publishes them.

If an episode's commit does not deploy, check the deployment list in Vercel. The Hobby plan can refuse private-repo commits whose author is not the account owner; if that happens, change the `git config` lines in `.github/workflows/episode.yml` to your own name and GitHub email.

### If a run fails

GitHub emails you when the Episode workflow fails. **Do not just run it again**: a run always cooks the *next* episode (`episodes.length + 1` in `state.json`), so re-running after a run that did record its results airs an extra episode. First:

- **Is an Episode job still running?** Look at Actions → Episode. If one is past the "Run the episode" step, wait for it: never cancel it while it is committing results. Otherwise wait for it to finish or cancel it.

Then find which step failed in the run log, and follow the matching case:

1. **"Run the episode" failed.** The episode writes its results only at the very end, so nothing was recorded. Confirm on `main` that `data/<season>/state.json` has no entry for this episode, then run Actions → Episode → Run workflow.
2. **"Commit the results" failed** (a commit or push error after the episode finished). The results exist only in the run's artifact, `episode-data-<run id>` (kept 14 days; Actions → the run → Artifacts). Do **not** re-run. Restore them:
   1. Download and unzip the artifact. Its `manifest.json` lists the base commit, season, episode number and the files the run wrote.
   2. In an up-to-date checkout of `main`: if `git log -1 --format=%H -- data` is the manifest's `base`, copy the artifact's `data/` over the checkout. If `main`'s data moved on since, copy only the new `data/<season>/ep-NN/`, and copy the artifact's `state.json` only if `git diff <base> -- data/<season>/state.json` is empty; otherwise stop and reconcile the two `state.json` files by hand.
   3. Commit (`Episode results <date>`) and push. The push publishes the episode.
3. **The commit is on `main` but the site didn't update.** The deploy failed: redeploy in Vercel. Do not re-run.
4. **The artifact is missing, unreadable or incomplete** (no `manifest.json`, truncated JSON, missing screenshots or apps). Do not re-run until you know no episode was recorded: check `main`'s `state.json` and read the run log. Re-run only if it is clear nothing was recorded.

## Running locally

```sh
pnpm episode:mock   # a fake episode with canned models, written to .mock-data/
pnpm build:mock     # build the site from it into dist/
pnpm episode        # a real episode, written to data/
DATA_DIR=.rehearsal pnpm episode   # a real episode against the live models that does not touch the season
pnpm build
```

Before a PR, run `pnpm verify`: unit tests (`pnpm test`), typecheck, and the site built from `data/` and from the fixtures in `test/fixtures/data/`. It needs no keys and no Chromium. CI runs it on every PR.

The capture step needs Chromium: `pnpm exec playwright install chromium`, or set `CHROME_PATH` to a Chrome you already have. `MOCK_FORFEIT=<chef id>` makes one mock chef serve nothing. Each episode also renders a share image, `og.jpg`; if that fails the episode still records, and `pnpm backfill-share-images <season>/ep-NN` renders it afterwards (`--help` for options). `SHARE_IMAGE=0` skips it.

## Rehearsing a twist

A rehearsal runs a real episode against the live models in `.rehearsal/`, without touching the season. **Never rehearse on a Saturday (UTC) before that day's episode results are committed.** If a run stops partway, its state is unknown: `rm -rf .rehearsal` and copy again before retrying.

**Secret ingredient (episode 3).** Run after S1E2 has aired:

```sh
rm -rf .rehearsal && mkdir -p .rehearsal && cp -r data/season-01 .rehearsal/season-01
node -e "const s=require('./.rehearsal/season-01/state.json'); const a=Object.values(s.contestants).filter(c=>c.status==='active').length; if (s.episodes.length!==2||a<3) { console.error('expected 2 episodes and 3+ active chefs, got', s.episodes.length, a); process.exit(1) } console.log('next run: episode 3, a Mystery Box with a secret ingredient')"
DATA_DIR=.rehearsal pnpm episode
DATA_DIR=.rehearsal pnpm build   # then open dist/ and check the cards
```

Check that the run log names the ingredient, every dish's machine-check line states the ingredient result, and the judges' notes mention it.

**Guest judge (finale).** The guest is paid (OpenRouter credit): the brief plus two dishes. Check the balance first, as its own step:

```sh
set -a; . ./.env; set +a
curl -s -H "Authorization: Bearer $OPENROUTER_API_KEY" https://openrouter.ai/api/v1/key      # data.limit_remaining
curl -s -H "Authorization: Bearer $OPENROUTER_API_KEY" https://openrouter.ai/api/v1/credits  # total_credits - total_usage
```

Then cut the season to its two best chefs and run the finale:

```sh
rm -rf .rehearsal && mkdir -p .rehearsal && cp -r data/season-01 .rehearsal/season-01
node -e "const fs=require('fs'), f='./.rehearsal/season-01/state.json', s=require(f); const avg=c=>c.history.reduce((t,h)=>t+h.total,0)/Math.max(1,c.history.length); const ids=Object.keys(s.contestants).filter(id=>s.contestants[id].status==='active').sort((a,b)=>avg(s.contestants[b])-avg(s.contestants[a])); const last=s.episodes.at(-1).number; ids.slice(2).forEach(id=>{s.contestants[id].status='eliminated'; s.contestants[id].eliminatedIn=last}); s.immune=null; if (Object.values(s.contestants).filter(c=>c.status==='active').length!==2) { console.error('expected exactly 2 active chefs'); process.exit(1) } fs.writeFileSync(f, JSON.stringify(s,null,2)+'\n'); console.log('finalists:', ids.slice(0,2).join(', '))"
DATA_DIR=.rehearsal pnpm episode
DATA_DIR=.rehearsal pnpm build
```

Check that the guest set the brief and scored both finalists. Make at most two paid finale attempts; if it still fails, fix it or set `GUEST_JUDGE = null` in `src/config.ts` before the finale airs.

## Tuning

Everything lives in `src/config.ts`: chefs, judges and their personas, Mystery Box themes, pressure-test specs, score weights. Prompts are in `src/prompts.ts`.

- **Chef fallbacks** should be the same model on another host. A different model is a different chef.
- **`maxTokens`** needs headroom on thinking models, which spend output budget on reasoning. A dish cut off before `</html>` is a forfeit.
- **`sourceChars`** caps how much source a judge reads. Lower it for judges on providers with small tokens-per-minute limits.
- **`PACE_MS`** (default 13000) is the gap between calls to one provider. An episode takes several minutes on purpose.
- **New season**: bump `SEASON`. The old season stays on the site.

## Where things live

```
data/<season>/state.json            standings, each chef's history and feedback
data/<season>/ep-NN/episode.json    every score, critique and vote
data/<season>/ep-NN/apps/           the dishes, exactly as the models wrote them
data/<season>/ep-NN/pressure/       pressure-test dishes
data/<season>/ep-NN/shots/          screenshots
dist/                               built site (not committed)
```

## Safety

The site serves JavaScript nobody reviewed. Published copies of each dish get a Content-Security-Policy that blocks all network access, and run in a sandboxed iframe with an opaque origin, so they cannot read cookies or storage from anything else on the domain. Hosting on its own Vercel domain keeps it apart from your other sites as well. The copies in `data/` are untouched originals: open those directly only if you trust them.
