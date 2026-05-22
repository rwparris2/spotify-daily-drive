import type { Track } from '@spotify/web-api-ts-sdk';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mswServer } from './__tests__/mswServer.js';
import { fetchListenBrainzRecommendations } from './ListenBrainz.js';
import {
  getCachedListenBrainzTrack,
  setCachedListenBrainzTrack,
} from './ListenBrainzSpotifyCache.js';

function mockValidate(username = 'user', valid = true) {
  return http.get('https://api.listenbrainz.org/1/validate-token', () =>
    HttpResponse.json({ valid, user_name: valid ? username : undefined }),
  );
}

function mockRecommendations(mbids: string[]) {
  return http.get('https://api.listenbrainz.org/1/cf/recommendation/user/:username/recording', () =>
    HttpResponse.json({
      payload: { mbids: mbids.map((id) => ({ recording_mbid: id, score: 1 })) },
    }),
  );
}

function mockMetadata(map: Record<string, { artist: string; track: string }>) {
  return http.get('https://api.listenbrainz.org/1/metadata/recording', ({ request }) => {
    const ids = new URL(request.url).searchParams.get('recording_mbids')?.split(',') ?? [];
    const result: Record<string, unknown> = {};
    for (const id of ids) {
      if (map[id])
        result[id] = { artist: { name: map[id].artist }, recording: { name: map[id].track } };
    }
    return HttpResponse.json(result);
  });
}

function mockSpotifySearch(hit: { id: string; name: string } | null) {
  return http.get('https://api.spotify.com/v1/search', () =>
    HttpResponse.json({
      tracks: {
        items: hit
          ? [
              {
                id: hit.id,
                name: hit.name,
                uri: `spotify:track:${hit.id}`,
                artists: [{ name: 'Artist' }],
                type: 'track',
              },
            ]
          : [],
      },
    }),
  );
}

describe('fetchListenBrainzRecommendations', () => {
  const originalToken = process.env.LISTENBRAINZ_USER_TOKEN;
  beforeEach(() => {
    process.env.LISTENBRAINZ_USER_TOKEN = 'lb_test_token';
  });
  afterEach(() => {
    if (originalToken === undefined) delete process.env.LISTENBRAINZ_USER_TOKEN;
    else process.env.LISTENBRAINZ_USER_TOKEN = originalToken;
  });

  it('returns [] when LISTENBRAINZ_USER_TOKEN is unset (no network calls)', async () => {
    delete process.env.LISTENBRAINZ_USER_TOKEN;
    const result = await fetchListenBrainzRecommendations({ numberOfTracks: 5 });
    expect(result).toEqual([]);
  });

  it('returns [] when token validation reports invalid', async () => {
    mswServer.use(mockValidate('user', false));
    const result = await fetchListenBrainzRecommendations({ numberOfTracks: 5 });
    expect(result).toEqual([]);
  });

  it('returns [] when recommendations endpoint returns empty body (model not trained yet)', async () => {
    mswServer.use(
      mockValidate(),
      http.get(
        'https://api.listenbrainz.org/1/cf/recommendation/user/:username/recording',
        () => new HttpResponse('', { status: 200 }),
      ),
    );
    const result = await fetchListenBrainzRecommendations({ numberOfTracks: 5 });
    expect(result).toEqual([]);
  });

  it('resolves recommendations into tagged sourced tracks', async () => {
    mswServer.use(
      mockValidate(),
      mockRecommendations(['mbid-1', 'mbid-2']),
      mockMetadata({
        'mbid-1': { artist: 'A1', track: 'T1' },
        'mbid-2': { artist: 'A2', track: 'T2' },
      }),
      mockSpotifySearch({ id: 'spot-1', name: 'T1' }),
    );
    const result = await fetchListenBrainzRecommendations({ numberOfTracks: 2 });
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]).toMatchObject({ kind: 'track', source: 'listenbrainz suggestion' });
  });

  it('skips mbids whose metadata is missing artist or track name', async () => {
    mswServer.use(
      mockValidate(),
      mockRecommendations(['ok', 'no-artist', 'no-track']),
      http.get('https://api.listenbrainz.org/1/metadata/recording', () =>
        HttpResponse.json({
          ok: { artist: { name: 'A' }, recording: { name: 'T' } },
          'no-artist': { recording: { name: 'T' } },
          'no-track': { artist: { name: 'A' } },
        }),
      ),
      mockSpotifySearch({ id: 'spot-ok', name: 'T' }),
    );
    const result = await fetchListenBrainzRecommendations({ numberOfTracks: 5 });
    expect(result.length).toBe(1);
  });

  it('chunks metadata calls to 25 mbids per request', async () => {
    const mbids = Array.from({ length: 60 }, (_, i) => `mbid-${i}`);
    const metaMap = Object.fromEntries(mbids.map((id) => [id, { artist: 'A', track: `T${id}` }]));
    let metadataCalls = 0;
    let largestBatch = 0;
    mswServer.use(
      mockValidate(),
      mockRecommendations(mbids),
      http.get('https://api.listenbrainz.org/1/metadata/recording', ({ request }) => {
        metadataCalls += 1;
        const ids = new URL(request.url).searchParams.get('recording_mbids')?.split(',') ?? [];
        largestBatch = Math.max(largestBatch, ids.length);
        const result: Record<string, unknown> = {};
        for (const id of ids) {
          result[id] = {
            artist: { name: metaMap[id]!.artist },
            recording: { name: metaMap[id]!.track },
          };
        }
        return HttpResponse.json(result);
      }),
      mockSpotifySearch({ id: 'spot', name: 'T' }),
    );
    await fetchListenBrainzRecommendations({ numberOfTracks: 5 });
    expect(largestBatch).toBeLessThanOrEqual(25);
    expect(metadataCalls).toBe(Math.ceil(60 / 25));
  });

  it('uses the cached Spotify track and skips metadata + search on a cache hit', async () => {
    // Pre-seed: cache hit for cache-hit-mbid-1, cache miss (negative) for cache-hit-mbid-2.
    const cachedTrack = {
      id: 'cached-spot-1',
      name: 'Cached T1',
      uri: 'spotify:track:cached-spot-1',
      artists: [{ name: 'A1' }],
      type: 'track',
    } as unknown as Track;
    await setCachedListenBrainzTrack('cache-hit-mbid-1', cachedTrack);
    await setCachedListenBrainzTrack('cache-hit-mbid-2', null);

    let metadataCalls = 0;
    let searchCalls = 0;
    mswServer.use(
      mockValidate(),
      mockRecommendations(['cache-hit-mbid-1', 'cache-hit-mbid-2']),
      http.get('https://api.listenbrainz.org/1/metadata/recording', () => {
        metadataCalls += 1;
        return HttpResponse.json({});
      }),
      http.get('https://api.spotify.com/v1/search', () => {
        searchCalls += 1;
        return HttpResponse.json({ tracks: { items: [] } });
      }),
    );

    const result = await fetchListenBrainzRecommendations({ numberOfTracks: 5 });
    expect(metadataCalls).toBe(0);
    expect(searchCalls).toBe(0);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      kind: 'track',
      source: 'listenbrainz suggestion',
      track: { id: 'cached-spot-1' },
    });
  });

  it('persists negative cache entries when Spotify search returns no match', async () => {
    mswServer.use(
      mockValidate(),
      mockRecommendations(['mbid-miss']),
      mockMetadata({ 'mbid-miss': { artist: 'A', track: 'T' } }),
      mockSpotifySearch(null),
    );
    await fetchListenBrainzRecommendations({ numberOfTracks: 5 });

    const { getCachedListenBrainzTrack } = await import('./ListenBrainzSpotifyCache.js');
    expect(await getCachedListenBrainzTrack('mbid-miss')).toBeNull();
  });

  it('persists negative cache entries when metadata lacks artist or track name', async () => {
    mswServer.use(
      mockValidate(),
      mockRecommendations(['mbid-meta-bad']),
      http.get('https://api.listenbrainz.org/1/metadata/recording', () =>
        HttpResponse.json({ 'mbid-meta-bad': { recording: { name: 'T' } } }),
      ),
      mockSpotifySearch(null),
    );
    await fetchListenBrainzRecommendations({ numberOfTracks: 5 });

    const { getCachedListenBrainzTrack } = await import('./ListenBrainzSpotifyCache.js');
    expect(await getCachedListenBrainzTrack('mbid-meta-bad')).toBeNull();
  });

  it('stops resolving once numberOfTracks tracks have been collected', async () => {
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
});
