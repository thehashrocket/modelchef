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

A chef whose model is down, or whose reply is not a complete HTML document, forfeits the round with a score of zero. It still gets its pressure test, so one bad API day is survivable. Two is not.

## Setup

1. **Get free API keys** from [Google AI Studio](https://aistudio.google.com/), [Groq](https://console.groq.com/), [Mistral](https://console.mistral.ai/) and [OpenRouter](https://openrouter.ai/). OpenRouter's free models allow 50 requests a day, or 1,000 once the account has ever bought $10 of credits.
2. **Check the roster.** Copy `.env.example` to `.env`, fill in the keys, and run:
   ```sh
   pnpm install
   pnpm check-models
   ```
   Fix any `FAIL` lines in `src/config.ts`. The model IDs in there were a best guess on the day this was written and free tiers rename things constantly.
3. **Add the keys to GitHub** as repository secrets with the same names (Settings → Secrets and variables → Actions). Vercel does not need them.
4. **Import the repo in Vercel.** `vercel.json` already tells it to run `pnpm build` and serve `dist/`. Vercel rebuilds the site on every push.
5. **Air the pilot**: Actions → Episode → Run workflow. After that it runs every Saturday on its own: the workflow commits the results, and the push publishes them.

If an episode's commit does not deploy, check the deployment list in Vercel. The Hobby plan can refuse private-repo commits whose author is not the account owner; if that happens, change the `git config` lines in `.github/workflows/episode.yml` to your own name and GitHub email.

If a run fails, GitHub emails you and nothing is recorded, so the fix is to run it again.

## Running locally

```sh
pnpm episode:mock   # a fake episode with canned models, written to .mock-data/
pnpm build:mock     # build the site from it into dist/
pnpm episode        # a real episode, written to data/
pnpm build
```

The capture step needs Chromium: `pnpm exec playwright install chromium`, or set `CHROME_PATH` to a Chrome you already have. `MOCK_FORFEIT=<chef id>` makes one mock chef serve nothing.

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
