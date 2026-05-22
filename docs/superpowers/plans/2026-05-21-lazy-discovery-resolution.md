# Lazy Discovery Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop resolving Last.fm and ListenBrainz candidates we'll throw away — shuffle the candidate pool before resolving, and stop as soon as `numberOfTracks` unique resolved tracks have been collected.

**Architecture:** Two surgical changes — one per discovery module. `src/LastFm.ts` currently resolves its full candidate pool (hundreds of candidates) before sampling 25; we'll switch it to shuffle-then-resolve-until-target so on a cold cache it does ~25 Spotify searches instead of ~500. `src/ListenBrainz.ts` already streams correctly; we'll add a shuffle so cache-miss work is spread across the MBID pool rather than clustered at the front.

**Tech Stack:** TypeScript ESM, Vitest, MSW (HTTP mocking), lodash (`_.shuffle`).

---

## File Structure

- Modify: `src/LastFm.ts` — replace "resolve all, sample 25" with "shuffle, resolve until target, dedupe in-loop"
- Modify: `src/LastFm.test.ts` — add lazy-resolution test asserting Spotify search call count
- Modify: `src/ListenBrainz.ts` — shuffle MBIDs before the resolution loop
- Modify: `src/ListenBrainz.test.ts` — add lazy-resolution test asserting Spotify search call count

No new files.

Both modules already have well-established test patterns (MSW handlers, `mockSpotifySearch`, `mockLastFm`, `mockRecommendations`, etc.) that we'll reuse.

---

### Task 1: Last.fm — shuffle and stop-at-target

**Files:**
- Modify: `src/LastFm.ts:99-121`
- Test: `src/LastFm.test.ts` (add one test inside the existing `describe('fetchLastFmDiscoveries', ...)` block)

- [ ] **Step 1: Write the failing test**

Add this test at the end of the `describe('fetchLastFmDiscoveries', ...)` block in `src/LastFm.test.ts`:

```ts
  it('stops resolving once numberOfTracks unique tracks have been collected', async () => {
    const seed = makeTrack('lazy-seed', 'Lazy Seed Song', 'Lazy Seed Artist');
    // 100 distinct similar tracks — far more than numberOfTracks.
    const similarTracks = Array.from({ length: 100 }, (_, i) => ({
      name: `Sim${i}`,
      artist: `SimArtist${i}`,
    }));
    let spotifySearchCalls = 0;

    mswServer.use(
      mockLastFm({
        trackSimilar: { 'Lazy Seed Artist|Lazy Seed Song': similarTracks },
      }),
      http.get('https://api.spotify.com/v1/search', ({ request }) => {
        spotifySearchCalls += 1;
        const q = new URL(request.url).searchParams.get('q') ?? '';
        const match = q.match(/track:"([^"]+)" artist:"([^"]+)"/);
        if (!match) return HttpResponse.json({ tracks: { items: [] } });
        const [, trackName, artistName] = match;
        return HttpResponse.json({
          tracks: {
            items: [
              {
                id: `spot-${trackName}`,
                name: trackName,
                uri: `spotify:track:spot-${trackName}`,
                artists: [{ name: artistName }],
                type: 'track',
              },
            ],
          },
        });
      }),
    );

    const result = await fetchLastFmDiscoveries({ seedTracks: [seed], numberOfTracks: 5 });

    expect(result.length).toBe(5);
    // Every candidate resolves to a unique track, so the loop should stop exactly at the target.
    expect(spotifySearchCalls).toBe(5);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- LastFm.test.ts -t "stops resolving once numberOfTracks"`

Expected: FAIL — `spotifySearchCalls` will be 100 (or whatever the candidate-pool size is after the seed-artist filter), not 5, because the current implementation resolves the entire pool before sampling.

- [ ] **Step 3: Replace the candidate-resolution loop with shuffle + stop-at-target**

In `src/LastFm.ts`, replace lines 99-122 (the block starting `const resolved: SourcedTrack[] = [];` and ending with the `return _(resolved)...` chain) with:

```ts
  const shuffledCandidates = _.shuffle(filteredCandidates);
  const resolved: SourcedTrack[] = [];
  const seenTrackIds = new Set<string>();
  let cacheHits = 0;
  let cacheMisses = 0;
  for (const c of shuffledCandidates) {
    if (resolved.length >= options.numberOfTracks) break;
    const cached = await getCachedLastFmTrack(c.artistName, c.trackName);
    let hit: Track | undefined;
    if (cached !== undefined) {
      cacheHits += 1;
      if (cached) hit = cached;
    } else {
      cacheMisses += 1;
      hit = await searchSpotifyTrack(c.artistName, c.trackName);
      await persistCacheEntry(c.artistName, c.trackName, hit ?? null);
    }
    if (hit && !seenTrackIds.has(hit.id)) {
      seenTrackIds.add(hit.id);
      resolved.push({ kind: 'track', track: hit, source: c.source });
    }
  }
  if (cacheHits > 0 || cacheMisses > 0) {
    console.log(`Last.fm→Spotify cache: ${cacheHits} hit(s), ${cacheMisses} miss(es)`);
  }

  return resolved;
```

Note the in-loop dedupe via `seenTrackIds` — this lets us count "unique resolved tracks" toward the target so we stop precisely at `numberOfTracks`. The trailing `_.uniqBy(...).sampleSize(...)` chain is gone; the shuffle handles randomness and the in-loop dedupe handles uniqueness.

- [ ] **Step 4: Run the new test to verify it passes**

Run: `npm test -- LastFm.test.ts -t "stops resolving once numberOfTracks"`

Expected: PASS — `spotifySearchCalls === 5`, `result.length === 5`.

- [ ] **Step 5: Run the full Last.fm test file to verify no regressions**

Run: `npm test -- LastFm.test.ts`

Expected: all tests pass. The existing tests don't assert on exact ordering of results — they assert on set membership (`toContain`, `not.toContain`) — so the shuffle won't break them. The dedupe test ("dedupes when the same Spotify track id is surfaced via both passes") still passes because in-loop dedupe is stricter than post-hoc `_.uniqBy`.

- [ ] **Step 6: Run typecheck**

Run: `npm run typecheck`

Expected: clean. The change preserves the public function signature.

- [ ] **Step 7: Commit**

```bash
git add src/LastFm.ts src/LastFm.test.ts
git commit -m "perf(lastfm): shuffle candidates and stop resolving at target

Resolve only as many candidates as needed instead of the full pool before sampling.
Cold-cache cost drops from ~500 Spotify searches per run to ~25."
```

---

### Task 2: ListenBrainz — shuffle MBIDs before resolving

**Files:**

- Modify: `src/ListenBrainz.ts:57-77`
- Test: `src/ListenBrainz.test.ts` (add one test inside the existing `describe('fetchListenBrainzRecommendations', ...)` block)

- [ ] **Step 1: Write the failing test**

Add this test at the end of the `describe('fetchListenBrainzRecommendations', ...)` block in `src/ListenBrainz.test.ts`:

```ts
  it('stops resolving once numberOfTracks tracks have been collected', async () => {
    // 60 MBIDs — far more than numberOfTracks.
    const mbids = Array.from({ length: 60 }, (_, i) => `lazy-mbid-${i}`);
    const metaMap = Object.fromEntries(
      mbids.map((id) => [id, { artist: `Artist-${id}`, track: `Track-${id}` }]),
    );
    let searchCalls = 0;

    mswServer.use(
      mockValidate(),
      mockRecommendations(mbids),
      http.get('https://api.listenbrainz.org/1/metadata/recording', ({ request }) => {
        const ids = new URL(request.url).searchParams.get('recording_mbids')?.split(',') ?? [];
        const result: Record<string, unknown> = {};
        for (const id of ids) {
          result[id] = {
            artist: { name: metaMap[id]!.artist },
            recording: { name: metaMap[id]!.track },
          };
        }
        return HttpResponse.json(result);
      }),
      http.get('https://api.spotify.com/v1/search', ({ request }) => {
        searchCalls += 1;
        const q = new URL(request.url).searchParams.get('q') ?? '';
        const match = q.match(/track:"([^"]+)" artist:"([^"]+)"/);
        if (!match) return HttpResponse.json({ tracks: { items: [] } });
        const [, trackName] = match;
        return HttpResponse.json({
          tracks: {
            items: [
              {
                id: `spot-${trackName}`,
                name: trackName,
                uri: `spotify:track:spot-${trackName}`,
                artists: [{ name: 'Artist' }],
                type: 'track',
              },
            ],
          },
        });
      }),
    );

    const result = await fetchListenBrainzRecommendations({ numberOfTracks: 5 });

    expect(result.length).toBe(5);
    expect(searchCalls).toBe(5);
  });
```

This test already passes today on the call-count axis (ListenBrainz already breaks when `tracks.length >= numberOfTracks`) — what it pins down is that adding the shuffle doesn't *break* the early-stop guarantee.

- [ ] **Step 2: Run test to verify it passes today (before changes)**

Run: `npm test -- ListenBrainz.test.ts -t "stops resolving once numberOfTracks"`

Expected: PASS. This confirms the test is correctly written and that today's ListenBrainz already stops early. We're locking that property in before adding the shuffle so we don't accidentally break it.

- [ ] **Step 3: Add the shuffle**

In `src/ListenBrainz.ts`, near the top of the file add the lodash import:

```ts
import _ from 'lodash';
```

Then in `fetchListenBrainzRecommendations`, change the resolution-loop header. The current code (around line 58) is:

```ts
  const tracks: SourcedTrack[] = [];
  for (const musicBrainzId of musicBrainzIds) {
```

Replace with:

```ts
  const tracks: SourcedTrack[] = [];
  for (const musicBrainzId of _.shuffle(musicBrainzIds)) {
```

That's the entire change. Metadata fetching stays bulk (cheap, batched at 25-per-request); only the resolution-loop iteration order changes.

- [ ] **Step 4: Run the lazy-resolution test again to verify it still passes**

Run: `npm test -- ListenBrainz.test.ts -t "stops resolving once numberOfTracks"`

Expected: PASS — `searchCalls === 5`, `result.length === 5`.

- [ ] **Step 5: Run the full ListenBrainz test file to verify no regressions**

Run: `npm test -- ListenBrainz.test.ts`

Expected: all tests pass. Existing tests assert on result length / membership / source labels, not on the specific MBID-to-track mapping order, so the shuffle is invisible to them.

- [ ] **Step 6: Run typecheck**

Run: `npm run typecheck`

Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/ListenBrainz.ts src/ListenBrainz.test.ts
git commit -m "perf(listenbrainz): shuffle MBIDs before resolution loop

Spreads cache-miss work across the candidate pool instead of clustering at
the front, so an unlucky run with negative-cache entries up front doesn't
exhaust the MBID pool before hitting numberOfTracks."
```

---

### Task 3: Verify the full suite still passes end-to-end

**Files:** none modified — verification only.

- [ ] **Step 1: Run the full test suite**

Run: `npm test`

Expected: all tests pass, including `SpotifyTracks.test.ts` and any integration-style tests that exercise both modules together.

- [ ] **Step 2: Run typecheck and build**

Run: `npm run typecheck && npm run build`

Expected: both succeed cleanly.

- [ ] **Step 3: Dry-run the CLI to spot-check real-world behavior**

Run: `npm start -- --dry-run`

Expected: prints a playlist plan. Watch the console output for Last.fm and ListenBrainz cache-hit/miss lines — on a warm cache they should both report mostly hits and the run should feel notably faster than before.

If `LASTFM_API_KEY` / `LISTENBRAINZ_USER_TOKEN` are unset, those sources are skipped (existing behavior). Either way, the dry-run should complete without error.

- [ ] **Step 4: No commit needed** — this task is verification only.
