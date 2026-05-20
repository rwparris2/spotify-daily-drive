# Daily Drive

A CLI that rebuilds a single persistent Spotify playlist by interleaving fresh podcast episodes with songs drawn from your Spotify activity. Each podcast is followed by a block of songs, with successive blocks growing in size so the playlist ends on a long song tail.

## Setup

1. **Create a Spotify app** at <https://developer.spotify.com/dashboard>.
   - Add `http://127.0.0.1:8888/callback` as a redirect URI.
   - Copy the client id + client secret.

2. **Populate `.env`** in the repo root:
   ```env
   SPOTIFY_CLIENT_ID=…
   SPOTIFY_CLIENT_SECRET=…
   SPOTIFY_REFRESH_TOKEN=   # filled by bootstrap-auth
   SPOTIFY_PLAYLIST_ID=     # filled by bootstrap-auth (or paste an existing id)
   # SPOTIFY_REDIRECT_URI=http://127.0.0.1:8888/callback  # optional
   # PODCASTS_CONFIG_PATH=podcasts.toml                   # optional
   # LISTENBRAINZ_USER_TOKEN=                             # optional; enables ListenBrainz recommendations
   ```

3. **Bootstrap auth**:
   ```bash
   npm install
   npm run bootstrap-auth
   ```
   Opens Spotify's authorize screen. After approval, the script prints a `SPOTIFY_REFRESH_TOKEN` and — if `SPOTIFY_PLAYLIST_ID` isn't set — creates a private playlist and prints its id. Paste both into `.env`.

   Re-run this if you change OAuth scopes.

## Running

```bash
npm start -- --dry-run   # print the plan, no Spotify mutation
npm start                # print the plan AND rewrite the playlist
```

The dry run hits the read-side of the Spotify API (shows, episodes, your tracks) but never modifies the playlist.

## Scheduled run

[.github/workflows/daily-drive.yml](.github/workflows/daily-drive.yml) runs the CLI on a cron schedule and commits the refreshed playlist-tracks cache back to the repo. Required GitHub Actions secrets: `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `SPOTIFY_REFRESH_TOKEN`, `SPOTIFY_PLAYLIST_ID`.

## `podcasts.toml`

The source of truth for which shows are eligible. Hand-maintained.

```toml
[[shows]]
name              = "Up First from NPR"      # required
spotify_show_id   = "2mTUnDkuKUkhiueKcVWoP0" # required (from open.spotify.com/show/<id>)
itunes_categories = [ "News", "Daily News" ] # optional, informational
pin_slot          = 1                        # optional; reserves a fixed slot number
latest_only       = true                     # optional; take newest playable episode, ignoring the freshness window
```

- Shows with a `pin_slot` are tried for that slot first; remaining slots are filled by random sampling from shows without `pin_slot`.
- If a pinned show has no eligible episode (e.g. the latest is already `fully_played`), that slot is filled from the unpinned pool instead.

## Selection rules

- **`latest_only` shows** (typically the pinned daily news shows): take the newest playable episode that isn't `fully_played`, no date cutoff.
- **Other shows**: latest playable episode released recently and not `fully_played`. Show order is random per run; a show with no eligible episode is skipped and the next sample tried.
- **No state file** — repetitiveness is avoided by random sampling plus the `fully_played` filter.
- **Songs** are drawn from multiple sources (random user playlists, top tracks across short/medium/long horizons, recently played, saved tracks, and — if `LISTENBRAINZ_USER_TOKEN` is set — ListenBrainz collaborative-filter recommendations), deduped globally by track id, and sampled to fill the song slots.

## Partial failures are intentional

A Daily Drive run is best-effort. If an API call fails partway through — a track-source helper errors out, a playlist's pagination breaks mid-fetch, an episode lookup for one show fails, or one chunked write to the target playlist rejects — the run continues with whatever data did succeed. The resulting playlist may be shorter or biased toward the sources that worked. This is deliberate: a smaller playlist is better than no playlist on a scheduled run, and the alternative (hard-fail on any hiccup) would mean frequent silent gaps. Look at `console.error` lines in the run output if something seems off.

## Tests

```bash
npm test          # one-shot
npm run test:watch
```

Tests use [MSW](https://mswjs.io/) to intercept Spotify HTTP calls and return canned responses — no network, no real credentials needed.

## Caching

Tracks fetched from your user playlists are cached at `.cache/spotify-playlist-tracks.json`, keyed by playlist id and snapshot id. The scheduled GitHub Actions workflow commits this file back to the repo so the cache survives across runs.

## Troubleshooting

- **`Spotify Retry-After=…` error** — Spotify is hard-rate-limiting; wait it out before re-running. The client backs off automatically for short retry windows.
- **Missing scope errors after changing OAuth scopes** — re-run `npm run bootstrap-auth` to mint a new refresh token with the updated scopes.
- **Fewer podcasts than expected in the plan** — every eligible show was exhausted (no playable, non-`fully_played` episode within the cutoff). Check the `console.error` output for per-show fetch failures.

## Out of scope

State file / back-to-back avoidance, longest-not-heard ranking, and Discover Weekly as a dedicated source are all deferred.
