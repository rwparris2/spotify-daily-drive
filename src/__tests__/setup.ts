process.env.SPOTIFY_CLIENT_ID = 'test_client_id';
process.env.SPOTIFY_CLIENT_SECRET = 'test_client_secret';
process.env.SPOTIFY_REFRESH_TOKEN = 'test_refresh_token';
process.env.SPOTIFY_PLAYLIST_ID = 'test_playlist_id';
process.env.SPOTIFY_REDIRECT_URI = 'http://127.0.0.1:8888/callback';
process.env.PODCASTS_CONFIG_PATH = 'src/__tests__/fixtures/podcasts.toml';

// A developer's local .env may carry these; set to '' (not delete) so the
// `import 'dotenv/config'` that runs later via config.ts can't re-populate
// them from .env. dotenv's default override:false skips keys that already
// own a property on process.env, even if the value is empty.
process.env.LISTENBRAINZ_USER_TOKEN = '';
process.env.LASTFM_API_KEY = '';

import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
const testCacheDir = mkdtempSync(join(tmpdir(), 'spotify-daily-drive-test-'));
process.env.SPOTIFY_PLAYLIST_TRACKS_CACHE_PATH = join(testCacheDir, 'playlist-tracks.json');
process.env.LISTENBRAINZ_SPOTIFY_CACHE_PATH = join(
  testCacheDir,
  'listenbrainz-spotify-tracks.json',
);
process.env.LASTFM_SPOTIFY_CACHE_PATH = join(testCacheDir, 'lastfm-spotify-tracks.json');

import { rmSync } from 'node:fs';
import { afterAll, afterEach } from 'vitest';
import { mswServer } from './mswServer.js';
import { resetCacheForTest as resetLastFmCache } from '../LastFmSpotifyCache.js';
import { resetCacheForTest as resetListenBrainzCache } from '../ListenBrainzSpotifyCache.js';

mswServer.listen({ onUnhandledRequest: 'error' });

afterEach(() => {
  mswServer.resetHandlers();
  // Reset in-memory cache state and remove the per-test-worker disk file so
  // each test runs against a cold cache.
  resetLastFmCache();
  resetListenBrainzCache();
  rmSync(process.env.LASTFM_SPOTIFY_CACHE_PATH ?? '', { force: true });
  rmSync(process.env.LISTENBRAINZ_SPOTIFY_CACHE_PATH ?? '', { force: true });
});

afterAll(() => {
  mswServer.close();
});
