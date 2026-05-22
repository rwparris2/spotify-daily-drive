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
});
