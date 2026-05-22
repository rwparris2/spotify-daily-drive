import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { mswServer } from './__tests__/mswServer.js';
import { fetchLastFmDiscoveries } from './LastFm.js';
import type { Track } from '@spotify/web-api-ts-sdk';

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

function makeTrack(id: string, name: string, artist: string): Track {
  return {
    id,
    name,
    uri: `spotify:track:${id}`,
    type: 'track',
    artists: [
      {
        name: artist,
        id: `${id}_artist`,
        uri: '',
        external_urls: { spotify: '' },
        href: '',
        type: 'artist',
      },
    ],
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
          Similar1: [
            { name: 'S1T1', artist: 'Similar1' },
            { name: 'S1T2', artist: 'Similar1' },
          ],
          Similar2: [
            { name: 'S2T1', artist: 'Similar2' },
            { name: 'S2T2', artist: 'Similar2' },
          ],
          Similar3: [
            { name: 'S3T1', artist: 'Similar3' },
            { name: 'S3T2', artist: 'Similar3' },
          ],
          Similar4: [
            { name: 'S4T1', artist: 'Similar4' },
            { name: 'S4T2', artist: 'Similar4' },
          ],
          Similar5: [
            { name: 'S5T1', artist: 'Similar5' },
            { name: 'S5T2', artist: 'Similar5' },
          ],
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

  it('drops candidates whose artist (case-insensitive) appears in the seed-artist set', async () => {
    const seed = makeTrack('s3', 'Seed Song', 'Seed Artist');
    mswServer.use(
      mockLastFm({
        trackSimilar: {
          'Seed Artist|Seed Song': [
            { name: 'Self Song', artist: 'seed artist' }, // case-insensitive seed-artist match — should be dropped
            { name: 'Discovery', artist: 'New Artist' }, // legit discovery — should remain
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

  it('stops resolving once numberOfTracks unique tracks have been collected', async () => {
    const seed = makeTrack('lazy-seed', 'Lazy Seed Song', 'Lazy Seed Artist');
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
    expect(spotifySearchCalls).toBe(5);
  });

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
});
