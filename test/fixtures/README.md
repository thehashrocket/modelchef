# Test fixtures

Deterministic `DATA_DIR` trees for `pnpm verify`. They are not the show: never copy them into `data/`.

- `data/three-episodes/`: season 1 after three episodes, made with `pnpm episode:mock` and then edited by hand:
  - episode 1 is a **legacy record**, written before judge models were kept (no `model` fields);
  - episode 2's pressure test is a **1–1 tie** (the third judge's reply was unreadable), decided by the main-round score;
  - episode 3 is a Mystery Box with a secret ingredient, one chef **forfeits** (and so loses the pressure test by forfeit), and the winning dish has an **80-character unbroken title**.
  Screenshots are a 48px placeholder.
