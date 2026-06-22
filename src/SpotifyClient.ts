import { SpotifyApi, type AccessToken } from '@spotify/web-api-ts-sdk';

import { SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, SPOTIFY_REFRESH_TOKEN } from './config.js';

export async function refreshAccessToken(): Promise<AccessToken> {
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
    const body = await response.text();
    let errorCode: string | undefined;
    try {
      errorCode = (JSON.parse(body) as { error?: string }).error;
    } catch {
      // Non-JSON error body — fall through to the generic message.
    }
    // Spotify returns 400 invalid_grant once a refresh token expires (6-month
    // lifetime, enforced from 2026-07-20) or is revoked. There is no live user
    // session to redirect, so recovery is operational — surface the exact steps.
    if (response.status === 400 && errorCode === 'invalid_grant') {
      throw new Error(
        [
          'FATAL: Spotify refresh token expired or revoked (invalid_grant).',
          'The 6-month token lifetime has elapsed (see Spotify dev blog, 2026-06-18).',
          '',
          'To fix:',
          '  1. Run `npm run bootstrap-auth` locally',
          '  2. Update the SPOTIFY_REFRESH_TOKEN GitHub secret with the new value',
        ].join('\n'),
      );
    }
    throw new Error(`Spotify token refresh failed: ${response.status} ${body}`);
  }

  const token = (await response.json()) as AccessToken;
  // Spotify omits refresh_token from refresh responses when the existing token is still valid;
  // carry the old one forward so subsequent runs still have something to refresh with.
  token.refresh_token ??= SPOTIFY_REFRESH_TOKEN;
  return token;
}

console.log('Authenticating with Spotify...');
const token = await refreshAccessToken();

export const rateLimitedFetch: typeof fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const maxAttempts = 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await fetch(input, init);
    if (res.status !== 429) return res;

    const retryAfterRaw = Number(res.headers.get('retry-after'));
    const retryAfter = Number.isFinite(retryAfterRaw) && retryAfterRaw >= 0 ? retryAfterRaw : 1;
    // 60s threshold: shorter pauses are typical bursty-traffic throttling and worth waiting out.
    // Longer Retry-After values usually indicate the daily quota cap — sleeping through that would
    // hold the cron job for hours, so fail fast and let the next scheduled run pick it up instead.
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
