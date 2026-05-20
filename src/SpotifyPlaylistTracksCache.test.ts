import type { Track } from '@spotify/web-api-ts-sdk';
import { writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  getCachedPlaylistTracks,
  setCachedPlaylistTracks,
} from './SpotifyPlaylistTracksCache.js';

function tr(id: string): Track {
  return { id, name: `Track ${id}`, uri: `spotify:track:${id}` } as unknown as Track;
}

describe('SpotifyPlaylistTracksCache', () => {
  it('returns undefined for an unknown playlist', async () => {
    const tracks = await getCachedPlaylistTracks('cache_test_missing', 'snap_unused');
    expect(tracks).toBeUndefined();
  });

  it('round-trips tracks under the same snapshot id', async () => {
    const playlistId = 'cache_test_roundtrip';
    const snap = 'snap_1';
    const tracks = [tr('a'), tr('b'), tr('c')];
    await setCachedPlaylistTracks(playlistId, snap, tracks);

    const cached = await getCachedPlaylistTracks(playlistId, snap);
    expect(cached).toEqual(tracks);
  });

  it('returns undefined when the snapshot id no longer matches', async () => {
    const playlistId = 'cache_test_stale';
    await setCachedPlaylistTracks(playlistId, 'snap_old', [tr('a')]);

    const cached = await getCachedPlaylistTracks(playlistId, 'snap_new');
    expect(cached).toBeUndefined();
  });

  it('keeps cache entries for different playlists independent', async () => {
    await setCachedPlaylistTracks('cache_test_iso_a', 'snap_a', [tr('a1')]);
    await setCachedPlaylistTracks('cache_test_iso_b', 'snap_b', [tr('b1'), tr('b2')]);

    expect(await getCachedPlaylistTracks('cache_test_iso_a', 'snap_a')).toEqual([tr('a1')]);
    expect(await getCachedPlaylistTracks('cache_test_iso_b', 'snap_b')).toEqual([tr('b1'), tr('b2')]);
  });

  it('overwrites the entry when set with a new snapshot id', async () => {
    const playlistId = 'cache_test_overwrite';
    await setCachedPlaylistTracks(playlistId, 'snap_v1', [tr('old')]);
    await setCachedPlaylistTracks(playlistId, 'snap_v2', [tr('new1'), tr('new2')]);

    expect(await getCachedPlaylistTracks(playlistId, 'snap_v1')).toBeUndefined();
    expect(await getCachedPlaylistTracks(playlistId, 'snap_v2')).toEqual([tr('new1'), tr('new2')]);
  });

  it('surfaces a clear error when the cache file is corrupt JSON', async () => {
    vi.resetModules();
    const dir = mkdtempSync(join(tmpdir(), 'cache-corrupt-'));
    const corruptPath = join(dir, 'cache.json');
    writeFileSync(corruptPath, '{not valid json', 'utf8');

    const originalPath = process.env.SPOTIFY_PLAYLIST_TRACKS_CACHE_PATH;
    process.env.SPOTIFY_PLAYLIST_TRACKS_CACHE_PATH = corruptPath;
    try {
      const { getCachedPlaylistTracks: fresh } = await import(
        './SpotifyPlaylistTracksCache.js?corrupt'
      );
      await expect(fresh('any', 'any')).rejects.toThrow(/corrupt|Delete the file/);
    } finally {
      if (originalPath === undefined) delete process.env.SPOTIFY_PLAYLIST_TRACKS_CACHE_PATH;
      else process.env.SPOTIFY_PLAYLIST_TRACKS_CACHE_PATH = originalPath;
    }
  });
});
