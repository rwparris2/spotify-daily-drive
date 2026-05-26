# Daily Drive

Builds a Spotify playlist every morning by interleaving fresh podcast episodes with songs from your listening activity.

![Node](https://img.shields.io/badge/Node-%E2%89%A520-339933?style=for-the-badge&logo=node.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.5-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![Vitest](https://img.shields.io/badge/Tests-Vitest-6E9F18?style=for-the-badge&logo=vitest&logoColor=white)
![License](https://img.shields.io/badge/License-ISC-blue?style=for-the-badge)

## What is this?

I found myself missing Spotify's Daily Drive playlist, so I built a script to generate something similar for me.

## How it works

Each run interleaves fresh podcast episodes (one per show, picked from `podcasts.toml`) with tracks sampled from your Spotify activity — top tracks, recently played, saved library, and your own playlists. Optionally pulls collaborative-filter recommendations from [ListenBrainz](https://listenbrainz.org/) as an extra song source. The result replaces the contents of a single persistent playlist, so the URL never changes — just refresh the playlist in your client.

There's no state file: variety comes from random sampling and Spotify's `fully_played` flag (so you don't get the same episode twice).

## Quick Start

1. **Register a Spotify app** at <https://developer.spotify.com/dashboard> and add `http://127.0.0.1:8888/callback` as a redirect URI.

2. **Configure environment.** Copy `.env.template` to `.env` and fill in `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET`. Leave `SPOTIFY_REFRESH_TOKEN` and `SPOTIFY_PLAYLIST_ID` blank — the next step fills them in.

3. **Pick your podcasts.** Edit `podcasts.toml`:

   ```toml
   [[shows]]
   name            = "Up First from NPR"
   spotify_show_id = "2mTUnDkuKUkhiueKcVWoP0"   # from open.spotify.com/show/<id>
   pin_slot        = 1                           # optional; reserves a fixed slot
   latest_only     = true                        # optional; always take newest episode
   ```

   Unpinned shows are sampled randomly to fill remaining slots; pinned shows fall back to the unpinned pool if exhausted.

4. **Bootstrap auth (one-time).**

   ```bash
   npm install
   npm run bootstrap-auth
   ```

   This opens the Spotify authorize page in your browser, mints a long-lived refresh token, and — if `SPOTIFY_PLAYLIST_ID` is unset — creates a fresh private "My Daily Drive" playlist for you. It prints the values to paste into `.env`. Re-run it any time you change OAuth scopes.

5. **Run it.**

   ```bash
   npm start -- --dry-run     # preview the plan, no mutation
   npm start                  # rebuild the playlist for real
   ```

### Schedule it (GitHub Actions + Cloudflare Worker)

The scheduling story is split in two because GitHub's own scheduled workflows were running 2–5 hours late under peak load:

- [`.github/workflows/daily-drive.yml`](.github/workflows/daily-drive.yml) runs the CLI and commits the refreshed track cache back to the repo so it persists across runs. It only fires on `workflow_dispatch` (no GitHub-native cron).
- [`cron-trigger/`](cron-trigger/) is a tiny Cloudflare Worker that pokes the workflow on schedule via the GitHub API. See [`cron-trigger/README.md`](cron-trigger/README.md) for one-time setup.

**GitHub side:** add `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `SPOTIFY_REFRESH_TOKEN`, `SPOTIFY_PLAYLIST_ID`, and (optionally) `LASTFM_API_KEY` / `LISTENBRAINZ_USER_TOKEN` as Actions secrets.

**Cloudflare side:** deploy the Worker (`cd cron-trigger && npx wrangler deploy`) with a `GITHUB_TOKEN` secret (a fine-grained PAT with `Actions: Read and write` on this repo). The Worker fires `0 11 * * *` UTC (≈ 6am EST / 7am EDT).

If you don't care about exact timing, you can skip the Worker and add `schedule: cron: "0 11 * * *"` back to the workflow — just be prepared for the runs to drift by hours.

### Optional: ListenBrainz

Set `LISTENBRAINZ_USER_TOKEN` (from <https://listenbrainz.org/profile/>) to mix in collaborative-filter recommendations. Unset, it's skipped silently.

### Optional: Last.fm

Set `LASTFM_API_KEY` (free, register at <https://www.last.fm/api/account/create>) to mix in stylistically-similar discoveries from Last.fm's similarity graph. Unset, it's skipped silently.

## Tests

```bash
npm test
```

Tests use [MSW](https://mswjs.io/) to intercept Spotify HTTP calls — no network or real credentials needed.

## License

ISC — see [LICENSE](LICENSE).
