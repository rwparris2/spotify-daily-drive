process.env.SPOTIFY_CLIENT_ID = 'test_client_id';
process.env.SPOTIFY_CLIENT_SECRET = 'test_client_secret';
process.env.SPOTIFY_REFRESH_TOKEN = 'test_refresh_token';
process.env.SPOTIFY_PLAYLIST_ID = 'test_playlist_id';
process.env.SPOTIFY_REDIRECT_URI = 'http://127.0.0.1:8888/callback';

import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
const testCacheDir = mkdtempSync(join(tmpdir(), 'spotify-daily-drive-test-'));
process.env.SPOTIFY_PLAYLIST_TRACKS_CACHE_PATH = join(testCacheDir, 'playlist-tracks.json');

import { afterAll, afterEach } from 'vitest';
import { mswServer } from './mswServer.js';

mswServer.listen({ onUnhandledRequest: 'error' });

afterEach(() => {
  mswServer.resetHandlers();
});

afterAll(() => {
  mswServer.close();
});
