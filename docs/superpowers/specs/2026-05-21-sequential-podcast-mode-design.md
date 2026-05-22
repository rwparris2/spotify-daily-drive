# Sequential Podcast Mode — Design

## Goal

Add support for a single podcast show that should be played beginning-to-end, slot it in at podcast position 2 tied with BirdNote Daily, and replace the existing `latest_only: boolean` field with a `mode` enum so all per-show episode-selection behaviors are expressed by the same dimension.

The motivating case is a flight-training podcast (Spotify show id `4XQyGRnBcNrvmXwfP13pKH`) that only makes sense if listened to in order from episode 1.

## Non-goals

- Tracking listening progress in a local cache. We trust Spotify's `resume_point.fully_played` flag, same as every other source.
- Supporting more than one sequential show. The feature is general, but only one entry is added now.
- Changing the interleaving or playlist-replacement logic. This change is confined to podcast episode selection.
- Changing the tie behavior at a `pin_slot`. Existing `tryPick` already picks randomly when multiple shows share a slot — no code change needed for the tie.

## Architecture

### Config schema — `src/PodcastConfig.ts`

Replace the `latest_only?: boolean` field with an optional `mode` enum:

```ts
export type PodcastMode = 'default' | 'latest_only' | 'sequential';

export type PodcastConfig = {
  shows: {
    name: string;
    spotify_show_id: string;
    pin_slot?: number;
    mode?: PodcastMode; // omitted = 'default'
  }[];
};
```

`mode` is omitted from a show entry when it would be `'default'` — TOML stays clean for the majority of shows that have no special behavior.

### Episode selection — `src/SpotifyPodcasts.ts`

`pickLatestEligibleEpisode` switches on the show's mode (treating missing as `'default'`):

- **`default`**: existing behavior. Fetch the first page of 25 episodes (newest-first). Filter to releases within the last 6 months, drop fully-played, return the newest remaining.
- **`latest_only`**: existing behavior. Fetch the first page. Take the newest episode. If it's fully-played, return undefined (don't backfill a stale one).
- **`sequential`** (new): paginate through the show's episodes (50 per page, up to a cap of 10 pages / 500 episodes). Filter to playable episodes. Sort ascending by `release_date`. Return the first one where `resume_point.fully_played` is false. The 6-month release cutoff does **not** apply — the show's catalog may go back years.

If every fetched episode is `fully_played` (or the cap is reached and none of the fetched episodes are unplayed), return undefined and let the existing fallback (`tryPick` falls back to the unpinned pool) take over. The cap is generous relative to a flight-training podcast's likely catalog size, so in practice this only fires once the user has actually completed the back catalog.

Pagination uses `spotifyClient.shows.episodes(showId, 'US', limit, offset)` and stops when `page.items.length < limit` or the cap is reached. Per the project's partial-failure convention, any API error during pagination is caught, logged, and yields `undefined` for that show — one failed show does not kill the run.

### TOML — `podcasts.toml`

**1.** Add a new `[[shows]]` entry for the flight-training podcast:

```toml
[[shows]]
name = "<user fills in show name>"
spotify_show_id = "4XQyGRnBcNrvmXwfP13pKH"
pin_slot = 2
mode = "sequential"
```

**2.** Migrate every existing entry that has `latest_only = true` to `mode = "latest_only"` (drop the `latest_only` line). Entries without `latest_only` get nothing added — they default to `'default'`.

BirdNote keeps `pin_slot = 2` and (after migration) `mode = "latest_only"`. Both shows now share slot 2; the existing random-pick-among-ties in `tryPick` handles the coin flip.

### Tests — `src/__tests__/`

- Migrate the existing fixture (`src/__tests__/fixtures/podcasts.toml`) and any test using `latest_only` to the new `mode` form.
- Add an MSW handler that serves a paginated `/shows/:id/episodes` response (multiple pages, mix of played/unplayed across pages).
- Add tests covering:
  - Sequential show returns the **oldest unplayed** episode across pages.
  - Sequential show with every episode `fully_played` returns undefined (and the slot then falls back to an unpinned pick — assert against `tryPick`'s behavior or via the integration-level test).
  - Sequential show ignores the 6-month release cutoff (episode older than 6 months but unplayed is returned).
  - Two shows sharing the same `pin_slot` are both reachable — both appear in the candidate pool that `tryPick`'s `_.random` samples from.
  - Migration sanity: a show with `mode = "latest_only"` behaves identically to today's `latest_only = true`.

## Data flow

```text
loadPodcastConfig() → shows: [{name, id, pin_slot?, mode?}]
                          ↓
for each slot in 1..N:
  pinned shows for this slot   →  tryPick (random among ties)
                                     ↓
                                pickLatestEligibleEpisode
                                  switch on (mode ?? 'default'):
                                    default     → newest within 6mo, not fully_played
                                    latest_only → newest only, undefined if fully_played
                                    sequential  → paginate all, sort ASC, oldest not fully_played
```

## Open / deferred items

- **Show name.** The user fills in the actual show name when editing `podcasts.toml`; this spec doesn't hard-code it.
- **Pagination cap.** Set to 10 pages × 50 episodes = 500. Revisit if the picked show ever has a back-catalog larger than that.
- **Invalid mode values.** TOML can contain typos like `mode = "sequencial"`. Approach: in `pickLatestEligibleEpisode`, treat any unrecognized mode as `'default'` and log a warning. Don't `process.exit` — partial-failure tolerance applies.
