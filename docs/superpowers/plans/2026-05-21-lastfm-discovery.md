# Last.fm Discovery Source — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a sixth track source to Daily Drive that uses Last.fm's similarity graph (`track.getSimilar`, `artist.getSimilar`, `artist.getTopTracks`) seeded by the existing Spotify-native fetchers, contributing stylistically-adjacent discoveries to the merged track pool.

**Architecture:** New `src/LastFm.ts` module mirrors `src/ListenBrainz.ts` shape but takes seed tracks as an argument rather than fetching its own. `fetchSpotifyTracks` becomes two-stage: parallel-fan-out of the existing 5 sources, then sequential Last.fm call using the Spotify-native pool as seeds, then merge.

**Tech Stack:** TypeScript ESM, Node ≥ 20, `@spotify/web-api-ts-sdk`, lodash (sampling), MSW v2 (test HTTP intercept), Vitest.

**Spec:** [`docs/superpowers/specs/2026-05-21-lastfm-discovery-design.md`](../specs/2026-05-21-lastfm-discovery-design.md)

---

## File Map

| File | Action | Responsibility |
| --- | --- | --- |
| `src/LastFm.ts` | Create | `fetchLastFmDiscoveries` — given Spotify seed tracks, return Spotify-resolved Last.fm discoveries (uses the cache for resolution) |
| `src/LastFm.test.ts` | Create | Unit + integration tests for `fetchLastFmDiscoveries` |
| `src/LastFmSpotifyCache.ts` | Create | Persists artist+track → Spotify `Track` resolutions (mirrors `ListenBrainzSpotifyCache.ts`) |
| `src/LastFmSpotifyCache.test.ts` | Create | Unit tests for the cache module |
| `src/__tests__/setup.ts` | Modify | Delete `LASTFM_API_KEY` and route `LASTFM_SPOTIFY_CACHE_PATH` to a per-test tmpdir |
| `src/SpotifyTracks.ts` | Modify | Refactor `fetchSpotifyTracks` to two-stage flow that calls `fetchLastFmDiscoveries` after the parallel fan-out |
| `src/SpotifyTracks.test.ts` | Modify | Add integration assertion that Last.fm-tagged tracks appear in the merged output when mocked |
| `.env.template` | Modify | Add `LASTFM_API_KEY` and `LASTFM_SPOTIFY_CACHE_PATH` to the Optional section |
| `README.md` | Modify | Document `LASTFM_API_KEY` under a new "Optional: Last.fm" subsection |
| `.github/workflows/daily-drive.yml` | Modify | Add `LASTFM_API_KEY` to the `npm start` step's `env:` block |

---

## Task 1: Test environment cleanup for `LASTFM_API_KEY`

**Files:**

- Modify: `src/__tests__/setup.ts` (the existing `delete process.env.LISTENBRAINZ_USER_TOKEN` block)

**Why:** Developer `.env` files may carry a real `LASTFM_API_KEY`. Tests must not leak real network calls — mirror how `LISTENBRAINZ_USER_TOKEN` is handled.

- [ ] **Step 1: Modify `src/__tests__/setup.ts`**

  Find the existing block:

  ```ts
  // A developer's local .env may carry this; clear it so it doesn't leak real
  // network calls into tests that don't explicitly opt in.
  delete process.env.LISTENBRAINZ_USER_TOKEN;
  ```

  Replace it with:

  ```ts
  // A developer's local .env may carry these; clear them so they don't leak real
  // network calls into tests that don't explicitly opt in.
  delete process.env.LISTENBRAINZ_USER_TOKEN;
  delete process.env.LASTFM_API_KEY;
  ```

- [ ] **Step 2: Run full test suite to verify no regression**

  Run: `npm test`
  Expected: All existing tests pass (no Last.fm tests yet).

- [ ] **Step 3: Commit**

  ```bash
  git add src/__tests__/setup.ts
  git commit -m "test(setup): clear LASTFM_API_KEY at startup"
  ```

---

## Task 2: Bootstrap `LastFm.ts` — missing API key returns `[]`

**Files:**

- Create: `src/LastFm.ts`
- Create: `src/LastFm.test.ts`

**Why:** Establish the module shape and the optional-config contract (mirrors `ListenBrainz.ts`). When `LASTFM_API_KEY` is unset, the function returns `[]` immediately without making HTTP calls.

- [ ] **Step 1: Write the failing test**

  Create `src/LastFm.test.ts`:

  ```ts
  import { afterEach, beforeEach, describe, expect, it } from 'vitest';
  import { fetchLastFmDiscoveries } from './LastFm.js';
  import type { Track } from '@spotify/web-api-ts-sdk';

  function makeTrack(id: string, name: string, artist: string): Track {
    return {
      id,
      name,
      uri: `spotify:track:${id}`,
      type: 'track',
      artists: [{ name: artist, id: `${id}_artist`, uri: '', external_urls: { spotify: '' }, href: '', type: 'artist' }],
      album: {} as Track['album'],
      duration_ms: 200_000,
      explicit: false,
      external_ids: {} as Track['external_ids'],
      external_urls: { spotify: '' },
      href: '',
      is_local: false,
      popularity: 0,
      preview_url: null,
      track_number: 1,
      disc_number: 1,
      is_playable: true,
    } as Track;
  }

  describe('fetchLastFmDiscoveries', () => {
    const originalKey = process.env.LASTFM_API_KEY;

    beforeEach(() => {
      process.env.LASTFM_API_KEY = 'test_lastfm_key';
    });

    afterEach(() => {
      if (originalKey === undefined) delete process.env.LASTFM_API_KEY;
      else process.env.LASTFM_API_KEY = originalKey;
    });

    it('returns [] when LASTFM_API_KEY is unset (no network calls)', async () => {
      delete process.env.LASTFM_API_KEY;
      const result = await fetchLastFmDiscoveries({
        seedTracks: [makeTrack('s1', 'Seed Song', 'Seed Artist')],
        numberOfTracks: 5,
      });
      expect(result).toEqual([]);
    });
  });
  ```

- [ ] **Step 2: Run the test to verify it fails**

  Run: `npm test -- src/LastFm.test.ts`
  Expected: FAIL — cannot resolve `./LastFm.js` (module doesn't exist yet).

- [ ] **Step 3: Create `src/LastFm.ts` with minimal implementation**

  ```ts
  import type { Track } from '@spotify/web-api-ts-sdk';
  import type { SourcedTrack } from './DailyDrivePlaylistItem.js';

  export async function fetchLastFmDiscoveries(_options: {
    seedTracks: Track[];
    numberOfTracks: number;
  }): Promise<SourcedTrack[]> {
    const apiKey = process.env.LASTFM_API_KEY;
    if (!apiKey) {
      console.warn('LASTFM_API_KEY not set; skipping Last.fm discoveries.');
      return [];
    }
    return [];
  }
  ```

- [ ] **Step 4: Run the test to verify it passes**

  Run: `npm test -- src/LastFm.test.ts`
  Expected: PASS — 1 passing.

- [ ] **Step 5: Run the typecheck**

  Run: `npm run typecheck`
  Expected: No errors.

- [ ] **Step 6: Commit**

  ```bash
  git add src/LastFm.ts src/LastFm.test.ts
  git commit -m "feat(lastfm): add module skeleton with missing-key short-circuit"
  ```

---

## Task 3: Track-similarity pass with Spotify resolution

**Files:**

- Modify: `src/LastFm.ts`
- Modify: `src/LastFm.test.ts`

**Why:** First end-to-end vertical slice. Implements `track.getSimilar` + Spotify search resolution. We add the MSW mock helper, write a happy-path test, then build the minimum implementation that passes it.

- [ ] **Step 1: Write the failing test**

  Append to `src/LastFm.test.ts` (inside the `describe` block):

  ```ts
  import { http, HttpResponse } from 'msw';
  import { mswServer } from './__tests__/mswServer.js';

  function mockLastFm(config: {
    trackSimilar?: Record<string, Array<{ name: string; artist: string }>>;
    artistSimilar?: Record<string, Array<{ name: string }>>;
    artistTopTracks?: Record<string, Array<{ name: string; artist: string }>>;
  }) {
    return http.get('https://ws.audioscrobbler.com/2.0/', ({ request }) => {
      const url = new URL(request.url);
      const method = url.searchParams.get('method');
      const artist = url.searchParams.get('artist') ?? '';
      const track = url.searchParams.get('track') ?? '';
      switch (method) {
        case 'track.getSimilar': {
          const key = `${artist}|${track}`;
          const tracks = config.trackSimilar?.[key] ?? [];
          return HttpResponse.json({
            similartracks: {
              track: tracks.map((t) => ({ name: t.name, artist: { name: t.artist } })),
            },
          });
        }
        case 'artist.getSimilar': {
          const artists = config.artistSimilar?.[artist] ?? [];
          return HttpResponse.json({
            similarartists: { artist: artists.map((a) => ({ name: a.name })) },
          });
        }
        case 'artist.getTopTracks': {
          const tracks = config.artistTopTracks?.[artist] ?? [];
          return HttpResponse.json({
            toptracks: {
              track: tracks.map((t) => ({ name: t.name, artist: { name: t.artist } })),
            },
          });
        }
        default:
          return new HttpResponse('unknown method', { status: 400 });
      }
    });
  }

  function mockSpotifySearch(byQuery: Record<string, { id: string; name: string; artist: string }>) {
    return http.get('https://api.spotify.com/v1/search', ({ request }) => {
      const q = new URL(request.url).searchParams.get('q') ?? '';
      const hit = byQuery[q];
      return HttpResponse.json({
        tracks: {
          items: hit
            ? [
                {
                  id: hit.id,
                  name: hit.name,
                  uri: `spotify:track:${hit.id}`,
                  artists: [{ name: hit.artist }],
                  type: 'track',
                },
              ]
            : [],
        },
      });
    });
  }
  ```

  Then add this test inside the same `describe` block:

  ```ts
  it('returns tagged tracks from track.getSimilar resolved via Spotify search', async () => {
    const seed = makeTrack('s1', 'Seed Song', 'Seed Artist');
    mswServer.use(
      mockLastFm({
        trackSimilar: {
          'Seed Artist|Seed Song': [{ name: 'Similar Song', artist: 'Other Artist' }],
        },
      }),
      mockSpotifySearch({
        'track:"Similar Song" artist:"Other Artist"': {
          id: 'spot-similar',
          name: 'Similar Song',
          artist: 'Other Artist',
        },
      }),
    );

    const result = await fetchLastFmDiscoveries({ seedTracks: [seed], numberOfTracks: 5 });

    expect(result.length).toBe(1);
    expect(result[0]).toMatchObject({
      kind: 'track',
      source: 'last.fm — similar track to "Seed Song"',
    });
    expect(result[0].track.id).toBe('spot-similar');
  });
  ```

- [ ] **Step 2: Run the test to verify it fails**

  Run: `npm test -- src/LastFm.test.ts`
  Expected: FAIL — `fetchLastFmDiscoveries` currently returns `[]` always.

- [ ] **Step 3: Implement the track-similarity pass in `src/LastFm.ts`**

  Replace the entire contents of `src/LastFm.ts`:

  ```ts
  import type { Track } from '@spotify/web-api-ts-sdk';
  import _ from 'lodash';
  import { spotifyClient } from './SpotifyClient.js';
  import type { SourcedTrack } from './DailyDrivePlaylistItem.js';

  const LASTFM_BASE = 'https://ws.audioscrobbler.com/2.0/';

  type LastFmTrack = { name?: string; artist?: { name?: string } };

  type TrackSimilarResponse = { similartracks?: { track?: LastFmTrack[] } };

  interface Candidate {
    artistName: string;
    trackName: string;
    source: string;
  }

  export async function fetchLastFmDiscoveries(options: {
    seedTracks: Track[];
    numberOfTracks: number;
  }): Promise<SourcedTrack[]> {
    const apiKey = process.env.LASTFM_API_KEY;
    if (!apiKey) {
      console.warn('LASTFM_API_KEY not set; skipping Last.fm discoveries.');
      return [];
    }

    const trackSeeds = _.sampleSize(options.seedTracks, 15);

    const candidates: Candidate[] = [];
    for (const seed of trackSeeds) {
      const artistName = seed.artists[0]?.name;
      const trackName = seed.name;
      if (!artistName || !trackName) continue;
      const similar = await lastFmGet<TrackSimilarResponse>(apiKey, 'track.getSimilar', {
        artist: artistName,
        track: trackName,
        limit: '30',
      });
      const tracks = similar?.similartracks?.track ?? [];
      for (const t of tracks) {
        if (!t.name || !t.artist?.name) continue;
        candidates.push({
          artistName: t.artist.name,
          trackName: t.name,
          source: `last.fm — similar track to "${trackName}"`,
        });
      }
    }

    const resolved: SourcedTrack[] = [];
    for (const c of candidates) {
      const hit = await searchSpotifyTrack(c.artistName, c.trackName);
      if (hit) resolved.push({ kind: 'track', track: hit, source: c.source });
    }

    return _(resolved)
      .uniqBy((st) => st.track.id)
      .sampleSize(options.numberOfTracks)
      .value();
  }

  async function lastFmGet<T>(
    apiKey: string,
    method: string,
    params: Record<string, string>,
  ): Promise<T | undefined> {
    const query = new URLSearchParams({ ...params, method, api_key: apiKey, format: 'json' });
    try {
      const res = await fetch(`${LASTFM_BASE}?${query.toString()}`);
      if (!res.ok) {
        console.error(`Last.fm ${method} failed: ${res.status}`);
        return undefined;
      }
      return (await res.json()) as T;
    } catch (e) {
      console.error(`Last.fm ${method} error:`, (e as Error).message);
      return undefined;
    }
  }

  async function searchSpotifyTrack(
    artistName: string,
    trackName: string,
  ): Promise<Track | undefined> {
    const safeTrack = trackName.replace(/"/g, '');
    const safeArtist = artistName.replace(/"/g, '');
    const query = `track:"${safeTrack}" artist:"${safeArtist}"`;
    try {
      const result = await spotifyClient.search(query, ['track'], undefined, 1);
      return result.tracks?.items?.[0];
    } catch (e) {
      console.error(
        `Spotify search failed for "${trackName}" by ${artistName}:`,
        (e as Error).message,
      );
      return undefined;
    }
  }
  ```

- [ ] **Step 4: Run the test to verify it passes**

  Run: `npm test -- src/LastFm.test.ts`
  Expected: PASS — 2 passing (missing-key test + track-similarity test).

- [ ] **Step 5: Typecheck**

  Run: `npm run typecheck`
  Expected: No errors.

- [ ] **Step 6: Commit**

  ```bash
  git add src/LastFm.ts src/LastFm.test.ts
  git commit -m "feat(lastfm): track.getSimilar pass with Spotify resolution"
  ```

---

## Task 4: Cache Last.fm → Spotify track resolution

**Files:**

- Create: `src/LastFmSpotifyCache.ts`
- Create: `src/LastFmSpotifyCache.test.ts`
- Modify: `src/__tests__/setup.ts`
- Modify: `src/LastFm.ts`
- Modify: `src/LastFm.test.ts`

**Why:** Each Last.fm candidate triggers a Spotify search. Day-to-day the same candidates recur often, so caching artist+track → Spotify `Track` resolutions cuts Spotify search API calls significantly. Mirror the existing `ListenBrainzSpotifyCache` pattern, but keyed by lowercased `"artist|track"` (Last.fm's similarity endpoints don't return stable MusicBrainz IDs).

**Reference files** (read these before starting):
- `src/ListenBrainzSpotifyCache.ts` — the cache module to mirror
- `src/ListenBrainzSpotifyCache.test.ts` — the test pattern to mirror
- `src/ListenBrainz.ts` — see how the cache is wired into the resolution loop (lines ~38–77 and `persistCacheEntry` helper)

- [ ] **Step 1: Route `LASTFM_SPOTIFY_CACHE_PATH` to a tmpdir in tests**

  Edit `src/__tests__/setup.ts`. Find the existing line:

  ```ts
  process.env.LISTENBRAINZ_SPOTIFY_CACHE_PATH = join(testCacheDir, 'listenbrainz-spotify-tracks.json');
  ```

  Add a sibling line immediately below:

  ```ts
  process.env.LASTFM_SPOTIFY_CACHE_PATH = join(testCacheDir, 'lastfm-spotify-tracks.json');
  ```

- [ ] **Step 2: Write the failing cache-module tests**

  Create `src/LastFmSpotifyCache.test.ts`:

  ```ts
  import type { Track } from '@spotify/web-api-ts-sdk';
  import { writeFileSync, mkdtempSync } from 'node:fs';
  import { tmpdir } from 'node:os';
  import { join } from 'node:path';
  import { describe, expect, it } from 'vitest';
  import {
    getCachedLastFmTrack,
    setCachedLastFmTrack,
  } from './LastFmSpotifyCache.js';

  function tr(id: string): Track {
    return { id, name: `Track ${id}`, uri: `spotify:track:${id}` } as unknown as Track;
  }

  describe('LastFmSpotifyCache', () => {
    it('returns undefined for an unknown (artist, track) pair', async () => {
      const cached = await getCachedLastFmTrack('Nobody', 'Nothing');
      expect(cached).toBeUndefined();
    });

    it('round-trips a Track under the same (artist, track) key', async () => {
      const track = tr('spot-rt');
      await setCachedLastFmTrack('Artist RT', 'Track RT', track);
      const cached = await getCachedLastFmTrack('Artist RT', 'Track RT');
      expect(cached).toEqual(track);
    });

    it('treats keys case-insensitively (normalizes to lowercase)', async () => {
      await setCachedLastFmTrack('Artist Mixed', 'Track Mixed', tr('spot-mixed'));
      expect(await getCachedLastFmTrack('artist mixed', 'track mixed')).toEqual(tr('spot-mixed'));
      expect(await getCachedLastFmTrack('ARTIST MIXED', 'TRACK MIXED')).toEqual(tr('spot-mixed'));
    });

    it('remembers a negative-cache (null) entry as distinct from "missing"', async () => {
      await setCachedLastFmTrack('Artist Neg', 'Track Neg', null);
      const cached = await getCachedLastFmTrack('Artist Neg', 'Track Neg');
      expect(cached).toBeNull();
    });

    it('keeps cache entries for different (artist, track) pairs independent', async () => {
      await setCachedLastFmTrack('Iso A', 'Track A', tr('a1'));
      await setCachedLastFmTrack('Iso B', 'Track B', null);
      expect(await getCachedLastFmTrack('Iso A', 'Track A')).toEqual(tr('a1'));
      expect(await getCachedLastFmTrack('Iso B', 'Track B')).toBeNull();
    });

    it('overwrites a previous entry when set again', async () => {
      await setCachedLastFmTrack('Artist OW', 'Track OW', null);
      await setCachedLastFmTrack('Artist OW', 'Track OW', tr('replacement'));
      expect(await getCachedLastFmTrack('Artist OW', 'Track OW')).toEqual(tr('replacement'));
    });

    it('surfaces a clear error when the cache file is corrupt JSON', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'lastfm-cache-corrupt-'));
      const corruptPath = join(dir, 'cache.json');
      writeFileSync(corruptPath, '{not valid json', 'utf8');

      const originalPath = process.env.LASTFM_SPOTIFY_CACHE_PATH;
      process.env.LASTFM_SPOTIFY_CACHE_PATH = corruptPath;
      try {
        const { getCachedLastFmTrack: fresh } = await import('./LastFmSpotifyCache.js?corrupt');
        await expect(fresh('any', 'any')).rejects.toThrow(/corrupt|Delete the file/);
      } finally {
        if (originalPath === undefined) delete process.env.LASTFM_SPOTIFY_CACHE_PATH;
        else process.env.LASTFM_SPOTIFY_CACHE_PATH = originalPath;
      }
    });
  });
  ```

- [ ] **Step 3: Run the test to verify it fails**

  Run: `npm test -- src/LastFmSpotifyCache.test.ts`
  Expected: FAIL — module doesn't exist.

- [ ] **Step 4: Create the cache module**

  Create `src/LastFmSpotifyCache.ts`:

  ```ts
  import { readFile, writeFile, mkdir } from 'fs/promises';
  import { dirname } from 'path';
  import type { Track } from '@spotify/web-api-ts-sdk';

  const CACHE_PATH =
    process.env.LASTFM_SPOTIFY_CACHE_PATH ?? '.cache/lastfm-spotify-tracks.json';

  type CacheValue = Track | null;
  type CacheShape = Record<string, CacheValue>;

  let cache: CacheShape | undefined;

  function cacheKey(artistName: string, trackName: string): string {
    return `${artistName.trim().toLowerCase()}|${trackName.trim().toLowerCase()}`;
  }

  async function load(): Promise<CacheShape> {
    if (cache) return cache;
    let raw: string;
    try {
      raw = await readFile(CACHE_PATH, 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
        cache = {};
        return cache;
      }
      throw new Error(
        `Failed to read Last.fm→Spotify cache at ${CACHE_PATH}: ${(e as Error).message}`,
        { cause: e },
      );
    }
    try {
      cache = JSON.parse(raw) as CacheShape;
    } catch (e) {
      throw new Error(
        `Last.fm→Spotify cache at ${CACHE_PATH} is corrupt (${(e as Error).message}). ` +
          `Delete the file to rebuild from scratch.`,
        { cause: e },
      );
    }
    return cache;
  }

  async function persist(): Promise<void> {
    if (!cache) return;
    await mkdir(dirname(CACHE_PATH), { recursive: true });
    await writeFile(CACHE_PATH, JSON.stringify(cache, null, 2), 'utf8');
  }

  export async function getCachedLastFmTrack(
    artistName: string,
    trackName: string,
  ): Promise<Track | null | undefined> {
    const store = await load();
    const key = cacheKey(artistName, trackName);
    return key in store ? store[key] : undefined;
  }

  export async function setCachedLastFmTrack(
    artistName: string,
    trackName: string,
    track: Track | null,
  ): Promise<void> {
    const store = await load();
    store[cacheKey(artistName, trackName)] = track;
    await persist();
  }
  ```

- [ ] **Step 5: Run cache tests to verify they pass**

  Run: `npm test -- src/LastFmSpotifyCache.test.ts`
  Expected: 7 passing.

- [ ] **Step 6: Write the failing cache-integration test in `src/LastFm.test.ts`**

  Add to `src/LastFm.test.ts` inside the `describe('fetchLastFmDiscoveries', ...)` block:

  ```ts
  it('uses the cache: on second call with same candidates, Spotify search is not invoked', async () => {
    const seed = makeTrack('s-cache', 'Cache Song', 'Cache Artist');
    let spotifySearchCalls = 0;

    mswServer.use(
      mockLastFm({
        trackSimilar: {
          'Cache Artist|Cache Song': [{ name: 'Cached Hit', artist: 'Hit Artist' }],
        },
      }),
      http.get('https://api.spotify.com/v1/search', () => {
        spotifySearchCalls += 1;
        return HttpResponse.json({
          tracks: {
            items: [
              {
                id: 'spot-cached',
                name: 'Cached Hit',
                uri: 'spotify:track:spot-cached',
                artists: [{ name: 'Hit Artist' }],
                type: 'track',
              },
            ],
          },
        });
      }),
    );

    // First run — Spotify search is hit; cache gets populated.
    const first = await fetchLastFmDiscoveries({ seedTracks: [seed], numberOfTracks: 5 });
    expect(first.length).toBe(1);
    expect(spotifySearchCalls).toBe(1);

    // Second run — cache hit; no further Spotify search.
    const second = await fetchLastFmDiscoveries({ seedTracks: [seed], numberOfTracks: 5 });
    expect(second.length).toBe(1);
    expect(second[0].track.id).toBe('spot-cached');
    expect(spotifySearchCalls).toBe(1);
  });
  ```

- [ ] **Step 7: Run to verify it fails**

  Run: `npm test -- src/LastFm.test.ts`
  Expected: FAIL — `spotifySearchCalls` ends at 2 because no cache is wired in yet.

- [ ] **Step 8: Wire the cache into `src/LastFm.ts`**

  Add the cache import near the top:

  ```ts
  import {
    getCachedLastFmTrack,
    setCachedLastFmTrack,
  } from './LastFmSpotifyCache.js';
  ```

  Replace the Spotify-resolution loop. The existing loop is:

  ```ts
  const resolved: SourcedTrack[] = [];
  for (const c of candidates) {
    const hit = await searchSpotifyTrack(c.artistName, c.trackName);
    if (hit) resolved.push({ kind: 'track', track: hit, source: c.source });
  }
  ```

  Change it to:

  ```ts
  const resolved: SourcedTrack[] = [];
  let cacheHits = 0;
  let cacheMisses = 0;
  for (const c of candidates) {
    const cached = await getCachedLastFmTrack(c.artistName, c.trackName);
    if (cached !== undefined) {
      cacheHits += 1;
      if (cached) resolved.push({ kind: 'track', track: cached, source: c.source });
      continue;
    }
    cacheMisses += 1;
    const hit = await searchSpotifyTrack(c.artistName, c.trackName);
    await persistCacheEntry(c.artistName, c.trackName, hit ?? null);
    if (hit) resolved.push({ kind: 'track', track: hit, source: c.source });
  }
  if (cacheHits > 0 || cacheMisses > 0) {
    console.log(`Last.fm→Spotify cache: ${cacheHits} hit(s), ${cacheMisses} miss(es)`);
  }
  ```

  Add the `persistCacheEntry` helper at the bottom of the file, next to `searchSpotifyTrack`:

  ```ts
  async function persistCacheEntry(
    artistName: string,
    trackName: string,
    value: Track | null,
  ): Promise<void> {
    try {
      await setCachedLastFmTrack(artistName, trackName, value);
    } catch (e) {
      console.error(
        `Failed to persist Last.fm→Spotify cache for "${trackName}" by ${artistName}:`,
        (e as Error).message,
      );
    }
  }
  ```

- [ ] **Step 9: Run all tests to verify they pass**

  Run: `npm test`
  Expected: All tests pass (cache tests + LastFm tests + existing project tests).

- [ ] **Step 10: Typecheck**

  Run: `npm run typecheck`
  Expected: No errors.

- [ ] **Step 11: Commit**

  ```bash
  git add src/LastFmSpotifyCache.ts src/LastFmSpotifyCache.test.ts src/LastFm.ts src/LastFm.test.ts src/__tests__/setup.ts
  git commit -m "feat(lastfm): cache artist+track → Spotify resolution"
  ```

---

## Task 5: Artist-similarity chain (`artist.getSimilar` → `artist.getTopTracks`)

**Files:**

- Modify: `src/LastFm.ts`
- Modify: `src/LastFm.test.ts`

**Why:** Adds the second sampling pass per the spec. Independent sample of 5 seed tracks → artist similarity → sample 5 similar artists → sample 2 top tracks each.

- [ ] **Step 1: Write the failing test**

  Add to `src/LastFm.test.ts` inside the `describe` block:

  ```ts
  it('returns tagged tracks from artist.getSimilar → artist.getTopTracks chain', async () => {
    const seed = makeTrack('s2', 'Anchor Song', 'Anchor Artist');
    mswServer.use(
      mockLastFm({
        // No track similarity — artist-similarity-only test.
        trackSimilar: {},
        artistSimilar: {
          'Anchor Artist': [
            { name: 'Similar1' },
            { name: 'Similar2' },
            { name: 'Similar3' },
            { name: 'Similar4' },
            { name: 'Similar5' },
          ],
        },
        artistTopTracks: {
          Similar1: [{ name: 'S1T1', artist: 'Similar1' }, { name: 'S1T2', artist: 'Similar1' }],
          Similar2: [{ name: 'S2T1', artist: 'Similar2' }, { name: 'S2T2', artist: 'Similar2' }],
          Similar3: [{ name: 'S3T1', artist: 'Similar3' }, { name: 'S3T2', artist: 'Similar3' }],
          Similar4: [{ name: 'S4T1', artist: 'Similar4' }, { name: 'S4T2', artist: 'Similar4' }],
          Similar5: [{ name: 'S5T1', artist: 'Similar5' }, { name: 'S5T2', artist: 'Similar5' }],
        },
      }),
      // Resolve every possible candidate name to a unique Spotify id.
      http.get('https://api.spotify.com/v1/search', ({ request }) => {
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

    const result = await fetchLastFmDiscoveries({ seedTracks: [seed], numberOfTracks: 20 });

    expect(result.length).toBeGreaterThan(0);
    // All results should be tagged from the artist-similarity chain since no track.getSimilar entries match.
    for (const st of result) {
      expect(st.source).toBe('last.fm — similar artist to Anchor Artist');
    }
    // Sanity: results should come from the Similar1..Similar5 artist universe.
    for (const st of result) {
      expect(['Similar1', 'Similar2', 'Similar3', 'Similar4', 'Similar5']).toContain(
        st.track.artists[0].name,
      );
    }
  });
  ```

- [ ] **Step 2: Run the test to verify it fails**

  Run: `npm test -- src/LastFm.test.ts`
  Expected: FAIL — current implementation only does track-similarity.

- [ ] **Step 3: Add the artist-similarity pass to `src/LastFm.ts`**

  Update the response types at the top of the file (add to existing `TrackSimilarResponse` declaration):

  ```ts
  type LastFmArtist = { name?: string };

  type TrackSimilarResponse = { similartracks?: { track?: LastFmTrack[] } };
  type ArtistSimilarResponse = { similarartists?: { artist?: LastFmArtist[] } };
  type ArtistTopTracksResponse = { toptracks?: { track?: LastFmTrack[] } };
  ```

  Inside `fetchLastFmDiscoveries`, after the existing track-seed loop and before the Spotify resolution loop, insert the artist-similarity pass:

  ```ts
  const artistSeedTracks = _.sampleSize(options.seedTracks, 5);

  for (const seedTrack of artistSeedTracks) {
    const seedArtist = seedTrack.artists[0]?.name;
    if (!seedArtist) continue;

    const similarArtistsResp = await lastFmGet<ArtistSimilarResponse>(
      apiKey,
      'artist.getSimilar',
      { artist: seedArtist, limit: '20' },
    );
    const similarArtists = (similarArtistsResp?.similarartists?.artist ?? [])
      .map((a) => a.name)
      .filter((n): n is string => !!n);
    const sampledSimilarArtists = _.sampleSize(similarArtists, 5);

    for (const similarArtist of sampledSimilarArtists) {
      const topTracksResp = await lastFmGet<ArtistTopTracksResponse>(
        apiKey,
        'artist.getTopTracks',
        { artist: similarArtist, limit: '50' },
      );
      const topTracks = topTracksResp?.toptracks?.track ?? [];
      const sampledTopTracks = _.sampleSize(topTracks, 2);
      for (const t of sampledTopTracks) {
        if (!t.name || !t.artist?.name) continue;
        candidates.push({
          artistName: t.artist.name,
          trackName: t.name,
          source: `last.fm — similar artist to ${seedArtist}`,
        });
      }
    }
  }
  ```

- [ ] **Step 4: Run the test to verify it passes**

  Run: `npm test -- src/LastFm.test.ts`
  Expected: PASS — 4 passing in `src/LastFm.test.ts`.

- [ ] **Step 5: Typecheck**

  Run: `npm run typecheck`
  Expected: No errors.

- [ ] **Step 6: Commit**

  ```bash
  git add src/LastFm.ts src/LastFm.test.ts
  git commit -m "feat(lastfm): artist similarity chain with sampling"
  ```

---

## Task 6: Seed-artist filter

**Files:**

- Modify: `src/LastFm.ts`
- Modify: `src/LastFm.test.ts`

**Why:** Per the spec, drop any candidate whose artist (case-insensitive) appears in either the track-similarity seed set (artists of the 15 seed tracks) OR the artist-similarity seed set (artists of the 5 seed tracks). This enforces "discovery" rather than "more songs by artists we already have".

- [ ] **Step 1: Write the failing test**

  Add to `src/LastFm.test.ts` inside the `describe` block:

  ```ts
  it('drops candidates whose artist (case-insensitive) appears in the seed-artist set', async () => {
    const seed = makeTrack('s3', 'Seed Song', 'Seed Artist');
    mswServer.use(
      mockLastFm({
        trackSimilar: {
          'Seed Artist|Seed Song': [
            { name: 'Self Song', artist: 'seed artist' }, // case-insensitive seed-artist match — should be dropped
            { name: 'Discovery', artist: 'New Artist' },  // legit discovery — should remain
          ],
        },
      }),
      http.get('https://api.spotify.com/v1/search', ({ request }) => {
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

    // The Self Song candidate must be filtered out.
    const trackNames = result.map((st) => st.track.name);
    expect(trackNames).not.toContain('Self Song');
    expect(trackNames).toContain('Discovery');
  });
  ```

- [ ] **Step 2: Run the test to verify it fails**

  Run: `npm test -- src/LastFm.test.ts`
  Expected: FAIL — current implementation doesn't filter; "Self Song" sneaks through.

- [ ] **Step 3: Implement the filter in `src/LastFm.ts`**

  In `fetchLastFmDiscoveries`, after both seed-loop passes have populated `candidates` and BEFORE the Spotify resolution loop, add:

  ```ts
  const seedArtistNamesLower = new Set<string>(
    [...trackSeeds, ...artistSeedTracks]
      .map((t) => t.artists[0]?.name?.toLowerCase())
      .filter((n): n is string => !!n),
  );

  const filteredCandidates = candidates.filter(
    (c) => !seedArtistNamesLower.has(c.artistName.toLowerCase()),
  );
  ```

  Then change the Spotify resolution loop to iterate `filteredCandidates` instead of `candidates`:

  ```ts
  for (const c of filteredCandidates) {
    const hit = await searchSpotifyTrack(c.artistName, c.trackName);
    if (hit) resolved.push({ kind: 'track', track: hit, source: c.source });
  }
  ```

- [ ] **Step 4: Run the test to verify it passes**

  Run: `npm test -- src/LastFm.test.ts`
  Expected: PASS — 5 passing in `src/LastFm.test.ts`.

- [ ] **Step 5: Commit**

  ```bash
  git add src/LastFm.ts src/LastFm.test.ts
  git commit -m "feat(lastfm): filter out candidates from seed artists"
  ```

---

## Task 7: Per-seed failure isolation and cross-pass dedupe

**Files:**

- Modify: `src/LastFm.test.ts`

**Why:** Two regression-guard tests. (a) A 500 from one Last.fm call doesn't kill the rest of the run — already handled by `lastFmGet`'s per-method try/catch, this test prevents regression. (b) The same Spotify track id surfaced via both `track.getSimilar` AND `artist.getTopTracks` appears only once in the merged output — already handled by `uniqBy(track.id)` in step 5, this test prevents regression.

- [ ] **Step 1: Write the failing test**

  Add to `src/LastFm.test.ts` inside the `describe` block:

  ```ts
  it('isolates per-seed failures — one bad seed does not kill other seeds', async () => {
    const goodSeed = makeTrack('g1', 'Good Song', 'Good Artist');
    const badSeed = makeTrack('b1', 'Bad Song', 'Bad Artist');

    mswServer.use(
      http.get('https://ws.audioscrobbler.com/2.0/', ({ request }) => {
        const url = new URL(request.url);
        const method = url.searchParams.get('method');
        const artist = url.searchParams.get('artist') ?? '';
        const track = url.searchParams.get('track') ?? '';
        if (method === 'track.getSimilar' && artist === 'Bad Artist') {
          return new HttpResponse('boom', { status: 500 });
        }
        if (method === 'track.getSimilar' && artist === 'Good Artist' && track === 'Good Song') {
          return HttpResponse.json({
            similartracks: {
              track: [{ name: 'Survivor', artist: { name: 'Survivor Artist' } }],
            },
          });
        }
        // Stub the artist-similarity chain as empty so this test isolates track-similarity.
        if (method === 'artist.getSimilar') {
          return HttpResponse.json({ similarartists: { artist: [] } });
        }
        return HttpResponse.json({});
      }),
      http.get('https://api.spotify.com/v1/search', ({ request }) => {
        const q = new URL(request.url).searchParams.get('q') ?? '';
        if (q.includes('Survivor')) {
          return HttpResponse.json({
            tracks: {
              items: [
                {
                  id: 'spot-survivor',
                  name: 'Survivor',
                  uri: 'spotify:track:spot-survivor',
                  artists: [{ name: 'Survivor Artist' }],
                  type: 'track',
                },
              ],
            },
          });
        }
        return HttpResponse.json({ tracks: { items: [] } });
      }),
    );

    const result = await fetchLastFmDiscoveries({
      seedTracks: [goodSeed, badSeed],
      numberOfTracks: 5,
    });

    // The good seed's discovery survives the bad seed's failure.
    const trackNames = result.map((st) => st.track.name);
    expect(trackNames).toContain('Survivor');
  });
  ```

- [ ] **Step 2: Run the test**

  Run: `npm test -- src/LastFm.test.ts`
  Expected: PASS — 6 passing in `src/LastFm.test.ts` (existing per-seed try/catch in `lastFmGet` already handles failure).

  If it FAILS, the implementation is missing per-seed isolation — fix by ensuring `lastFmGet` returns `undefined` on non-OK / thrown responses and that the surrounding loop tolerates `undefined` (already the case in the current implementation).

- [ ] **Step 3: Write the cross-pass dedupe test**

  Add to `src/LastFm.test.ts` inside the `describe` block:

  ```ts
  it('dedupes when the same Spotify track id is surfaced via both passes', async () => {
    const seed = makeTrack('s4', 'Shared Seed', 'Shared Artist');
    mswServer.use(
      mockLastFm({
        // track.getSimilar returns a track that will resolve to spot-shared.
        trackSimilar: {
          'Shared Artist|Shared Seed': [{ name: 'Shared Hit', artist: 'Other Artist' }],
        },
        // artist.getSimilar → artist.getTopTracks also returns a track that resolves to spot-shared.
        artistSimilar: {
          'Shared Artist': [{ name: 'Other Artist' }],
        },
        artistTopTracks: {
          'Other Artist': [{ name: 'Shared Hit', artist: 'Other Artist' }],
        },
      }),
      // Both paths land on the same Spotify id.
      http.get('https://api.spotify.com/v1/search', () =>
        HttpResponse.json({
          tracks: {
            items: [
              {
                id: 'spot-shared',
                name: 'Shared Hit',
                uri: 'spotify:track:spot-shared',
                artists: [{ name: 'Other Artist' }],
                type: 'track',
              },
            ],
          },
        }),
      ),
    );

    const result = await fetchLastFmDiscoveries({ seedTracks: [seed], numberOfTracks: 20 });
    const sharedHits = result.filter((st) => st.track.id === 'spot-shared');
    expect(sharedHits.length).toBe(1);
  });
  ```

- [ ] **Step 4: Run the test**

  Run: `npm test -- src/LastFm.test.ts`
  Expected: PASS — 7 passing in `src/LastFm.test.ts` (existing `uniqBy(track.id)` in `fetchLastFmDiscoveries` already handles this).

  If it FAILS, the `_.uniqBy((st) => st.track.id)` at the end of `fetchLastFmDiscoveries` was lost in a previous task — restore it.

- [ ] **Step 5: Commit**

  ```bash
  git add src/LastFm.test.ts
  git commit -m "test(lastfm): regression-guard per-seed isolation and cross-pass dedupe"
  ```

---

## Task 8: Wire Last.fm into `fetchSpotifyTracks`

**Files:**

- Modify: `src/SpotifyTracks.ts`
- Modify: `src/SpotifyTracks.test.ts`

**Why:** Make `fetchSpotifyTracks` two-stage: keep the existing parallel fan-out for the 4 Spotify-native sources + ListenBrainz, then call `fetchLastFmDiscoveries` with the Spotify-native pool as seeds, then merge everything.

- [ ] **Step 1: Read the existing test file to find a good insertion point**

  Run: `cat src/SpotifyTracks.test.ts | head -60`
  Locate an existing happy-path test for `fetchSpotifyTracks`. The new assertion gets added there or as a new `it(...)` next to it.

- [ ] **Step 2: Write the failing integration test**

  Add to `src/SpotifyTracks.test.ts` (inside the existing `describe('fetchSpotifyTracks', ...)` block, or create one if not present):

  Note: `http`, `HttpResponse`, `mswServer`, `mockUserPlaylists`, `mockTopTracks`, `mockRecentlyPlayed`, `mockSavedTracks`, and `fetchSpotifyTracks` are already imported at the top of this file. No new imports needed.

  ```ts
  it('includes Last.fm-tagged discoveries in the merged output when LASTFM_API_KEY is set', async () => {
    process.env.LASTFM_API_KEY = 'test_lastfm_key';
    try {
      // Stub the four Spotify-native sources with at least one track that has a recognizable artist.
      mockUserPlaylists([
        { id: 'p1', tracks: [{ id: 't1', name: 'Seed Song', artist: 'Seed Artist' }] },
      ]);
      mockTopTracks({ short_term: [], medium_term: [], long_term: [] });
      mockRecentlyPlayed([]);
      mockSavedTracks([]);

      // Stub Last.fm to return a discovery for the seed.
      mswServer.use(
        http.get('https://ws.audioscrobbler.com/2.0/', ({ request }) => {
          const url = new URL(request.url);
          const method = url.searchParams.get('method');
          if (method === 'track.getSimilar') {
            return HttpResponse.json({
              similartracks: {
                track: [{ name: 'Discovery Song', artist: { name: 'Discovery Artist' } }],
              },
            });
          }
          if (method === 'artist.getSimilar') {
            return HttpResponse.json({ similarartists: { artist: [] } });
          }
          return HttpResponse.json({});
        }),
        http.get('https://api.spotify.com/v1/search', ({ request }) => {
          const q = new URL(request.url).searchParams.get('q') ?? '';
          if (q.includes('Discovery Song')) {
            return HttpResponse.json({
              tracks: {
                items: [
                  {
                    id: 'spot-discovery',
                    name: 'Discovery Song',
                    uri: 'spotify:track:spot-discovery',
                    artists: [{ name: 'Discovery Artist' }],
                    type: 'track',
                  },
                ],
              },
            });
          }
          return HttpResponse.json({ tracks: { items: [] } });
        }),
      );

      const result = await fetchSpotifyTracks({ numberOfTracks: 20 });

      const lastFmSourced = result.filter((st) => st.source.startsWith('last.fm'));
      expect(lastFmSourced.length).toBeGreaterThan(0);
    } finally {
      delete process.env.LASTFM_API_KEY;
    }
  });
  ```

- [ ] **Step 3: Run the test to verify it fails**

  Run: `npm test -- src/SpotifyTracks.test.ts`
  Expected: FAIL — `fetchSpotifyTracks` doesn't call Last.fm yet.

- [ ] **Step 4: Refactor `fetchSpotifyTracks` in `src/SpotifyTracks.ts`**

  **Note:** The current `fetchSpotifyTracks` uses a module-level `PER_SOURCE_TRACK_COUNT` constant (= 25), and the per-source helpers `playlistTracks()/topTracks()/recentlyPlayedTracks()/savedTracks()` take no arguments. Only `fetchListenBrainzRecommendations` takes `{ numberOfTracks }`. Match that pattern.

  Add the import near the top of `src/SpotifyTracks.ts`:

  ```ts
  import { fetchLastFmDiscoveries } from './LastFm.js';
  ```

  Replace the existing body of `fetchSpotifyTracks`:

  ```ts
  export async function fetchSpotifyTracks(options: {
    numberOfTracks: number;
  }): Promise<SourcedTrack[]> {
    const [playlistResults, topResults, recentResults, savedResults, listenBrainzResults] =
      await Promise.all([
        playlistTracks(),
        topTracks(),
        recentlyPlayedTracks(),
        savedTracks(),
        fetchListenBrainzRecommendations({ numberOfTracks: PER_SOURCE_TRACK_COUNT }),
      ]);

    const spotifyNativePool: Track[] = [
      ...playlistResults,
      ...topResults,
      ...recentResults,
      ...savedResults,
    ].map((st) => st.track);

    const lastFmResults = await fetchLastFmDiscoveries({
      seedTracks: spotifyNativePool,
      numberOfTracks: PER_SOURCE_TRACK_COUNT,
    });

    const allAvailableTracks = [
      ...playlistResults,
      ...topResults,
      ...recentResults,
      ...savedResults,
      ...listenBrainzResults,
      ...lastFmResults,
    ];

    return _(allAvailableTracks)
      .chain()
      .filter((t) => !!t.track)
      .uniqBy((t) => t.track.id)
      .sampleSize(options.numberOfTracks)
      .value();
  }
  ```

- [ ] **Step 5: Run the integration test to verify it passes**

  Run: `npm test -- src/SpotifyTracks.test.ts`
  Expected: PASS.

- [ ] **Step 6: Run the full test suite**

  Run: `npm test`
  Expected: All tests pass (no regression in other files).

- [ ] **Step 7: Typecheck**

  Run: `npm run typecheck`
  Expected: No errors.

- [ ] **Step 8: Dry-run smoke test (optional, requires real `.env`)**

  If you want to see it run for real: `npm start -- --dry-run` should now log Last.fm calls and include `last.fm — ...` tagged tracks in the planned playlist output. (Requires `LASTFM_API_KEY` in `.env`.)

- [ ] **Step 9: Commit**

  ```bash
  git add src/SpotifyTracks.ts src/SpotifyTracks.test.ts
  git commit -m "feat(tracks): wire Last.fm discoveries into fetchSpotifyTracks"
  ```

---

## Task 9: Documentation and CI updates

**Files:**

- Modify: `.env.template`
- Modify: `README.md`
- Modify: `.github/workflows/daily-drive.yml`

**Why:** Make the new optional env var discoverable for humans (`.env.template`, `README.md`) and available to scheduled CI runs (workflow env block).

- [ ] **Step 1: Append `LASTFM_API_KEY` (and optional cache-path override) to `.env.template`**

  Add at the end of the file (after the `LISTENBRAINZ_USER_TOKEN` block):

  ```sh

  # Last.fm API key to mix in discoveries from Last.fm's similarity graph
  # (track.getSimilar / artist.getSimilar). Free, no OAuth — register at
  # https://www.last.fm/api/account/create.
  # When unset, Last.fm discovery is skipped entirely (no error).
  # LASTFM_API_KEY=

  # Where to persist the Last.fm → Spotify track resolution cache.
  # Default: .cache/lastfm-spotify-tracks.json
  # LASTFM_SPOTIFY_CACHE_PATH=.cache/lastfm-spotify-tracks.json
  ```

- [ ] **Step 2: Add a "Optional: Last.fm" subsection to `README.md`**

  Find the existing `### Optional: ListenBrainz` section (around line 58) and add an analogous section right after it:

  ```markdown
  ### Optional: Last.fm

  Set `LASTFM_API_KEY` (free, register at <https://www.last.fm/api/account/create>) to mix in stylistically-similar discoveries from Last.fm's similarity graph. Unset, it's skipped silently.
  ```

- [ ] **Step 3: Add `LASTFM_API_KEY` to the workflow env block**

  Edit `.github/workflows/daily-drive.yml`. Find the `env:` block under `- run: npm start` and append the new variable:

  ```yaml
        - run: npm start
          env:
            SPOTIFY_CLIENT_ID: ${{ secrets.SPOTIFY_CLIENT_ID }}
            SPOTIFY_CLIENT_SECRET: ${{ secrets.SPOTIFY_CLIENT_SECRET }}
            SPOTIFY_REFRESH_TOKEN: ${{ secrets.SPOTIFY_REFRESH_TOKEN }}
            SPOTIFY_PLAYLIST_ID: ${{ secrets.SPOTIFY_PLAYLIST_ID }}
            LASTFM_API_KEY: ${{ secrets.LASTFM_API_KEY }}
  ```

  Also update the README sentence at line 56 that lists secrets to include `LASTFM_API_KEY`:

  Find:

  ```text
  Add `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `SPOTIFY_REFRESH_TOKEN`, and `SPOTIFY_PLAYLIST_ID` as Actions secrets.
  ```

  Replace with:

  ```text
  Add `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `SPOTIFY_REFRESH_TOKEN`, `SPOTIFY_PLAYLIST_ID`, and (optionally) `LASTFM_API_KEY` as Actions secrets.
  ```

- [ ] **Step 4: Run formatter to keep style consistent**

  Run: `npm run format`
  Expected: Prettier touches up any `src/**/*.ts` whitespace from the previous tasks (no effect on `.md`/`.yml`).

- [ ] **Step 5: Run full test suite one more time**

  Run: `npm test`
  Expected: All tests pass.

- [ ] **Step 6: Typecheck**

  Run: `npm run typecheck`
  Expected: No errors.

- [ ] **Step 7: Commit**

  ```bash
  git add .env.template README.md .github/workflows/daily-drive.yml
  git commit -m "docs(lastfm): document LASTFM_API_KEY in env template, README, and CI"
  ```

- [ ] **Step 8: (Optional) Add the secret in GitHub**

  Out-of-band step the user does in the GitHub UI: Settings → Secrets and variables → Actions → New repository secret → name `LASTFM_API_KEY`, value from <https://www.last.fm/api/account/create>. Required only if you want the scheduled CI run to use Last.fm; local runs read from `.env`.

---

## Done When

- All nine tasks complete and committed.
- `npm test` and `npm run typecheck` both clean.
- A local dry-run (`npm start -- --dry-run`) with `LASTFM_API_KEY` set in `.env` logs Last.fm discoveries and they appear in the planned playlist; the cache log line shows hit/miss counts.
- A second back-to-back local dry-run reports near-100% Last.fm→Spotify cache hits (proves the cache persists and is consulted).
- A local dry-run with `LASTFM_API_KEY` unset shows the warning "LASTFM_API_KEY not set; skipping Last.fm discoveries." and otherwise runs unchanged.
