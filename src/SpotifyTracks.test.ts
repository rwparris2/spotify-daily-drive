import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import {
  mockRecentlyPlayed,
  mockSavedTracks,
  mockTopTracks,
  mockUserPlaylists,
  mswServer,
  type TrackFixture,
} from './__tests__/mswServer.js';
import { fetchSpotifyTracks } from './SpotifyTracks.js';

function range(prefix: string, n: number): TrackFixture[] {
  return Array.from({ length: n }, (_, i) => ({ id: `${prefix}_${i}` }));
}

describe('fetchSpotifyTracks', () => {
  it('returns unique tracks deduped across sources, capped at target', async () => {
    const overlap = { id: 'shared_track' };
    mockUserPlaylists([{ id: 'p1', tracks: [overlap, ...range('p', 5)] }]);
    mockTopTracks({
      short_term: [overlap, ...range('top', 5)],
      medium_term: range('topM', 5),
      long_term: range('topL', 5),
    });
    mockRecentlyPlayed([overlap, ...range('rp', 5)]);
    mockSavedTracks([...range('sv', 5)]);

    const tracks = await fetchSpotifyTracks({ numberOfTracks: 60 });

    const ids = tracks.map((t) => t.track.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeLessThanOrEqual(60);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.filter((id) => id === 'shared_track').length).toBeLessThanOrEqual(1);
    for (const t of tracks) {
      expect(t.source).toBeTruthy();
    }
  });

  it('still returns tracks when some sources are empty', async () => {
    mockUserPlaylists([]);
    mockTopTracks({ short_term: range('top', 10) });
    mockRecentlyPlayed([]);
    mockSavedTracks([]);

    const tracks = await fetchSpotifyTracks({ numberOfTracks: 60 });

    expect(tracks.length).toBeGreaterThan(0);
    expect(tracks.length).toBeLessThanOrEqual(10);
    expect(new Set(tracks.map((t) => t.track.id)).size).toBe(tracks.length);
  });

  it('still produces tracks when an individual source 500s (partial-failure isolation)', async () => {
    mockUserPlaylists([{ id: 'p1', tracks: range('p', 10) }]);
    mockTopTracks({}); // empty; we'll override below
    mockRecentlyPlayed(range('rp', 10));
    mockSavedTracks(range('sv', 10));
    mswServer.use(
      http.get('https://api.spotify.com/v1/me/top/tracks', () =>
        new HttpResponse('boom', { status: 500 }),
      ),
    );

    const tracks = await fetchSpotifyTracks({ numberOfTracks: 30 });

    expect(tracks.length).toBeGreaterThan(0);
  });

  it('drops embedded podcast episodes that appear in user playlists', async () => {
    mockUserPlaylists([{ id: 'p1', tracks: range('p', 5) }]);
    mockTopTracks({});
    mockRecentlyPlayed([]);
    mockSavedTracks([]);
    // override the playlist items handler to mix a non-track item in
    mswServer.use(
      http.get('https://api.spotify.com/v1/playlists/p1/items', () =>
        HttpResponse.json({
          items: [
            { track: { id: 'real', uri: 'spotify:track:real', name: 'Real', artists: [{ name: 'A' }], album: { name: 'B', images: [] }, duration_ms: 1, type: 'track' } },
            { track: { id: 'ep1', uri: 'spotify:episode:ep1', name: 'Episode', type: 'episode' } },
          ],
          total: 2,
          limit: 50,
          offset: 0,
          next: null,
          previous: null,
          href: '',
        }),
      ),
    );

    const tracks = await fetchSpotifyTracks({ numberOfTracks: 30 });
    expect(tracks.some((t) => t.track.id === 'ep1')).toBe(false);
  });

  it('reaches close to the target when many candidates are available', async () => {
    mockUserPlaylists([{ id: 'p1', tracks: range('p', 30) }]);
    mockTopTracks({
      short_term: range('topS', 30),
      medium_term: range('topM', 30),
      long_term: range('topL', 30),
    });
    mockRecentlyPlayed(range('rp', 30));
    mockSavedTracks(range('sv', 50));

    const tracks = await fetchSpotifyTracks({ numberOfTracks: 60 });

    expect(tracks.length).toBeGreaterThanOrEqual(40);
    expect(tracks.length).toBeLessThanOrEqual(60);
    expect(new Set(tracks.map((t) => t.track.id)).size).toBe(tracks.length);
  });
});
