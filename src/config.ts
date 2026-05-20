import 'dotenv/config';

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Set ${name} in env or .env`);
    if (name === 'SPOTIFY_REFRESH_TOKEN') {
      console.error('(run bootstrap-auth once to obtain it)');
    }
    process.exit(2);
  }
  return value;
}

export const SPOTIFY_CLIENT_ID = required('SPOTIFY_CLIENT_ID');
export const SPOTIFY_CLIENT_SECRET = required('SPOTIFY_CLIENT_SECRET');
export const SPOTIFY_REDIRECT_URI =
  process.env.SPOTIFY_REDIRECT_URI ?? 'http://127.0.0.1:8888/callback';
export const SPOTIFY_PLAYLIST_ID = required('SPOTIFY_PLAYLIST_ID');
export const SPOTIFY_REFRESH_TOKEN = required('SPOTIFY_REFRESH_TOKEN');
export const PODCASTS_CONFIG_PATH = process.env.PODCASTS_CONFIG_PATH ?? 'podcasts.toml';
