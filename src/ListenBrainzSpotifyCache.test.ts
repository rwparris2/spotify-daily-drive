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
});
