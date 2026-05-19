import 'dotenv/config';
import { createServer } from 'http';
import { execFile } from 'child_process';
import { randomBytes } from 'crypto';

const SCOPES = [
  'playlist-modify-private',
  'playlist-modify-public',
  'playlist-read-collaborative',
  'playlist-read-private',
  'user-library-read',
  'user-read-recently-played',
  'user-top-read',
];

const clientId = process.env.SPOTIFY_CLIENT_ID;
const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
const redirectUri = process.env.SPOTIFY_REDIRECT_URI ?? 'http://127.0.0.1:8888/callback';

if (!clientId || !clientSecret) {
  console.error('Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET in .env');
  process.exit(2);
}

const redirectUrl = new URL(redirectUri);
const port = Number(redirectUrl.port || (redirectUrl.protocol === 'https:' ? 443 : 80));
const callbackPath = redirectUrl.pathname;
const state = randomBytes(16).toString('hex');

const authUrl = new URL('https://accounts.spotify.com/authorize');
authUrl.searchParams.set('client_id', clientId);
authUrl.searchParams.set('response_type', 'code');
authUrl.searchParams.set('redirect_uri', redirectUri);
authUrl.searchParams.set('scope', SCOPES.join(' '));
authUrl.searchParams.set('state', state);
authUrl.searchParams.set('show_dialog', 'true');

const server = createServer(async (req, res) => {
  if (!req.url) return;
  const url = new URL(req.url, redirectUri);
  if (url.pathname !== callbackPath) {
    res.writeHead(404).end('Not found');
    return;
  }

  const code = url.searchParams.get('code');
  const returnedState = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  if (error) {
    res.writeHead(400).end(`Auth error: ${error}`);
    console.error(`Authorization failed: ${error}`);
    server.close();
    process.exit(1);
  }

  if (returnedState !== state) {
    res.writeHead(400).end('State mismatch');
    console.error('State mismatch — possible CSRF attempt');
    server.close();
    process.exit(1);
  }

  if (!code) {
    res.writeHead(400).end('Missing code');
    server.close();
    process.exit(1);
  }

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    }),
  });

  if (!tokenRes.ok) {
    const body = await tokenRes.text();
    res.writeHead(500).end(`Token exchange failed: ${body}`);
    console.error(`Token exchange failed: ${tokenRes.status} ${body}`);
    server.close();
    process.exit(1);
  }

  const token = (await tokenRes.json()) as {
    access_token: string;
    refresh_token: string;
    scope: string;
    expires_in: number;
  };

  res
    .writeHead(200, { 'Content-Type': 'text/html' })
    .end('<h1>Authorized</h1><p>You can close this window and return to the terminal.</p>');

  console.log('\n=== Spotify Refresh Token ===\n');
  console.log(token.refresh_token);
  console.log('\nGranted scopes:', token.scope);
  console.log('\nAdd this line to your .env (replacing any existing SPOTIFY_REFRESH_TOKEN):\n');
  console.log(`SPOTIFY_REFRESH_TOKEN=${token.refresh_token}\n`);

  server.close();
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Listening on ${redirectUri}`);
  console.log('\nOpen this URL in your browser to authorize:\n');
  console.log(authUrl.toString(), '\n');

  const opener =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  execFile(opener, [authUrl.toString()], (err) => {
    if (err) console.log('(Could not auto-open browser — copy the URL above manually.)');
  });
});
