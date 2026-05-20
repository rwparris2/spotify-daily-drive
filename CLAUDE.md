# Daily Drive

TypeScript Node CLI that rebuilds a single persistent Spotify playlist by interleaving fresh podcast episodes with songs from the user's Spotify activity and (optionally) ListenBrainz recommendations.

## Commands

`.env` must be populated before `npm start` or `npm test` — `src/config.ts` calls `process.exit(2)` on any missing required key. See README for the variable list.

- `npm start` — run end-to-end and rewrite the playlist
- `npm start -- --dry-run` — read-only; print the plan, no mutation
- `npm run bootstrap-auth` — one-time OAuth flow; mints a refresh token and (if `SPOTIFY_PLAYLIST_ID` is unset) creates the target playlist
- `npm test` / `npm run test:watch` — Vitest with MSW intercepting Spotify HTTP
- `npm run typecheck` / `npm run build` — `tsc --noEmit` / `tsc`
- `npm run format` — Prettier on `src/**/*.ts`

## Code layout

- `src/index.ts` — entry point; fetch podcasts → fetch tracks → interleave → replace playlist (top-level await)
- `src/SpotifyPodcasts.ts` — picks one episode per slot, honoring `pin_slot` and `latest_only`; falls back to the unpinned pool when a pin is exhausted
- `src/SpotifyTracks.ts` — fans out to playlist / top-items / recently-played / saved / ListenBrainz sources, dedupes by track id, samples
- `src/SpotifyPlaylist.ts` — `PUT` then chunked `POST` to replace items, then renames + redescribes the playlist
- `src/SpotifyClient.ts` — refresh-token-based auth; custom `fetch` with 429 backoff (top-level await)
- `src/SpotifyPlaylistTracksCache.ts` — JSON cache keyed by `playlistId + snapshotId`; path overridable via `SPOTIFY_PLAYLIST_TRACKS_CACHE_PATH`
- `src/ListenBrainz.ts` — optional CF recommendations resolved to Spotify tracks via search; no-op without `LISTENBRAINZ_USER_TOKEN`
- `src/PodcastConfig.ts` — `smol-toml` loader for `podcasts.toml`
- `src/config.ts` — env var validation; `process.exit(2)` on any missing required value
- `src/SpotifyBootstrapAuth.ts` — local HTTP callback server for the one-time OAuth flow

## Conventions

- ESM-only (`"type": "module"`); relative imports use `.js` extensions even for `.ts` sources
- Top-level `await` is used — keep Node ≥ 20
- Tests live in `src/__tests__/` and `src/*.test.ts`; MSW handlers stub Spotify endpoints, so no network or real credentials are needed
- Lodash is used for sampling / `uniqBy` / `chunk` — keep it
- No state file by design: variety comes from random sampling + Spotify's `fully_played` flag
- Partial failures are intentional — each fetch helper logs and returns `[]` on error rather than throwing, so one source failing doesn't kill the run

## Scheduling

`.github/workflows/daily-drive.yml` runs the CLI on cron, then commits the refreshed `.cache/spotify-playlist-tracks.json` back to the repo as `github-actions[bot]` so the cache persists across runs. Required GitHub secrets: `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `SPOTIFY_REFRESH_TOKEN`, `SPOTIFY_PLAYLIST_ID`.
