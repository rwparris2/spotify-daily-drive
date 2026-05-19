# Daily Drive

A CLI that rebuilds a single persistent Spotify playlist every morning by interleaving 8 podcast episodes with songs from your Spotify activity in an n+1 pattern (Pod, 2 songs, Pod, 3 songs, …, Pod, 9 songs) — 8 podcasts + 44 songs = 52 items, always ending on songs.

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
   ```

3. **Bootstrap auth**:
   ```bash
   npm install
   npm run bootstrap-auth
   ```
   Opens Spotify's authorize screen. After approval, the script prints a `SPOTIFY_REFRESH_TOKEN` and — if `SPOTIFY_PLAYLIST_ID` isn't set — creates a public playlist named "Daily Drive" and prints its id. Paste both into `.env`.

   Re-run this if you change OAuth scopes.

## Running

```bash
npm start -- --dry-run   # print the plan, no Spotify mutation
npm start                # print the plan AND rewrite the playlist
```

The dry run hits the read-side of the Spotify API (shows, episodes, your tracks) but never modifies the playlist.

## `podcasts.toml`

The source of truth for which shows are eligible. Hand-maintained.

```toml
[[shows]]
name              = "Up First from NPR"      # required
spotify_show_id   = "2mTUnDkuKUkhiueKcVWoP0" # required (from open.spotify.com/show/<id>)
category          = "news"                   # "news" | "other", required
itunes_categories = [ "News", "Daily News" ] # optional, informational
pin_slot          = 1                        # optional; reserves a fixed slot (1 or 2)
```

- Slot 1 is pinned to whichever show has `pin_slot = 1` (currently Up First); slot 2 to `pin_slot = 2` (currently The Daily).
- Slots 3-8 are sampled at random from shows with `category = "other"`.
- If a pinned show has no fresh + unplayed episode (e.g. weekends for Up First), that slot is filled from the "other" pool instead.

## Selection rules

- **News slots (1-2)**: latest episode released within the last 48h that isn't `fully_played`.
- **Other slots (3-8)**: latest episode released within the last 3 months that isn't `fully_played`. Show order is random per run; a show with no eligible episode is skipped and the next sample tried.
- **No state file** — repetitiveness is avoided by `_.sampleSize` plus the `fully_played` filter.
- **Songs** are drawn from four sources (random user playlists, top tracks across short/medium/long horizons, recently played, and saved tracks), deduped globally by track id, and sampled to fill the song slots.

## Tests

```bash
npm test          # one-shot
npm run test:watch
```

Tests use [MSW](https://mswjs.io/) to intercept Spotify HTTP calls and return canned responses — no network, no real credentials needed.

## Troubleshooting

- **`Spotify Retry-After=…` error** — Spotify is hard-rate-limiting; wait it out before re-running. The client backs off automatically for `Retry-After ≤ 60s`.
- **Missing scope errors after changing OAuth scopes** — re-run `npm run bootstrap-auth` to mint a new refresh token with the updated scopes.
- **Fewer than 8 podcasts in the plan** — every "other" show without a fresh-unplayed episode was skipped. Check the `Skipped:` block in the output for reasons.

## Out of scope

GitHub Actions cron scheduling, state.json / back-to-back avoidance, longest-not-heard ranking, and Discover Weekly as a dedicated source are all deferred. See [docs/plans/implementation-plan.md](docs/plans/implementation-plan.md) for the current build plan.
