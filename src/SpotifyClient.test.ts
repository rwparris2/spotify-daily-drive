import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { mswServer } from './__tests__/mswServer.js';
import { rateLimitedFetch, refreshAccessToken } from './SpotifyClient.js';

const URL = 'https://api.spotify.com/v1/test-endpoint';

function rateLimited(retryAfter?: string, attemptsBeforeSuccess = 0) {
  let attempts = 0;
  return http.get(URL, () => {
    attempts += 1;
    if (attempts > attemptsBeforeSuccess) {
      return HttpResponse.json({ ok: true });
    }
    const headers: Record<string, string> = {};
    if (retryAfter !== undefined) headers['retry-after'] = retryAfter;
    return new HttpResponse('rate limited', { status: 429, headers });
  });
}

describe('rateLimitedFetch', () => {
  it('returns non-429 responses immediately', async () => {
    mswServer.use(http.get(URL, () => HttpResponse.json({ ok: true })));
    const res = await rateLimitedFetch(URL);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('retries on 429 with retry-after and eventually succeeds', async () => {
    vi.useFakeTimers();
    mswServer.use(rateLimited('1', 2));
    const promise = rateLimitedFetch(URL);
    await vi.advanceTimersByTimeAsync(2_000);
    const res = await promise;
    vi.useRealTimers();
    expect(res.status).toBe(200);
  });

  it('throws when retry-after exceeds 60 seconds', async () => {
    mswServer.use(rateLimited('120', Infinity));
    await expect(rateLimitedFetch(URL)).rejects.toThrow(/Hard rate-limit/);
  });

  it('throws after exhausting retries (no more silent 429 returns)', async () => {
    vi.useFakeTimers();
    mswServer.use(rateLimited('1', Infinity));
    const promise = rateLimitedFetch(URL);
    const assertion = expect(promise).rejects.toThrow(/after 5 attempts/);
    await vi.advanceTimersByTimeAsync(10_000);
    await assertion;
    vi.useRealTimers();
  });

  it('treats missing or non-numeric retry-after as 1 second (NaN-safe)', async () => {
    vi.useFakeTimers();
    mswServer.use(rateLimited('Wed, 21 Oct 2026 07:28:00 GMT', 1));
    const promise = rateLimitedFetch(URL);
    await vi.advanceTimersByTimeAsync(1_000);
    const res = await promise;
    vi.useRealTimers();
    expect(res.status).toBe(200);
  });
});

const TOKEN_URL = 'https://accounts.spotify.com/api/token';

describe('refreshAccessToken', () => {
  it('throws an actionable error when the refresh token is expired (invalid_grant)', async () => {
    mswServer.use(
      http.post(TOKEN_URL, () =>
        HttpResponse.json(
          { error: 'invalid_grant', error_description: 'Refresh token revoked' },
          { status: 400 },
        ),
      ),
    );
    const err = await refreshAccessToken().catch((e) => e as Error);
    expect(err.message).toMatch(/invalid_grant/);
    expect(err.message).toContain('bootstrap-auth');
    expect(err.message).toContain('SPOTIFY_REFRESH_TOKEN');
  });

  it('throws the generic error on a non-invalid_grant failure', async () => {
    mswServer.use(http.post(TOKEN_URL, () => new HttpResponse('upstream boom', { status: 500 })));
    const err = await refreshAccessToken().catch((e) => e as Error);
    expect(err.message).toContain('Spotify token refresh failed: 500');
    expect(err.message).not.toContain('bootstrap-auth');
  });

  it('carries the existing refresh token forward when the response omits one', async () => {
    // The default handler returns a token without a refresh_token.
    const token = await refreshAccessToken();
    expect(token.access_token).toBe('fake_access_token');
    expect(token.refresh_token).toBe('test_refresh_token');
  });
});
