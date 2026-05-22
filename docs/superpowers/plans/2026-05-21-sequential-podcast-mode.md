# Sequential Podcast Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `latest_only: boolean` with a `mode` enum on podcast show entries and add a new `sequential` mode that paginates a show's catalog and returns the oldest unplayed episode, so a flight-training podcast can be played beginning-to-end at a tied slot 2 alongside BirdNote Daily.

**Architecture:** Episode selection in `src/SpotifyPodcasts.ts` becomes a switch on `mode` (default / latest_only / sequential). Sequential mode paginates `spotifyClient.shows.episodes(id, 'US', 50, offset)` up to 10 pages (500 episodes), sorts ascending by release date, returns the first not-fully-played episode, and bypasses the 6-month release cutoff. The slot-2 tie with BirdNote requires no code change — `tryPick` already random-samples among shows sharing a `pin_slot`. The `latest_only: boolean` field on every existing entry migrates to `mode = "latest_only"`; entries without it stay omitted (`undefined` is interpreted as `'default'`).

**Tech Stack:** TypeScript, Node ≥20 (ESM, top-level await), Vitest + MSW for HTTP mocking, `smol-toml` for config, `@spotify/web-api-ts-sdk`.

---

## File Structure

- **Modify** `src/PodcastConfig.ts` — replace `latest_only?: boolean` with `mode?: PodcastMode` and export the new type. (~5 lines changed)
- **Modify** `src/SpotifyPodcasts.ts` — branch on `show.mode ?? 'default'`; add the `sequential` branch with pagination; validate unknown mode strings. (~50 lines added/changed)
- **Modify** `src/__tests__/mswServer.ts` — add `mockShowEpisodesPaginated` helper that serves a multi-page response keyed on `offset`. (~30 lines added)
- **Modify** `src/SpotifyPodcasts.test.ts` — add `beforeEach` that mocks `console.error` + `Math.random`, plus new tests for tied `pin_slot`, sequential mode, and unknown mode handling. (~130 lines added)
- **Modify** `src/__tests__/fixtures/podcasts.toml` — migrate `latest_only = true` → `mode = "latest_only"` on the two existing entries that have it; add a `flightpod` entry tied at `pin_slot = 2` and a `typoshow` entry at `pin_slot = 10`. (~14 lines added)
- **Modify** `podcasts.toml` (real config at repo root) — migrate every `latest_only = true` line to `mode = "latest_only"`; add the new flight-training podcast at `pin_slot = 2`. (~7 lines changed)

No new files. No file is large enough to warrant splitting.

---

## Test-Fixture Strategy

The test fixture should **mirror the real-world overlap** at `pin_slot = 2` (the tie is the feature being added). After Task 2, the fixture has two shows pinned to slot 2: `thedaily` (mode=latest_only) and `flightpod` (mode=sequential). All sequential-mode tests target `flightpod` through that overlap.

To keep existing tests deterministic in the presence of the tie, a `beforeEach` block in `src/SpotifyPodcasts.test.ts` installs two mocks:

1. `vi.spyOn(Math, 'random').mockReturnValue(0)` — forces `_.random(N)` to return `0`, so the tied pool's first entry (`thedaily`) is always picked at slot 2. Existing `expect(episodes[1]?.episode.id).toBe('thedaily_ep')` assertions remain valid.
2. `vi.spyOn(console, 'error').mockImplementation(() => {})` — quiets the partial-failure log lines that the existing `pickLatestEligibleEpisode` catch-block emits when a test forgets to mock a show that the fixture references.

Tests that need to exercise the *flightpod* side of the tie restore mocks locally and re-install with `Math.random = 0.999` to force `_.random(1)` to return `1` (the second entry in the tied pool).

`typoshow` (Task 6) is pinned to `pin_slot = 10`, beyond every existing test's `numberOfPodcasts` value, so it never participates in existing tests.

---

## Baseline Note

Before starting Task 1: 5 tests in `src/SpotifyTracks.test.ts` are failing on `main` (MSW `onUnhandledRequest: "error"` strategy errors). These pre-exist this work, are not in the podcast area, and are out of scope. All 9 tests in `src/SpotifyPodcasts.test.ts` pass and **must continue to pass** after each task. If a podcast test breaks unexpectedly, stop and investigate.

---

## Task 1: Migrate `latest_only: boolean` to `mode` enum (refactor — no behavior change)

**Files:**

- Modify: `src/PodcastConfig.ts`
- Modify: `src/SpotifyPodcasts.ts`
- Modify: `src/__tests__/fixtures/podcasts.toml`
- Modify: `podcasts.toml`

- [ ] **Step 1: Replace the type definition in `src/PodcastConfig.ts`**

Replace the entire contents of `src/PodcastConfig.ts` with:

```ts
import { readFile } from 'fs/promises';
import { parse } from 'smol-toml';
import { PODCASTS_CONFIG_PATH } from './config.js';

export type PodcastMode = 'default' | 'latest_only' | 'sequential';

export type PodcastConfig = {
  shows: {
    name: string;
    spotify_show_id: string;
    pin_slot?: number;
    mode?: PodcastMode;
  }[];
};

export async function loadPodcastConfig(): Promise<PodcastConfig> {
  const tomlText = await readFile(PODCASTS_CONFIG_PATH, 'utf8');
  return parse(tomlText) as PodcastConfig;
}
```

- [ ] **Step 2: Update `src/SpotifyPodcasts.ts` to branch on `mode` instead of `latest_only`**

In `src/SpotifyPodcasts.ts`, replace the entire function `pickLatestEligibleEpisode` (starting at line 54) with the version below. This task only swaps the field name — `mode === 'sequential'` falls through to default behavior; the real sequential branch lands in Task 3.

```ts
async function pickLatestEligibleEpisode(
  show: PodcastShowConfig,
  cutoff: Date,
): Promise<SimplifiedEpisode | undefined> {
  let episodes: SimplifiedEpisode[];
  try {
    const page = await spotifyClient.shows.episodes(show.spotify_show_id, 'US', 25);
    episodes = page.items;
  } catch (e) {
    console.error(`Error fetching episodes for "${show.name}":`, (e as Error).message);
    return undefined;
  }
  const playable = episodes
    .filter((ep): ep is SimplifiedEpisode => ep != null && ep.is_playable)
    .sort((a, b) => Date.parse(b.release_date) - Date.parse(a.release_date));

  const mode = show.mode ?? 'default';

  if (mode === 'latest_only') {
    // latest_only shows (like the news) are pointless once stale —
    // if today's episode is already played, surface nothing rather than backfill an older one.
    const newest = playable[0];
    if (!newest || (newest.resume_point?.fully_played ?? false)) return undefined;
    return newest;
  }

  return playable
    .filter((ep) => Date.parse(ep.release_date) >= cutoff.getTime())
    .filter((ep) => !(ep.resume_point?.fully_played ?? false))[0];
}
```

- [ ] **Step 3: Migrate the test fixture TOML**

In `src/__tests__/fixtures/podcasts.toml`, replace `latest_only = true` with `mode = "latest_only"` on each entry that has it. After this change the first two entries read:

```toml
[[shows]]
name = "Up First from NPR"
spotify_show_id = "upfirst"
pin_slot = 1
mode = "latest_only"

[[shows]]
name = "The Daily"
spotify_show_id = "thedaily"
pin_slot = 2
mode = "latest_only"
```

Leave entries that don't have `latest_only` alone — they stay without a `mode` field.

- [ ] **Step 4: Migrate the real `podcasts.toml`**

In `/podcasts.toml` (repo root), replace every line that reads `latest_only = true` with `mode = "latest_only"`. The shows affected are: Up First from NPR, BirdNote Daily, The Daily, GD POLITICS, Magic Mics Podcast, NPR News Now. All keep their existing `pin_slot` values. Do not add `mode = "default"` anywhere — entries without a `mode` field are implicitly default.

- [ ] **Step 5: Run typecheck and tests, verify everything still passes**

Run: `npm run typecheck && npm test -- src/SpotifyPodcasts`
Expected:

- typecheck passes (no errors)
- 9 passed in `src/SpotifyPodcasts.test.ts`

Sanity check: `grep -rn "latest_only" src/ podcasts.toml` should return only string-literal matches (e.g. `mode === 'latest_only'`, `mode = "latest_only"`) — no remaining boolean field references.

- [ ] **Step 6: Commit**

```bash
git add src/PodcastConfig.ts src/SpotifyPodcasts.ts src/__tests__/fixtures/podcasts.toml podcasts.toml
git commit -m "refactor(podcasts): replace latest_only boolean with mode enum

Prepares for a 'sequential' mode that plays a show beginning to end.
No behavior change in this commit — every existing 'latest_only = true'
entry migrates 1:1 to mode = \"latest_only\"."
```

---

## Task 2: Install determinism in `beforeEach` + add a tied `flightpod` to the fixture + regression test

**Files:**

- Modify: `src/__tests__/fixtures/podcasts.toml`
- Modify: `src/SpotifyPodcasts.test.ts`

This task introduces the overlap that the rest of the plan builds on. After this commit, the fixture has `thedaily` (latest_only) and `flightpod` (sequential) both pinned to `pin_slot = 2`. A `beforeEach` block stabilizes the existing tests against the new randomness by forcing `_.random` to return `0` (which picks `thedaily` from the tied pool). A new `it(...)` block exercises the tie by overriding `Math.random` to pick `flightpod` instead.

- [ ] **Step 1: Add `flightpod` to the test fixture, overlapping at slot 2**

Append to `src/__tests__/fixtures/podcasts.toml`:

```toml
[[shows]]
name = "Flight Pod"
spotify_show_id = "flightpod"
pin_slot = 2
mode = "sequential"
```

The entry order matters: `thedaily` comes first in the fixture's slot-2 pool, so `_.random` with index `0` picks `thedaily` (preserving every existing slot-2 assertion).

- [ ] **Step 2: Install a `beforeEach` block in the test file**

In `src/SpotifyPodcasts.test.ts`, add `beforeEach` to the existing vitest import:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
```

Then, inside the `describe('fetchSpotifyPodcasts', () => { ... })` block, immediately after the opening `describe` line and before any `it(...)` blocks, add:

```ts
beforeEach(() => {
  // Deterministically pick the first entry of any random pool — keeps
  // every pre-existing assertion stable now that slot 2 has a tied entry.
  vi.spyOn(Math, 'random').mockReturnValue(0);
  // The catch-and-fall-through in pickLatestEligibleEpisode logs to
  // console.error whenever a fixture show isn't mocked. Tests that need
  // to verify error logging do their own local spy below.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
```

Confirm `afterEach(() => { vi.restoreAllMocks(); })` already exists in the file (it does — line 26 of the current file). No change needed there.

- [ ] **Step 3: Write the failing test for the tied behavior**

In `src/SpotifyPodcasts.test.ts`, append this `it(...)` block at the bottom of the `describe` block:

```ts
it('tied pin_slot: both shows are reachable depending on the random roll', async () => {
  mockShowEpisodes('upfirst', [freshEpisode('upfirst')]);
  mockShowEpisodes('thedaily', [freshEpisode('thedaily')]);
  mockShowEpisodes('flightpod', [freshEpisode('flightpod')]);
  for (const id of OTHER_SHOW_IDS) {
    mockShowEpisodes(id, [freshEpisode(id)]);
  }

  // beforeEach already pinned Math.random = 0 — first call picks thedaily.
  const first = await fetchSpotifyPodcasts({ numberOfPodcasts: 8 });

  // Re-pin Math.random to 0.999 — _.random(1) now returns 1, picking flightpod.
  vi.restoreAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(Math, 'random').mockReturnValue(0.999);
  const second = await fetchSpotifyPodcasts({ numberOfPodcasts: 8 });

  expect(first[1]?.episode.id).toBe('thedaily_ep');
  expect(second[1]?.episode.id).toBe('flightpod_ep');
});
```

- [ ] **Step 4: Run the tests**

Run: `npm test -- src/SpotifyPodcasts`
Expected: 10 passed. The new test passes because `tryPick` already supports ties via `_.random`. All 9 prior tests still pass because the `beforeEach` keeps `_.random` at `0`, which always picks `thedaily` from the slot-2 tied pool.

If a prior test fails, check whether it depended on a specific other-pool pick at a slot beyond 2. The `Math.random = 0` mock makes those picks deterministic — they should still satisfy uniqueness/length assertions.

- [ ] **Step 5: Commit**

```bash
git add src/SpotifyPodcasts.test.ts src/__tests__/fixtures/podcasts.toml
git commit -m "test(podcasts): cover tied pin_slot behavior

Adds 'flightpod' to the test fixture sharing pin_slot=2 with 'thedaily',
mirroring the real-config tie that ships in Task 7. Stabilizes existing
tests with a Math.random + console.error beforeEach so the existing
slot-2 assertions remain deterministic."
```

---

## Task 3: TDD — sequential mode picks oldest unplayed across paginated pages

**Files:**

- Modify: `src/__tests__/mswServer.ts`
- Modify: `src/SpotifyPodcasts.test.ts`
- Modify: `src/SpotifyPodcasts.ts`

- [ ] **Step 1: Add `mockShowEpisodesPaginated` helper to `mswServer.ts`**

Append to `src/__tests__/mswServer.ts` (after `mockShowEpisodesError`):

```ts
export function mockShowEpisodesPaginated(
  showId: string,
  pages: EpisodeFixture[][],
): void {
  const flat = pages.flat();
  mswServer.use(
    http.get(`https://api.spotify.com/v1/shows/${showId}/episodes`, ({ request }) => {
      const url = new URL(request.url);
      const limit = Number(url.searchParams.get('limit') ?? 50);
      const offset = Number(url.searchParams.get('offset') ?? 0);
      const slice = flat.slice(offset, offset + limit);
      return HttpResponse.json({
        items: slice.map((ep) => ({
          id: ep.id,
          name: ep.name,
          release_date: ep.release_date,
          duration_ms: ep.duration_ms ?? 30 * 60 * 1000,
          is_playable: ep.is_playable ?? true,
          resume_point: { fully_played: ep.fully_played ?? false, resume_position_ms: 0 },
        })),
        total: flat.length,
        limit,
        offset,
        next: offset + limit < flat.length ? 'next' : null,
        previous: offset > 0 ? 'prev' : null,
        href: '',
      });
    }),
  );
}
```

- [ ] **Step 2: Import `mockShowEpisodesPaginated` in the test file**

In `src/SpotifyPodcasts.test.ts`, update the existing import line:

```ts
import {
  mockShowEpisodes,
  mockShowEpisodesEmpty,
  mockShowEpisodesError,
  mockShowEpisodesPaginated,
  mswServer,
} from './__tests__/mswServer.js';
```

- [ ] **Step 3: Write the failing test**

In `src/SpotifyPodcasts.test.ts`, append this `it(...)` block at the bottom of the `describe` block:

```ts
it('sequential mode: picks the oldest unplayed episode across paginated pages', async () => {
  mockShowEpisodes('upfirst', [freshEpisode('upfirst')]);
  mockShowEpisodes('thedaily', [freshEpisode('thedaily')]);
  for (const id of OTHER_SHOW_IDS) {
    mockShowEpisodes(id, [freshEpisode(id)]);
  }

  // Two pages: page 1 (newest) all played; page 2 (older) has the oldest unplayed.
  mockShowEpisodesPaginated('flightpod', [
    [
      ep('flightpod', '2026-05-20', true, '_p1_a'),
      ep('flightpod', '2026-05-13', true, '_p1_b'),
    ],
    [
      ep('flightpod', '2020-06-01', false, '_p2_old_unplayed'),
      ep('flightpod', '2020-05-25', true, '_p2_old_played'),
    ],
  ]);

  // Force the tied slot-2 pool to pick flightpod (index 1).
  vi.restoreAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(Math, 'random').mockReturnValue(0.999);

  const episodes = await fetchSpotifyPodcasts({ numberOfPodcasts: 8 });

  expect(episodes[1]?.episode.id).toBe('flightpod_ep_p2_old_unplayed');
});
```

- [ ] **Step 4: Run the test, verify it fails**

Run: `npm test -- src/SpotifyPodcasts`
Expected: 1 failure on the new test. After Task 1 the code treats `sequential` like `default` — it only reads page 1 of 25 and applies the 6-month cutoff, so it returns either `undefined` or one of the played page-1 episodes, not the unplayed page-2 episode.

- [ ] **Step 5: Implement sequential mode**

In `src/SpotifyPodcasts.ts`, add two constants directly below the existing `RELEASE_CUTOFF_MONTHS` constant:

```ts
const SEQUENTIAL_PAGE_SIZE = 50;
const SEQUENTIAL_PAGE_CAP = 10;
```

Then replace the entire `pickLatestEligibleEpisode` function with:

```ts
async function pickLatestEligibleEpisode(
  show: PodcastShowConfig,
  cutoff: Date,
): Promise<SimplifiedEpisode | undefined> {
  const mode = show.mode ?? 'default';

  if (mode === 'sequential') {
    return pickOldestUnplayedSequential(show);
  }

  let episodes: SimplifiedEpisode[];
  try {
    const page = await spotifyClient.shows.episodes(show.spotify_show_id, 'US', 25);
    episodes = page.items;
  } catch (e) {
    console.error(`Error fetching episodes for "${show.name}":`, (e as Error).message);
    return undefined;
  }
  const playable = episodes
    .filter((ep): ep is SimplifiedEpisode => ep != null && ep.is_playable)
    .sort((a, b) => Date.parse(b.release_date) - Date.parse(a.release_date));

  if (mode === 'latest_only') {
    const newest = playable[0];
    if (!newest || (newest.resume_point?.fully_played ?? false)) return undefined;
    return newest;
  }

  return playable
    .filter((ep) => Date.parse(ep.release_date) >= cutoff.getTime())
    .filter((ep) => !(ep.resume_point?.fully_played ?? false))[0];
}

async function pickOldestUnplayedSequential(
  show: PodcastShowConfig,
): Promise<SimplifiedEpisode | undefined> {
  const collected: SimplifiedEpisode[] = [];
  for (let pageIdx = 0; pageIdx < SEQUENTIAL_PAGE_CAP; pageIdx++) {
    const offset = pageIdx * SEQUENTIAL_PAGE_SIZE;
    let page;
    try {
      page = await spotifyClient.shows.episodes(
        show.spotify_show_id,
        'US',
        SEQUENTIAL_PAGE_SIZE,
        offset,
      );
    } catch (e) {
      console.error(
        `Error fetching episodes for "${show.name}" (offset ${offset}):`,
        (e as Error).message,
      );
      return undefined;
    }
    for (const ep of page.items) {
      if (ep != null && ep.is_playable) collected.push(ep);
    }
    if (page.items.length < SEQUENTIAL_PAGE_SIZE) break;
  }

  return collected
    .sort((a, b) => Date.parse(a.release_date) - Date.parse(b.release_date))
    .find((ep) => !(ep.resume_point?.fully_played ?? false));
}
```

- [ ] **Step 6: Run the test, verify it passes**

Run: `npm test -- src/SpotifyPodcasts`
Expected: 11 passed.

- [ ] **Step 7: Commit**

```bash
git add src/__tests__/mswServer.ts src/SpotifyPodcasts.test.ts src/SpotifyPodcasts.ts
git commit -m "feat(podcasts): add sequential mode for beginning-to-end shows

Paginates a show's full episode list (up to 10 pages of 50) and
returns the oldest episode where resume_point.fully_played is false.
Bypasses the 6-month release cutoff so old back catalogs are eligible."
```

---

## Task 4: TDD — sequential mode ignores the 6-month release cutoff

**Files:**

- Modify: `src/SpotifyPodcasts.test.ts`

This may already pass after Task 3 (the sequential branch never consults `cutoff`), but encode it explicitly so the bypass can't regress.

- [ ] **Step 1: Write the test**

In `src/SpotifyPodcasts.test.ts`, append:

```ts
it('sequential mode: returns episodes older than the 6-month cutoff', async () => {
  mockShowEpisodes('upfirst', [freshEpisode('upfirst')]);
  mockShowEpisodes('thedaily', [freshEpisode('thedaily')]);
  for (const id of OTHER_SHOW_IDS) {
    mockShowEpisodes(id, [freshEpisode(id)]);
  }

  // One page, one ancient unplayed episode — default mode would skip it.
  mockShowEpisodesPaginated('flightpod', [
    [ep('flightpod', '2018-01-01', false, '_ancient')],
  ]);

  vi.restoreAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(Math, 'random').mockReturnValue(0.999);

  const episodes = await fetchSpotifyPodcasts({ numberOfPodcasts: 8 });

  expect(episodes[1]?.episode.id).toBe('flightpod_ep_ancient');
});
```

- [ ] **Step 2: Run the test**

Run: `npm test -- src/SpotifyPodcasts`
Expected: 12 passed.

If it fails, the cutoff is leaking into the sequential branch — fix `pickOldestUnplayedSequential` so it does not reference `cutoff`.

- [ ] **Step 3: Commit**

```bash
git add src/SpotifyPodcasts.test.ts
git commit -m "test(podcasts): sequential mode ignores 6-month release cutoff"
```

---

## Task 5: TDD — sequential mode skips show when every episode is fully_played

**Files:**

- Modify: `src/SpotifyPodcasts.test.ts`

- [ ] **Step 1: Write the test**

In `src/SpotifyPodcasts.test.ts`, append:

```ts
it('sequential mode: returns no episode when every episode is fully_played', async () => {
  mockShowEpisodes('upfirst', [freshEpisode('upfirst')]);
  mockShowEpisodes('thedaily', [freshEpisode('thedaily')]);
  for (const id of OTHER_SHOW_IDS) {
    mockShowEpisodes(id, [freshEpisode(id)]);
  }

  mockShowEpisodesPaginated('flightpod', [
    [
      ep('flightpod', '2026-05-20', true, '_a'),
      ep('flightpod', '2026-05-13', true, '_b'),
      ep('flightpod', '2020-06-01', true, '_c'),
    ],
  ]);

  // Force the slot-2 pool to try flightpod first. With every episode played,
  // pickOldestUnplayedSequential returns undefined and tryPick falls back —
  // first to thedaily (also in the tied pool), then to the unpinned pool if
  // thedaily also fails. thedaily is mocked, so slot 2 ends up as thedaily.
  vi.restoreAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(Math, 'random').mockReturnValue(0.999);

  const episodes = await fetchSpotifyPodcasts({ numberOfPodcasts: 8 });

  expect(episodes.map((e) => e.episode.id)).not.toContain('flightpod_ep_a');
  expect(episodes.map((e) => e.episode.id)).not.toContain('flightpod_ep_b');
  expect(episodes.map((e) => e.episode.id)).not.toContain('flightpod_ep_c');
  expect(episodes[1]?.episode.id).toBe('thedaily_ep');
});
```

- [ ] **Step 2: Run the test**

Run: `npm test -- src/SpotifyPodcasts`
Expected: 13 passed.

- [ ] **Step 3: Commit**

```bash
git add src/SpotifyPodcasts.test.ts
git commit -m "test(podcasts): sequential mode skips show when all episodes played"
```

---

## Task 6: TDD — unrecognized mode value falls back to default with a warning

**Files:**

- Modify: `src/__tests__/fixtures/podcasts.toml`
- Modify: `src/SpotifyPodcasts.test.ts`
- Modify: `src/SpotifyPodcasts.ts`

- [ ] **Step 1: Add the typo fixture entry**

Append to `src/__tests__/fixtures/podcasts.toml`:

```toml
[[shows]]
name = "Typo Show"
spotify_show_id = "typoshow"
pin_slot = 10
mode = "sequencial"
```

`mode = "sequencial"` (a typo) parses as the string `'sequencial'`. The runtime must reject any value that isn't one of the three known modes and fall back to `'default'`. `pin_slot = 10` is unreachable for tests with `numberOfPodcasts ≤ 8`, so existing tests are unaffected. This task's test uses `numberOfPodcasts: 10`.

- [ ] **Step 2: Write the failing test**

In `src/SpotifyPodcasts.test.ts`, append:

```ts
it('unknown mode value: treats show as default mode and warns', async () => {
  mockShowEpisodes('upfirst', [freshEpisode('upfirst')]);
  mockShowEpisodes('thedaily', [freshEpisode('thedaily')]);
  mockShowEpisodes('flightpod', [freshEpisode('flightpod')]);
  for (const id of OTHER_SHOW_IDS) {
    mockShowEpisodes(id, [freshEpisode(id)]);
  }
  mockShowEpisodes('typoshow', [freshEpisode('typoshow')]);

  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

  const episodes = await fetchSpotifyPodcasts({ numberOfPodcasts: 10 });

  // typoshow's typo'd mode falls back to default behavior, which returns its
  // fresh episode (passes the 6-month cutoff, not fully_played) for slot 10.
  expect(episodes.map((e) => e.episode.id)).toContain('typoshow_ep');
  expect(warn).toHaveBeenCalledWith(expect.stringContaining('typoshow'));
});
```

- [ ] **Step 3: Run the test, verify it fails**

Run: `npm test -- src/SpotifyPodcasts`
Expected: 1 failure. The `console.warn` assertion fails because the existing code doesn't validate mode strings — `'sequencial'` silently slips through the `mode === 'latest_only'` and `mode === 'sequential'` checks and falls into the default branch without logging anything.

- [ ] **Step 4: Add the validation helper to `src/SpotifyPodcasts.ts`**

At the top of `src/SpotifyPodcasts.ts`, update the import line from `./PodcastConfig.js` to also pull in `PodcastMode`:

```ts
import { loadPodcastConfig, type PodcastConfig, type PodcastMode } from './PodcastConfig.js';
```

Add this helper just above the `pickLatestEligibleEpisode` function (and below the `SEQUENTIAL_*` constants):

```ts
const KNOWN_MODES: ReadonlySet<PodcastMode> = new Set(['default', 'latest_only', 'sequential']);

function resolveMode(show: PodcastShowConfig): PodcastMode {
  const raw = show.mode;
  if (raw === undefined) return 'default';
  if (KNOWN_MODES.has(raw as PodcastMode)) return raw as PodcastMode;
  console.warn(
    `Unknown podcast mode "${raw}" for show "${show.name}" (id=${show.spotify_show_id}); treating as "default".`,
  );
  return 'default';
}
```

Then, inside `pickLatestEligibleEpisode`, change this line:

```ts
  const mode = show.mode ?? 'default';
```

to:

```ts
  const mode = resolveMode(show);
```

- [ ] **Step 5: Run the test, verify it passes**

Run: `npm test -- src/SpotifyPodcasts`
Expected: 14 passed.

- [ ] **Step 6: Commit**

```bash
git add src/__tests__/fixtures/podcasts.toml src/SpotifyPodcasts.test.ts src/SpotifyPodcasts.ts
git commit -m "feat(podcasts): treat unknown mode as default with a console warning"
```

---

## Task 7: Add the flight-training podcast to `podcasts.toml`

**Files:**

- Modify: `podcasts.toml`

This is the ship-it step. After this, running `npm start -- --dry-run` will sometimes pick BirdNote and sometimes the flight pod for slot 2.

- [ ] **Step 1: Insert the new show entry into the real config**

In `/podcasts.toml` (repo root), find the BirdNote Daily entry. Immediately after it, insert:

```toml
[[shows]]
name = "<FILL IN: name of Spotify show id 4XQyGRnBcNrvmXwfP13pKH>"
spotify_show_id = "4XQyGRnBcNrvmXwfP13pKH"
pin_slot = 2
mode = "sequential"
```

Leave the `<FILL IN: ...>` placeholder for the show name — the user will replace it after looking up the actual title in Spotify. Do **not** commit a guessed name.

- [ ] **Step 2: Verify the TOML still parses and tests still pass**

Run: `npm test -- src/SpotifyPodcasts && npm run typecheck`
Expected: 14 podcast tests pass, typecheck clean.

Why this works: tests load `src/__tests__/fixtures/podcasts.toml` via the `PODCASTS_CONFIG_PATH` env override in `src/__tests__/setup.ts` — not the real `podcasts.toml`. The placeholder string in the real config does not affect tests.

- [ ] **Step 3: Dry-run the CLI to confirm end-to-end behavior**

Run: `npm start -- --dry-run`
Expected:

- The plan output prints the configured number of podcast slots.
- Slot 2's pick is either BirdNote Daily *or* an old flight-training episode (whichever the random roll selects).
- No crash from the `<FILL IN: ...>` placeholder name — the name field is only used for log messages.

If the run errors out with "Missing env var" or similar, check that `.env` is populated. Missing env vars cause `process.exit(2)` in `src/config.ts` and that's unrelated to this task.

- [ ] **Step 4: Replace the placeholder name and commit**

Have the user supply the real show title (or look it up via the Spotify URL `https://open.spotify.com/show/4XQyGRnBcNrvmXwfP13pKH`). Edit the `name` line in `podcasts.toml` to that real title, then run the dry-run once more to confirm nothing changed.

```bash
git add podcasts.toml
git commit -m "feat(podcasts): add flight-training podcast tied to slot 2

Plays beginning to end (mode = \"sequential\"). Pinned to slot 2,
sharing the pin with BirdNote Daily so each run flips a coin
between them."
```

---

## Done

All 14 podcast tests pass. `podcasts.toml` is shipping. Running `npm start` will now occasionally surface a flight-training episode in slot 2.

Final sanity:

- `npm run typecheck` clean.
- `npm test -- src/SpotifyPodcasts` shows 14 passing.
- `grep -rn "latest_only" src/ podcasts.toml` returns only string-literal matches (e.g. `mode === 'latest_only'`, `mode = "latest_only"`) — no remaining boolean field references.
