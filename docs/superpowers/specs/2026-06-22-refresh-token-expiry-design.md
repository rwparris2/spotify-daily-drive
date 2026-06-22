# Actionable failure on Spotify refresh-token expiry

**Date:** 2026-06-22

## Background

Spotify is introducing a 6-month lifetime on refresh tokens (dev blog,
2026-06-18; enforced for existing apps from 2026-07-20). When a refresh token
expires, the token endpoint returns `400 {"error":"invalid_grant"}`.

Daily Drive is a headless, single-user cron job (GitHub Actions, triggered via a
Cloudflare Worker `workflow_dispatch`). It refreshes using the
`SPOTIFY_REFRESH_TOKEN` GitHub secret. There is no interactive user session to
redirect to a login page — the generic "send the user through the sign-in flow"
advice does not apply. Recovery is operational: re-run `npm run bootstrap-auth`
locally and update the `SPOTIFY_REFRESH_TOKEN` secret.

Today, `SpotifyClient.ts` throws a generic
`Spotify token refresh failed: 400 {"error":"invalid_grant"...}` on any failed
refresh. When the token expires (~every 6 months) this surfaces as a cryptic
CI-failure email that requires re-diagnosis each time.

## Goal

On refresh-token expiry, fail the run with a clear, actionable message stating
the token expired and the exact remediation steps — so future maintenance is a
known chore, not a debugging session.

## Non-goals

- No interactive re-auth / login redirect (no user session exists).
- No distinct exit code or active notification (GitHub's standard failure email
  on a non-zero exit is sufficient for a personal cron job).
- No change to refresh-token rotation/persistence. The existing carry-forward
  (`token.refresh_token ??= SPOTIFY_REFRESH_TOKEN`) is preserved as-is; persisting
  a rotated token is explicitly out of scope (refreshing does not extend the
  6-month lifetime anyway).

## Design

### 1. Extract the refresh into a testable function

The token refresh currently runs as an import-time top-level side effect
(`SpotifyClient.ts:5-26`), so it cannot be unit-tested. Extract it into an
exported async function the module then calls:

```ts
export async function refreshAccessToken(): Promise<AccessToken> { … }

// module top-level becomes a one-liner:
const token = await refreshAccessToken();
```

Import-time behavior is unchanged; the logic just becomes callable from a test.
No change to `index.ts` or `.github/workflows/daily-drive.yml`.

### 2. Detect `invalid_grant` specifically

On a non-OK response, read the body once and branch:

- `status === 400` **and** parsed `error === 'invalid_grant'` → throw the
  actionable message (token expired; run `npm run bootstrap-auth`; update the
  `SPOTIFY_REFRESH_TOKEN` secret; cite 2026-06-18 blog).
- Any other failure → keep the existing generic
  `Spotify token refresh failed: <status> <body>` message (unchanged).

The body is JSON-parsed to read `.error` precisely, with a `try/catch` fallback
to the generic path when the body is not JSON.

### 3. Failure propagation — no extra code

A thrown error from the top-level `await` becomes an unhandled rejection → Node
exits non-zero → the GitHub Actions run fails → the standard failure email
carries the actionable message in the logs.

### 4. Tests (`SpotifyClient.test.ts`)

Drive `refreshAccessToken` directly via per-test MSW overrides of
`POST https://accounts.spotify.com/api/token`:

- `invalid_grant` (400) → rejects with a message mentioning `bootstrap-auth`
  and `SPOTIFY_REFRESH_TOKEN`.
- Other failure (e.g. 500) → rejects with the generic message (guards against
  over-matching the actionable branch).
- Success with `refresh_token` omitted → resolves to the token and carries the
  old refresh token forward (existing `??=` behavior, now under test).

## Scope

`SpotifyClient.ts` (~15 lines net) + 3 tests in `SpotifyClient.test.ts`.
