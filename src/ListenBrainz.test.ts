import type { Track } from '@spotify/web-api-ts-sdk';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mswServer } from './__tests__/mswServer.js';
import { fetchListenBrainzRecommendations } from './ListenBrainz.js';
import {
  getCachedListenBrainzTrack,
  setCachedListenBrainzTrack,
} from './ListenBrainzSpotifyCache.js';

const PLAYLIST_EXT_KEY = 'https://musicbrainz.org/doc/jspf#playlist';

function mockValidate(username = 'user', valid = true) {
  return http.get('https://api.listenbrainz.org/1/validate-token', () =>
    HttpResponse.json({ valid, user_name: valid ? username : undefined }),
  );
}

type PlaylistFixture = {
  mbid: string;
  sourcePatch: string;
  tracks: { mbid: string; artist: string; title: string }[];
};

function mockCreatedFor(playlists: PlaylistFixture[]) {
  return http.get(
    'https://api.listenbrainz.org/1/user/:username/playlists/createdfor',
    () =>
      HttpResponse.json({
        playlists: playlists.map((p) => ({
          playlist: {
            identifier: `https://listenbrainz.org/playlist/${p.mbid}`,
            extension: {
              [PLAYLIST_EXT_KEY]: {
                additional_metadata: { algorithm_metadata: { source_patch: p.sourcePatch } },
              },
            },
            track: [],
          },
        })),
      }),
  );
}

function mockPlaylist(playlists: PlaylistFixture[]) {
  return http.get('https://api.listenbrainz.org/1/playlist/:mbid', ({ params }) => {
    const fixture = playlists.find((p) => p.mbid === params.mbid);
    if (!fixture) return HttpResponse.json({ playlist: { track: [] } });
    return HttpResponse.json({
      playlist: {
        identifier: `https://listenbrainz.org/playlist/${fixture.mbid}`,
        track: fixture.tracks.map((t) => ({
          creator: t.artist,
          title: t.title,
          identifier: [`https://musicbrainz.org/recording/${t.mbid}`],
        })),
      },
    });
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

const JAMS_MBID = '11111111-1111-1111-1111-111111111111';
const EXPLORATION_MBID = '22222222-2222-2222-2222-222222222222';

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

  it('returns [] when createdfor returns no playlists', async () => {
    mswServer.use(
      mockValidate(),
      http.get('https://api.listenbrainz.org/1/user/:username/playlists/createdfor', () =>
        HttpResponse.json({ playlists: [] }),
      ),
    );
    const result = await fetchListenBrainzRecommendations({ numberOfTracks: 5 });
    expect(result).toEqual([]);
  });

  it('returns [] when no playlists match weekly-jams or weekly-exploration', async () => {
    mswServer.use(
      mockValidate(),
      mockCreatedFor([
        {
          mbid: '33333333-3333-3333-3333-333333333333',
          sourcePatch: 'daily-jams',
          tracks: [],
        },
      ]),
      mockPlaylist([]),
    );
    const result = await fetchListenBrainzRecommendations({ numberOfTracks: 5 });
    expect(result).toEqual([]);
  });

  it('resolves tracks from both weekly playlists with distinct source labels', async () => {
    const fixtures: PlaylistFixture[] = [
      {
        mbid: JAMS_MBID,
        sourcePatch: 'weekly-jams',
        tracks: [
          {
            mbid: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            artist: 'Jams Artist',
            title: 'Jams Track',
          },
        ],
      },
      {
        mbid: EXPLORATION_MBID,
        sourcePatch: 'weekly-exploration',
        tracks: [
          {
            mbid: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
            artist: 'Exploration Artist',
            title: 'Exploration Track',
          },
        ],
      },
    ];
    let searchCount = 0;
    mswServer.use(
      mockValidate(),
      mockCreatedFor(fixtures),
      mockPlaylist(fixtures),
      http.get('https://api.spotify.com/v1/search', ({ request }) => {
        searchCount += 1;
        const q = new URL(request.url).searchParams.get('q') ?? '';
        const match = q.match(/track:"([^"]+)" artist:"([^"]+)"/);
        const title = match?.[1] ?? 'unknown';
        return HttpResponse.json({
          tracks: {
            items: [
              {
                id: `spot-${title}`,
                name: title,
                uri: `spotify:track:spot-${title}`,
                artists: [{ name: 'Artist' }],
                type: 'track',
              },
            ],
          },
        });
      }),
    );

    const result = await fetchListenBrainzRecommendations({ numberOfTracks: 10 });
    expect(searchCount).toBe(2);
    expect(result).toHaveLength(2);
    const sources = result.map((r) => r.source).sort();
    expect(sources).toEqual(['listenbrainz weekly exploration', 'listenbrainz weekly jams']);
  });

  it('skips tracks missing artist, title, or recording MBID', async () => {
    const fixtures: PlaylistFixture[] = [
      {
        mbid: JAMS_MBID,
        sourcePatch: 'weekly-jams',
        tracks: [
          { mbid: 'cccccccc-cccc-cccc-cccc-cccccccccccc', artist: 'A', title: 'OK' },
        ],
      },
    ];
    let searchCount = 0;
    mswServer.use(
      mockValidate(),
      mockCreatedFor(fixtures),
      http.get('https://api.listenbrainz.org/1/playlist/:mbid', () =>
        HttpResponse.json({
          playlist: {
            track: [
              {
                creator: 'A',
                title: 'OK',
                identifier: ['https://musicbrainz.org/recording/cccccccc-cccc-cccc-cccc-cccccccccccc'],
              },
              { creator: 'A', identifier: ['https://musicbrainz.org/recording/dddddddd-dddd-dddd-dddd-dddddddddddd'] },
              { title: 'No Artist', identifier: ['https://musicbrainz.org/recording/eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'] },
              { creator: 'A', title: 'No MBID', identifier: ['https://example.com/foo'] },
            ],
          },
        }),
      ),
      http.get('https://api.spotify.com/v1/search', () => {
        searchCount += 1;
        return HttpResponse.json({
          tracks: {
            items: [
              {
                id: 'spot-ok',
                name: 'OK',
                uri: 'spotify:track:spot-ok',
                artists: [{ name: 'A' }],
                type: 'track',
              },
            ],
          },
        });
      }),
    );

    const result = await fetchListenBrainzRecommendations({ numberOfTracks: 10 });
    expect(searchCount).toBe(1);
    expect(result).toHaveLength(1);
  });

  it('uses cached Spotify track and skips search on cache hit', async () => {
    const cachedTrack = {
      id: 'cached-spot-1',
      name: 'Cached Track',
      uri: 'spotify:track:cached-spot-1',
      artists: [{ name: 'A' }],
      type: 'track',
    } as unknown as Track;
    await setCachedListenBrainzTrack('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', cachedTrack);
    await setCachedListenBrainzTrack('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', null);

    const fixtures: PlaylistFixture[] = [
      {
        mbid: JAMS_MBID,
        sourcePatch: 'weekly-jams',
        tracks: [
          { mbid: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', artist: 'A', title: 'Cached' },
          { mbid: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', artist: 'A', title: 'Negative Cached' },
        ],
      },
    ];
    let searchCount = 0;
    mswServer.use(
      mockValidate(),
      mockCreatedFor(fixtures),
      mockPlaylist(fixtures),
      http.get('https://api.spotify.com/v1/search', () => {
        searchCount += 1;
        return HttpResponse.json({ tracks: { items: [] } });
      }),
    );

    const result = await fetchListenBrainzRecommendations({ numberOfTracks: 5 });
    expect(searchCount).toBe(0);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      kind: 'track',
      source: 'listenbrainz weekly jams',
      track: { id: 'cached-spot-1' },
    });
  });

  it('persists negative cache entries when Spotify search returns no match', async () => {
    const missMbid = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
    const fixtures: PlaylistFixture[] = [
      {
        mbid: JAMS_MBID,
        sourcePatch: 'weekly-jams',
        tracks: [{ mbid: missMbid, artist: 'A', title: 'T' }],
      },
    ];
    mswServer.use(
      mockValidate(),
      mockCreatedFor(fixtures),
      mockPlaylist(fixtures),
      mockSpotifySearch(null),
    );
    await fetchListenBrainzRecommendations({ numberOfTracks: 5 });
    expect(await getCachedListenBrainzTrack(missMbid)).toBeNull();
  });

  it('samples up to numberOfTracks across both playlists', async () => {
    const makeTracks = (prefix: string, count: number) =>
      Array.from({ length: count }, (_, i) => ({
        mbid: `${prefix}${String(i).padStart(8, '0')}-0000-0000-0000-000000000000`,
        artist: `Artist-${prefix}-${i}`,
        title: `Track-${prefix}-${i}`,
      }));
    const fixtures: PlaylistFixture[] = [
      { mbid: JAMS_MBID, sourcePatch: 'weekly-jams', tracks: makeTracks('a', 20) },
      { mbid: EXPLORATION_MBID, sourcePatch: 'weekly-exploration', tracks: makeTracks('b', 20) },
    ];
    mswServer.use(
      mockValidate(),
      mockCreatedFor(fixtures),
      mockPlaylist(fixtures),
      http.get('https://api.spotify.com/v1/search', ({ request }) => {
        const q = new URL(request.url).searchParams.get('q') ?? '';
        const title = q.match(/track:"([^"]+)"/)?.[1] ?? 'x';
        return HttpResponse.json({
          tracks: {
            items: [
              {
                id: `spot-${title}`,
                name: title,
                uri: `spotify:track:spot-${title}`,
                artists: [{ name: 'A' }],
                type: 'track',
              },
            ],
          },
        });
      }),
    );

    const result = await fetchListenBrainzRecommendations({ numberOfTracks: 15 });
    expect(result).toHaveLength(15);
  });
});
