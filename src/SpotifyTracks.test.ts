import { describe, expect, it } from 'vitest';
import {
  mockRecentlyPlayed,
  mockSavedTracks,
  mockTopTracks,
  mockUserPlaylists,
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

    const ids = tracks.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeLessThanOrEqual(60);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.filter((id) => id === 'shared_track').length).toBeLessThanOrEqual(1);
  });

  it('still returns tracks when some sources are empty', async () => {
    mockUserPlaylists([]);
    mockTopTracks({ short_term: range('top', 10) });
    mockRecentlyPlayed([]);
    mockSavedTracks([]);

    const tracks = await fetchSpotifyTracks({ numberOfTracks: 60 });

    expect(tracks.length).toBeGreaterThan(0);
    expect(tracks.length).toBeLessThanOrEqual(10);
    expect(new Set(tracks.map((t) => t.id)).size).toBe(tracks.length);
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
    expect(new Set(tracks.map((t) => t.id)).size).toBe(tracks.length);
  });
});
