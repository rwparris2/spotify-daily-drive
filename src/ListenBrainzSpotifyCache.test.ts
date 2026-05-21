import type { Track } from '@spotify/web-api-ts-sdk';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  getCachedListenBrainzTrack,
  setCachedListenBrainzTrack,
} from './ListenBrainzSpotifyCache.js';

function tr(id: string): Track {
  return { id, name: `Track ${id}`, uri: `spotify:track:${id}` } as unknown as Track;
}

describe('ListenBrainzSpotifyCache', () => {
  it('returns undefined for an unknown mbid', async () => {
    const cached = await getCachedListenBrainzTrack('lb_cache_test_missing');
    expect(cached).toBeUndefined();
  });

  it('round-trips a track under the same mbid', async () => {
    const mbid = 'lb_cache_test_roundtrip';
    const track = tr('spot-1');
    await setCachedListenBrainzTrack(mbid, track);

    const cached = await getCachedListenBrainzTrack(mbid);
    expect(cached).toEqual(track);
  });

  it('remembers a negative-cache (null) entry as distinct from "missing"', async () => {
    const mbid = 'lb_cache_test_negative';
    await setCachedListenBrainzTrack(mbid, null);

    const cached = await getCachedListenBrainzTrack(mbid);
    expect(cached).toBeNull();
  });

  it('keeps cache entries for different mbids independent', async () => {
    await setCachedListenBrainzTrack('lb_cache_iso_a', tr('a1'));
    await setCachedListenBrainzTrack('lb_cache_iso_b', null);

    expect(await getCachedListenBrainzTrack('lb_cache_iso_a')).toEqual(tr('a1'));
    expect(await getCachedListenBrainzTrack('lb_cache_iso_b')).toBeNull();
  });

  it('overwrites a previous entry when set again', async () => {
    const mbid = 'lb_cache_test_overwrite';
    await setCachedListenBrainzTrack(mbid, null);
    await setCachedListenBrainzTrack(mbid, tr('replacement'));

    expect(await getCachedListenBrainzTrack(mbid)).toEqual(tr('replacement'));
  });

  it('surfaces a clear error when the cache file is corrupt JSON', async () => {
    vi.resetModules();
    const dir = mkdtempSync(join(tmpdir(), 'lb-cache-corrupt-'));
    const corruptPath = join(dir, 'cache.json');
    writeFileSync(corruptPath, '{not valid json', 'utf8');

    const originalPath = process.env.LISTENBRAINZ_SPOTIFY_CACHE_PATH;
    process.env.LISTENBRAINZ_SPOTIFY_CACHE_PATH = corruptPath;
    try {
      const { getCachedListenBrainzTrack: fresh } = await import(
        './ListenBrainzSpotifyCache.js?corrupt'
      );
      await expect(fresh('any')).rejects.toThrow(/corrupt|Delete the file/);
    } finally {
      if (originalPath === undefined) delete process.env.LISTENBRAINZ_SPOTIFY_CACHE_PATH;
      else process.env.LISTENBRAINZ_SPOTIFY_CACHE_PATH = originalPath;
    }
  });
});
