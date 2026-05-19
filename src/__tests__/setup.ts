process.env.SPOTIFY_CLIENT_ID = 'test_client_id';
process.env.SPOTIFY_CLIENT_SECRET = 'test_client_secret';
process.env.SPOTIFY_REFRESH_TOKEN = 'test_refresh_token';
process.env.SPOTIFY_PLAYLIST_ID = 'test_playlist_id';
process.env.SPOTIFY_REDIRECT_URI = 'http://127.0.0.1:8888/callback';
process.env.PODCASTS_CONFIG_PATH = 'src/__tests__/fixtures/podcasts.toml';

import { afterAll, afterEach } from 'vitest';
import { mswServer } from './mswServer.js';

mswServer.listen({ onUnhandledRequest: 'error' });

afterEach(() => {
  mswServer.resetHandlers();
});

afterAll(() => {
  mswServer.close();
});
