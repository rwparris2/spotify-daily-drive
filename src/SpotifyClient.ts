import { IHandleErrors, SpotifyApi, type AccessToken } from '@spotify/web-api-ts-sdk';

import { SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, SPOTIFY_REFRESH_TOKEN } from './config.js';

console.log('Authenticating with Spotify...');
const basic = Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64');
const response = await fetch('https://accounts.spotify.com/api/token', {
  method: 'POST',
  headers: {
    Authorization: `Basic ${basic}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  },
  body: new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: SPOTIFY_REFRESH_TOKEN,
  }),
});

if (!response.ok) {
  throw new Error(`Spotify token refresh failed: ${response.status} ${await response.text()}`);
}

const token = (await response.json()) as AccessToken;
token.refresh_token ??= SPOTIFY_REFRESH_TOKEN;

export const rateLimitedFetch: typeof fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const maxAttempts = 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await fetch(input, init);
    if (res.status !== 429) return res;

    const retryAfterRaw = Number(res.headers.get('retry-after'));
    const retryAfter = Number.isFinite(retryAfterRaw) && retryAfterRaw >= 0 ? retryAfterRaw : 1;
    if (retryAfter > 60) {
      throw new Error(
        `Spotify 429 on ${url}: Retry-After=${retryAfter}s (~${Math.round(retryAfter / 60)}min). ` +
          `Hard rate-limit — wait it out before re-running.`,
      );
    }
    if (attempt === maxAttempts) {
      throw new Error(
        `Spotify 429 on ${url} after ${maxAttempts} attempts (Retry-After=${retryAfter}s); giving up`,
      );
    }
    console.warn(`429 on ${url} — backing off ${retryAfter}s (attempt ${attempt}/${maxAttempts})`);
    await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
  }
  throw new Error(`rateLimitedFetch: unreachable — loop exited without returning (${url})`);
};

export const spotifyClient = SpotifyApi.withAccessToken(SPOTIFY_CLIENT_ID, token, {
  fetch: rateLimitedFetch,
});
