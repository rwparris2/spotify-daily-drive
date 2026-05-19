# Daily Drive — Implementation Plan

A CLI tool that builds a "Daily Drive" Spotify playlist by interleaving N podcast episodes with songs from the user's Spotify activity, following an n+1 song pattern between podcasts. Run on-demand from a terminal for now; GitHub Actions scheduling is **out of scope** for this plan.

## What's already built

- [src/config.ts](../../src/config.ts) — env loading (`SPOTIFY_CLIENT_ID/SECRET/REFRESH_TOKEN/PLAYLIST_ID/REDIRECT_URI`, `PODCASTS_CONFIG_PATH`).
- [src/SpotifyBootstrapAuth.ts](../../src/SpotifyBootstrapAuth.ts) — one-shot OAuth → refresh_token printer.
- [src/SpotifyClient.ts](../../src/SpotifyClient.ts) — `@spotify/web-api-ts-sdk` with rate-limit-aware fetch (429 + Retry-After backoff).
- [src/SpotifyPlaylistTracksCache.ts](../../src/SpotifyPlaylistTracksCache.ts) — local cache at `.cache/spotify-playlist-tracks.json` keyed by snapshot_id.
- [src/SpotifyTracks.ts](../../src/SpotifyTracks.ts) — song candidate pool from 4 sources: random user playlists, top tracks (short/medium/long horizons), recently played, saved tracks. Returns 40 sampled tracks.
- [src/PodcastConfig.ts](../../src/PodcastConfig.ts) — `podcasts.toml` parser. Schema: `{ name, spotify_show_id, category, itunes_categories?, pin_slot? }`.
- [src/SpotifyPodcasts.ts](../../src/SpotifyPodcasts.ts) — stub; only loads config.
- [src/index.ts](../../src/index.ts) — stub; only calls `fetchSpotifyTracks`.
- [podcasts.toml](../../podcasts.toml) — hand-maintained config, populated from PocketCasts OPML. Up First (pin_slot=1) + The Daily (pin_slot=2) are the only pinned shows.

## Decisions baked in

- **N = 8 podcasts** per playlist. Slot 1 = Up First, slot 2 = The Daily, slots 3-8 = random sample of "other" shows. Pattern: 2+3+4+5+6+7+8+9 = **44 songs, 52 items total**, always ending on songs.
- **Episode pick within a show**: latest episode that satisfies freshness + `!resume_point.fully_played`. No weighting. No in-show random pick.
- **Show pick for slots 3-8**: `_.sampleSize` random. No state, no longest-not-heard tracking, no back-to-back avoidance — `fully_played` filtering + random sampling handles repetitiveness.
- **News fallback chain** for slots 1 & 2: Up First → NPR News Now → Today Explained → Throughline → FiveThirtyEight Politics (filtered to shows actually present in `podcasts.toml`). Slot 2 excludes whatever was used in slot 1.
- **Scope addition**: `user-read-playback-position` added to bootstrap; user re-runs `npm run bootstrap-auth` once to mint a fresh refresh token. Discover Weekly and new-releases-from-followed-artists song sources are **not** implemented — the existing 4 sources are the spec.
- **Testing**: Vitest. Spotify access abstracted behind a `SpotifyGateway` interface so selection algorithms are unit-testable without network.
- **Out of scope (deferred)**: GitHub Actions workflow, state.json, longest-not-heard ranking, configurable N via env, weighted-toward-newest episode pick, song sources beyond the 4 already implemented.

## podcasts.toml schema (source of truth)

```toml
[[shows]]
name              = "Up First from NPR"      # required
spotify_show_id   = "2mTUnDkuKUkhiueKcVWoP0" # required
category          = "news"                   # "news" | "other", required
itunes_categories = [ "News", "Daily News" ] # optional
pin_slot          = 1                        # optional positive int, max = N
```

---

## Phase 1 — Auth scope + playlist bootstrap (small)

**Files**
- [src/SpotifyBootstrapAuth.ts](../../src/SpotifyBootstrapAuth.ts)
  - Add `user-read-playback-position` to `SCOPES`.
  - After printing the refresh_token, if the current `.env`'s `SPOTIFY_PLAYLIST_ID` is missing/empty, create a public playlist named "Daily Drive" using the just-issued access_token (`POST /users/{user_id}/playlists`) and print its id with a copy-paste line for `.env`.

**Done when** user runs `npm run bootstrap-auth`, gets a fresh refresh_token + (if needed) a playlist id, pastes both into `.env`. Selection code can then call `getEpisode`-style endpoints needing `user-read-playback-position`.

---

## Phase 2 — Test harness + Spotify interface (small)

**Files**
- `package.json` — add `vitest` devDep; add `"test": "vitest run"` and `"test:watch": "vitest"` scripts.
- `vitest.config.ts` — minimal config (node env; `src/**/*.test.ts`).
- `src/SpotifyGateway.ts` (new) — `interface SpotifyGateway` covering only the methods the selection algorithms need:
  - `getShowEpisodes(showId: string, limit: number): Promise<EpisodeCandidate[]>`
  - (any other surface area discovered during Phase 3 implementation)
- `src/SpotifyGatewayLive.ts` (new) — real implementation that wraps `spotifyClient` and maps SDK shapes → `EpisodeCandidate`.
- `src/__fixtures__/` (new) — checked-in JSON fixtures: `up-first-episodes.json`, `the-daily-episodes.json`, a couple "other" shows, etc.
- `src/SpotifyPodcasts.test.ts` (new, placeholder) — one passing test against a fake `SpotifyGateway` to verify the harness works.

**Done when** `npm test` runs green with the placeholder test.

---

## Phase 3 — Podcast selection (medium)

**Files**
- [src/SpotifyPodcasts.ts](../../src/SpotifyPodcasts.ts) — replace the 3-line stub. Export:
  - `selectPodcastSlots(config: PodcastConfig, gateway: SpotifyGateway, opts: { numberOfPodcasts: number; now?: Date }): Promise<EpisodeCandidate[]>` returning N candidates in slot order.
- Module-local constants:
  - `NEWS_FALLBACK_CHAIN = ["Up First from NPR", "NPR News Now", "Today Explained", "Throughline", "FiveThirtyEight Politics"]`
  - `NEWS_FRESHNESS_HOURS = 48`
  - `OTHER_FRESHNESS_MONTHS = 3`
- Helpers (private to the module):
  - `pickPinnedSlot(slotIndex, primaryShow, fallbackShows, gateway, exclude): Promise<EpisodeCandidate | undefined>` — try each show in order; the first whose latest episode passes freshness + `!fully_played` wins.
  - `pickOtherSlots(otherShows, count, gateway): Promise<EpisodeCandidate[]>` — `_.sampleSize` shuffle of `otherShows`, walk until `count` eligible episodes found (fetch each show's latest few episodes, take the latest that satisfies the filter), substitute on miss, log skips.
- Skips are returned alongside the result (`{ episodes, skipped: SkipLog[] }`) so the CLI can print reasons.

**Tests (against fake gateway)**
- Up First fresh + unplayed → slot 1.
- Up First missing → first fallback fresh + unplayed → slot 1.
- The Daily already-used-in-slot-1 protection (excludes slot 1 show from slot 2 chain).
- Slot 1 + slot 2 fall through entire chain → slot is empty + recorded as skipped.
- Slots 3-8 sample 6 distinct "other" shows out of the eligible pool.
- A sampled show with zero fresh-unplayed episodes is replaced by the next.

---

## Phase 4 — Song pool sizing (small)

**Files**
- [src/SpotifyTracks.ts](../../src/SpotifyTracks.ts)
  - Bump final sample size from 40 → 60 (oversample for safety; final 44 enforced by Phase 5).
  - Add a global `_.uniqBy(t.id)` across all four source results before the final sample.
- Optionally also expose `fetchSpotifyTracks(target: number)` so the assembly step requests exactly the count it needs.

**Tests**
- Given fixtures where two sources return overlapping tracks, output IDs are unique.
- Output length is `min(target, available)`.

---

## Phase 5 — Plan assembly (small)

**Files**
- `src/DailyDrivePlan.ts` (new) — pure function `assemblePlan(episodes: EpisodeCandidate[], tracks: TrackCandidate[], opts: { numberOfPodcasts: number; dryRun: boolean; now: Date }): DailyDrivePlan` that interleaves per the n+1 pattern. Throws `InsufficientCandidatesError` if fewer than N episodes or fewer than `sum(2..N+1)` songs are available.
- Type: `DailyDrivePlan = { items: Array<{ kind: "podcast"; episode: EpisodeCandidate } | { kind: "song"; track: TrackCandidate }>; generated_at: string; dry_run: boolean }`.

**Tests**
- N=8 → 52 items, ordered Pod, song×2, Pod, song×3, …, Pod, song×9.
- Last item is always a song.
- Track IDs are unique within `items`.
- Insufficient inputs throw with a clear message.

---

## Phase 6 — Playlist writer (medium)

**Files**
- `src/SpotifyPlaylist.ts` (new) — `replacePlaylist(playlistId: string, plan: DailyDrivePlan): Promise<void>`:
  - URI list: `spotify:episode:{id}` and `spotify:track:{id}` in plan order.
  - `PUT /v1/playlists/{id}/tracks` with the first ≤ 100 uris replaces existing contents; for N=8 (52 items) one PUT covers it. Keep the chunking code for safety (≥ 100 uses subsequent POSTs).
  - `PUT /v1/playlists/{id}` to update name (keep "Daily Drive") + description: `"Daily Drive · YYYY-MM-DD · {podcast names joined with ', '}"`.

**Tests**
- URI list assembly is correct (mix of episode/track).
- Description string assembly is correct.
- (Network calls themselves go through `SpotifyGateway` so they can be faked.)

---

## Phase 7 — CLI orchestration (small)

**Files**
- [src/index.ts](../../src/index.ts) — wire it up:
  1. Parse `--dry-run` from `process.argv` (no lib).
  2. Load `podcasts.toml`.
  3. Build the live gateway.
  4. In parallel: `selectPodcastSlots(...)` and `fetchSpotifyTracks(44+)`.
  5. `assemblePlan(...)`.
  6. **Always print the plan** as a structured table (slot/kind/title/artist-or-show/source) + a one-line summary of skipped shows.
  7. If `--dry-run`, log `DRY RUN — no Spotify changes` and exit.
  8. Otherwise, `replacePlaylist(SPOTIFY_PLAYLIST_ID, plan)`. Print success line with playlist URL.
- Add to `package.json`: nothing new; existing `"start": "tsx src/index.ts"` is enough.

**Done when**
- `npm start -- --dry-run` prints the plan and exits without touching Spotify.
- `npm start` writes the playlist and prints the playlist URL.

---

## Phase 8 — README (small)

**Files**
- `README.md`:
  - Setup steps (create Spotify app at https://developer.spotify.com, set redirect URI to `http://127.0.0.1:8888/callback`, paste client_id/secret into `.env`, run `npm run bootstrap-auth`, paste resulting refresh_token + playlist_id back into `.env`).
  - `podcasts.toml` schema + how to add a show / pin a slot.
  - Daily run: `npm start` (writes) / `npm start -- --dry-run` (prints only).
  - Note that GH Actions scheduling is a future addition (link to this plan).

---

## Sequencing

```
1 ──► 2 ──┬──► 3 ──┐
          │        ├──► 5 ──► 6 ──► 7 ──► 8
          └──► 4 ──┘
```

Phases 3 and 4 are independent and can land in parallel. Tests for each phase land alongside the phase, not at the end.

## Out of scope (deferred)

- GitHub Actions workflow + cron + workflow_dispatch.
- `state.json`, back-to-back avoidance, longest-not-heard ranking.
- Discover Weekly source, new-releases-from-followed-artists source.
- Weighted-toward-newest episode pick within a show.
- Configurable N via env var (`DAILY_DRIVE_PODCAST_COUNT`).
- Per-run history / audit log.
