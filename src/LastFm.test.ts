import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fetchLastFmDiscoveries } from './LastFm.js';
import type { Track } from '@spotify/web-api-ts-sdk';

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
});
