import 'dotenv/config';

const spotifyClientId = process.env.SPOTIFY_CLIENT_ID;
const spotifyClientSecret = process.env.SPOTIFY_CLIENT_SECRET;
const spotifyRedirectUri = process.env.SPOTIFY_REDIRECT_URI ?? 'http://127.0.0.1:8888/callback';
const spotifyPlaylistId = process.env.SPOTIFY_PLAYLIST_ID;
const spotifyRefreshToken = process.env.SPOTIFY_REFRESH_TOKEN;

if (!spotifyClientId) {
  console.error('Set SPOTIFY_CLIENT_ID in env or .env');
  process.exit(2);
}

if (!spotifyClientSecret) {
  console.error('Set SPOTIFY_CLIENT_SECRET in env or .env');
  process.exit(2);
}

if (!spotifyRedirectUri) {
  console.error('Set SPOTIFY_REDIRECT_URI in env or .env');
  process.exit(2);
}

if (!spotifyPlaylistId) {
  console.error('Set SPOTIFY_PLAYLIST_ID in env or .env');
  process.exit(2);
}

if (!spotifyRefreshToken) {
  console.error('Set SPOTIFY_REFRESH_TOKEN in env or .env (run bootstrap-auth once to obtain it)');
  process.exit(2);
}

export const SPOTIFY_CLIENT_ID = spotifyClientId;
export const SPOTIFY_CLIENT_SECRET = spotifyClientSecret;
export const SPOTIFY_REDIRECT_URI = spotifyRedirectUri;
export const SPOTIFY_PLAYLIST_ID = spotifyPlaylistId;
export const SPOTIFY_REFRESH_TOKEN = spotifyRefreshToken;
export const PODCASTS_CONFIG_PATH = process.env.PODCASTS_CONFIG_PATH ?? 'podcasts.toml';
