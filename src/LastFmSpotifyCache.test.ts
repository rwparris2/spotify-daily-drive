import type { Track } from '@spotify/web-api-ts-sdk';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getCachedLastFmTrack, setCachedLastFmTrack } from './LastFmSpotifyCache.js';

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
      await expect(getCachedLastFmTrack('any', 'any')).rejects.toThrow(/corrupt|Delete the file/);
    } finally {
      if (originalPath === undefined) delete process.env.LASTFM_SPOTIFY_CACHE_PATH;
      else process.env.LASTFM_SPOTIFY_CACHE_PATH = originalPath;
    }
  });
});
