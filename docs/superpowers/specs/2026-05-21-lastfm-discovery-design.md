# Last.fm Discovery Source — Design

## Goal

Add a sixth track source to Daily Drive that uses Last.fm's crowdsourced similarity graph to surface music the user hasn't heard but would likely enjoy. Runs alongside the existing five sources (the four Spotify-native fetchers and ListenBrainz CF recommendations) — does not replace any of them.

"Variety" in this design means **discovery**: stylistically-similar tracks/artists adjacent to what the user already plays, but not already in their seed pool.

## Non-goals

- Replacing ListenBrainz. The two sources sit side by side; ListenBrainz contributes its CF recommendations, Last.fm contributes similarity-graph discoveries.
- Long-term taste modeling. We seed off whatever Spotify gives us for this run; no cross-run state.
- Last.fm `user.*` endpoints. Scrobble history is ~99% Spotify-sourced for this user, so reading Last.fm's view of their listening would duplicate what we already fetch from Spotify.
- Authenticated Last.fm calls. All three endpoints we use accept an unauthenticated `api_key` query parameter.

## Architecture

### New module: `src/LastFm.ts`

Mirrors the shape of `src/ListenBrainz.ts`:

```ts
export async function fetchLastFmDiscoveries(options: {
  seedTracks: Track[];
  numberOfTracks: number;
}): Promise<SourcedTrack[]>
```

Unlike `ListenBrainz.ts`, this function takes **seed tracks as an argument** rather than fetching its own data, because the seeds come from the Spotify fetchers that have already run.

### Refactored: `src/SpotifyTracks.ts`

`fetchSpotifyTracks` becomes a two-stage flow.

**Stage 1 (parallel, today's behavior preserved):** Run the existing five sources concurrently — `playlistTracks`, `topTracks`, `recentlyPlayedTracks`, `savedTracks`, `fetchListenBrainzRecommendations`. Each contributes `requiredContributionPerSource` tracks.

**Stage 2 (sequential, new):** Pool the four Spotify-native results from stage 1 (excluding ListenBrainz — its outputs are already discovery-flavored and shouldn't seed further discovery) into a single `Track[]`. Pass that pool directly to `fetchLastFmDiscoveries({ seedTracks, numberOfTracks: requiredContributionPerSource })` — the function samples internally, no need to pre-sample at the call site.

**Merge:** Concatenate stage 1 + stage 2 outputs, dedupe by Spotify track id, `sampleSize(numberOfTracks)` as today.

The per-source contribution target stays at `Math.ceil(numberOfTracks / 4)` — Last.fm becomes a sixth source but the existing division-by-four already over-samples to allow for dedupe loss, so this stays unchanged.

## Algorithm inside `fetchLastFmDiscoveries`

1. **Derive seed sets** from the input `seedTracks`:
   - **~6 seed tracks** — `_.sampleSize(seedTracks, 6)`
   - **~4 seed artists** — unique artist names extracted from `seedTracks` (use the first artist of each track), then `_.sampleSize(..., 4)`
2. **Track similarity** — for each seed track, `GET track.getSimilar?artist=X&track=Y&limit=30`. Returns up to 30 similar tracks with artist + track name.
3. **Artist similarity** — for each seed artist:
   - `GET artist.getSimilar?artist=X&limit=10` → up to 10 similar artists
   - For each similar artist, `GET artist.getTopTracks?artist=X&limit=2` → 2 representative tracks
4. **Filter** — drop any candidate whose artist (case-insensitive) appears in the seed-artist set. We want discovery, not "more songs by artists we already have queued".
5. **Resolve to Spotify** — for each remaining candidate, `spotifyClient.search('track:"X" artist:"Y"', ['track'], 1)` and take the top hit. Same pattern as `ListenBrainz.ts:searchSpotifyTrack`. Candidates that don't resolve are silently dropped.
6. **Tag and return** — wrap each resolved `Track` as `SourcedTrack` with descriptive source strings:
   - `last.fm — similar track to "<seed track name>"` for `track.getSimilar` results
   - `last.fm — similar artist to <seed artist name>` for `artist.getSimilar` results
7. **Dedupe and sample** — `uniqBy(track.id)` then `sampleSize(numberOfTracks)`.

### API budget per run

- `track.getSimilar`: ~6 calls
- `artist.getSimilar`: ~4 calls
- `artist.getTopTracks`: ~4 × 10 = ~40 calls
- **Total: ~50 Last.fm calls per run.** Run sequentially (one at a time) to stay polite. Last.fm has no published rate limit; 5 req/sec is the community norm. ~50 calls at that pace is ~10s — acceptable for a once-daily job.

## Configuration

### New env var

- `LASTFM_API_KEY` — Last.fm API key (free registration at <https://www.last.fm/api/account/create>). Single string, no per-user scope.

### Optional, not required

Follows the ListenBrainz pattern: if `LASTFM_API_KEY` is unset, `fetchLastFmDiscoveries` logs a warning and returns `[]` immediately without making any calls. Users who don't want Last.fm discovery simply leave the variable unset. **Do not add it to `src/config.ts`'s `required(...)` list** — read it directly from `process.env` inside the module.

### Updates

- `.env.example`: add `LASTFM_API_KEY=` with a comment pointing at the registration URL
- `README.md`: add `LASTFM_API_KEY` to the env-var table with note that it's optional
- `.github/workflows/daily-drive.yml`: add `LASTFM_API_KEY: ${{ secrets.LASTFM_API_KEY }}` to the env block so scheduled runs can use it

## API details

Base URL: `https://ws.audioscrobbler.com/2.0/`

All endpoints are GET with query params. JSON response requires `&format=json`. Each request must include `&api_key=<KEY>`.

### `track.getSimilar`

```text
?method=track.getSimilar&artist=<name>&track=<title>&limit=30&api_key=<KEY>&format=json
```

Response shape (relevant fields):

```json
{
  "similartracks": {
    "track": [
      { "name": "...", "artist": { "name": "..." } },
      ...
    ]
  }
}
```

### `artist.getSimilar`

```text
?method=artist.getSimilar&artist=<name>&limit=10&api_key=<KEY>&format=json
```

Response shape:

```json
{
  "similarartists": {
    "artist": [
      { "name": "..." },
      ...
    ]
  }
}
```

### `artist.getTopTracks`

```text
?method=artist.getTopTracks&artist=<name>&limit=2&api_key=<KEY>&format=json
```

Response shape:

```json
{
  "toptracks": {
    "track": [
      { "name": "...", "artist": { "name": "..." } },
      ...
    ]
  }
}
```

## Error handling

Mirrors `ListenBrainz.ts`'s partial-failure philosophy — any Last.fm failure logs and returns `[]` rather than throwing, so one bad request doesn't kill the run.

| Condition | Behavior |
| --- | --- |
| `LASTFM_API_KEY` unset | Log warning once, return `[]` immediately. No HTTP calls. |
| Network error on any Last.fm call | Log, treat that seed as empty, continue with other seeds. |
| Non-200 HTTP status | Log status code, treat that seed as empty, continue. |
| Empty / malformed JSON | Log, treat that seed as empty, continue. |
| Spotify search miss for a candidate | Silently skip that candidate (same as ListenBrainz). |
| Zero candidates after all seeds | Return `[]`. Stage-1 sources still contribute. |

No retry logic in v1. Last.fm's transient failures are rare and the once-daily cadence makes retry unnecessary.

## Testing

New file: `src/__tests__/LastFm.test.ts`, using Vitest + MSW following the existing test conventions.

### MSW handlers (new)

Stub `https://ws.audioscrobbler.com/2.0/` with route-by-`method`-param handlers for:

- `track.getSimilar` — happy path returning ~5 similar tracks
- `artist.getSimilar` — happy path returning ~3 similar artists
- `artist.getTopTracks` — happy path returning 2 tracks

### Test cases

1. **Happy path** — given a seed track set, returns Spotify-resolved discoveries tagged with the right `source`.
2. **Missing API key** — `LASTFM_API_KEY` unset → returns `[]`, no HTTP calls made (assert via MSW spy).
3. **Per-seed failure isolation** — one `track.getSimilar` call 500s; other seeds still produce results.
4. **Seed-artist filter** — a similar-tracks response that contains a seed artist is dropped from the output.
5. **Spotify search miss** — a Last.fm candidate that doesn't resolve via Spotify search is silently skipped without affecting others.
6. **Dedupe** — the same Spotify track id surfaced via both `track.getSimilar` and `artist.getTopTracks` appears only once in the output.

### Integration test

Extend the existing end-to-end test in `src/__tests__/` (if one exists for `fetchSpotifyTracks`) to assert Last.fm-tagged tracks appear in the merged output when MSW serves Last.fm responses.

## File changes summary

| File | Change |
| --- | --- |
| `src/LastFm.ts` | New module — implements `fetchLastFmDiscoveries` |
| `src/SpotifyTracks.ts` | Refactor `fetchSpotifyTracks` to two-stage flow; add Last.fm to the merge |
| `src/__tests__/LastFm.test.ts` | New test file |
| `src/__tests__/msw-handlers.ts` (or wherever Spotify handlers live) | Add Last.fm handlers |
| `.env.example` | Add `LASTFM_API_KEY=` |
| `README.md` | Document `LASTFM_API_KEY` env var |
| `.github/workflows/daily-drive.yml` | Add `LASTFM_API_KEY` to env block from secrets |

No changes to: `SpotifyClient.ts`, `SpotifyPlaylist.ts`, `SpotifyPodcasts.ts`, `ListenBrainz.ts`, `config.ts`, `index.ts`.

## Open questions

None remaining at design time. Implementation-time decisions (exact MSW handler structure, naming of internal helpers) follow existing conventions in `ListenBrainz.ts`.
