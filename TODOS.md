# TODOS

Deferred by the 2026-11-15 /autoplan review of open issues #1-#11. Items the final approval gate pulls into scope move out of this file.

## Site

### Remove dead pilot code

**What:** Delete `isPilot` paths (build-site.ts / state.ts) and the README "Air the pilot" step.
**Why:** Pilot data was dropped in 8625382; the code is untestable.
**Pros:** Less code in the most-edited file.
**Cons:** None once no pilot folder exists.
**Context:** The plan keeps the path compiling; remove it after the #4-#11 PRs land.
**Depends on / blocked by:** #4, #6.
**Priority:** P3

### Publish the episode record as data

**What:** Emit sanitized `episode.json` per episode and a season `standings.json` into `dist/`.
**Why:** The unedited record is the citable asset; enables embeds and feeds.
**Pros:** ~20 lines; no new surface beyond static JSON.
**Cons:** Becomes a public format to keep stable.
**Context:** Claude CEO voice reframe (decision 20).
**Depends on / blocked by:** #6.
**Priority:** P3

## Episode runner

### Realistic check-models probe

**What:** `check-models --deep`: one dish-sized generation per chef and one judge-JSON reply per judge.
**Why:** Answering "OK" does not prove a model can cook or judge.
**Pros:** Catches truncation, rate caps and JSON failures before a season.
**Cons:** Spends free-tier quota and minutes.
**Context:** The exit-code/totals fix is in this plan (issue #3); this deeper probe is a gate item.
**Depends on / blocked by:** none.
**Priority:** P1 (before season 2)

### Capture watchdog

**What:** Bound each dish capture (`capture.ts`) with a timer that kills the page/browser and records the stage.
**Why:** A dish that blocks its renderer can hang a run.
**Pros:** Local rehearsals always return.
**Cons:** Touches the live capture path.
**Context:** Codex DX finding; Actions has a 90-minute limit, local runs have none.
**Depends on / blocked by:** none.
**Priority:** P2

### Per-season roster display metadata

**What:** Store chef and judge display names per season (or per episode) so archives don't change when config does.
**Why:** Replacing a chef id for season 2 would rename season-1 dishes.
**Pros:** Archives stay true.
**Cons:** Small data-format change.
**Context:** Codex DX/eng; build-site.ts:13 resolves names from current config.
**Depends on / blocked by:** before any season-2 roster change (#1).
**Priority:** P1 (before season 2)

### Deterministic mock (MOCK_SEED)

**What:** Seed the mock models so titles, scores, votes and ingredients repeat.
**Why:** Acceptance checks shouldn't depend on random output.
**Pros:** Reproducible PR evidence.
**Cons:** Touches mock.ts.
**Context:** The plan uses copied episode.json fixtures meanwhile.
**Depends on / blocked by:** none.
**Priority:** P3
