# Lazy Discovery Resolution — Design

## Goal

Stop resolving discovery candidates we're going to throw away.

Both `LastFm.ts` and `ListenBrainz.ts` resolve artist/track-name pairs into Spotify `Track` objects via the Spotify search API. Each unresolved miss is a network call. Today:

- **Last.fm** builds a candidate pool of up to ~500 `(artistName, trackName)` pairs, iterates the entire pool with `searchSpotifyTrack` on every cache miss, then `sampleSize(25)`s the resolved tracks. On a cold cache that's ~500 Spotify searches to keep ~25 results — and `fetchSpotifyTracks` then further samples down to ~12 actually played.
- **ListenBrainz** already streams (it `break`s when `numberOfTracks` is reached), but resolves candidates in the *original* MBID order returned by the recommendation endpoint — so cache-miss work is concentrated at the front of the list rather than spread across the pool.

The fix is to **shuffle the candidate pool before resolving**, and (for Last.fm) **stop as soon as we have the target count**. ListenBrainz already stops; it just needs the shuffle.

## Non-goals

- Bigger architectural change of mixing unresolved candidates with resolved tracks at the `fetchSpotifyTracks` level (option B from brainstorm). Not pursuing now — option A captures most of the savings without restructuring `SourcedTrack`.
- Parallelising Spotify searches. Orthogonal concern; not addressed here.
- Changing the candidate-generation logic (similar tracks vs similar artists weighting, MBID count, etc.). The discovery shape stays identical; only resolution is laxer.

## Architecture

### `src/LastFm.ts`

After building `filteredCandidates`, shuffle it (`_.shuffle`) and resolve in order. Maintain a running `resolved: SourcedTrack[]`. After each resolution, if `resolved.length >= numberOfTracks`, break out of the loop.

Cached hits and known-null cache entries are read inside the loop (same as today) — both are essentially free, so we keep streaming through them without counting them against any budget besides the resolved-count target.

The final `_.uniqBy(...).sampleSize(numberOfTracks)` collapses to just `_.uniqBy(...)` followed by `slice(0, numberOfTracks)` — we've already drawn random candidates by virtue of the shuffle, so a second sample is redundant. Dedupe is still required because two candidates (e.g. "similar to A" and "similar to B") can resolve to the same Spotify track.

### `src/ListenBrainz.ts`

ListenBrainz already streams correctly. The only change: shuffle `musicBrainzIds` after the metadata fetch but before the resolution loop, so cache misses don't cluster at the start of whatever order ListenBrainz returned.

(Metadata is fetched in bulk for *all* uncached MBIDs up front. That's still correct — metadata calls are batched at 25-per-request and cheap; we don't want to lazy-load metadata one MBID at a time.)

## Cost model (Last.fm, illustrative)

| Scenario             | Today               | After                |
| -------------------- | ------------------- | -------------------- |
| Cold cache, all hit  | ~500 searches       | ~25 searches         |
| Warm cache, all hit  | ~0 searches (cached)| ~0 searches (cached) |
| Warm cache, 50% null | ~250 searches       | ~25 searches         |

ListenBrainz savings are smaller (already streams) but shuffling spreads misses out so that an unlucky run with mostly-null cache entries at the front doesn't exhaust the MBID pool before hitting `numberOfTracks`.

## Testing

Both modules already have tests in `src/LastFm.test.ts` and `src/ListenBrainz.test.ts` using MSW. Add cases:

- **Last.fm**: given a candidate pool larger than `numberOfTracks`, assert Spotify search is called fewer than `pool.length` times once target is reached.
- **ListenBrainz**: given MBIDs where the first N would all resolve, assert the shuffle is in effect (e.g., seed RNG or use a deterministic shuffle via `lodash.shuffle` with a stubbed `Math.random`).

Existing behavior tests (cache read/write, source labelling, returned shape) stay untouched.

## Risks

- **Determinism in tests**: shuffling makes order non-deterministic. Tests that previously asserted on specific candidate order need to either stub `Math.random` or assert on set membership instead of array order.
- **Reduced variety on a cold cache**: today's "resolve everything then sample" gives a uniform random sample over the *resolvable* subset; the new behavior gives a uniform random sample over the *full* candidate set with resolution stopping early. In practice these are very close, and the latter is what we'd want regardless — we don't want our random sampling weighted toward whatever happens to be on Spotify.
