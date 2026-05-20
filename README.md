# Daily Drive

Builds a Spotify playlist every morning by interleaving fresh podcast episodes with songs from your listening activity.

![Node](https://img.shields.io/badge/Node-%E2%89%A520-339933?style=for-the-badge&logo=node.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.5-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![Vitest](https://img.shields.io/badge/Tests-Vitest-6E9F18?style=for-the-badge&logo=vitest&logoColor=white)
![License](https://img.shields.io/badge/License-ISC-blue?style=for-the-badge)

## What is this?

I found myself missing Spotify's Daily Drive playlist, so I built a script to generate something similar for me.

## Quick Start

1. Create a Spotify app at <https://developer.spotify.com/dashboard> and add `http://127.0.0.1:8888/callback` as a redirect URI.

2. Copy `.env.template` to `.env` and fill in `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET`. `SPOTIFY_REFRESH_TOKEN` and `SPOTIFY_PLAYLIST_ID` get filled in by the next step.

3. Edit `podcasts.toml` to list the shows you want:

   ```toml
   [[shows]]
   name            = "Up First from NPR"
   spotify_show_id = "2mTUnDkuKUkhiueKcVWoP0"   # from open.spotify.com/show/<id>
   pin_slot        = 1                           # optional; reserves a fixed slot
   latest_only     = true                        # optional; always take newest episode
   ```

4. Install, authorize, and run:

   ```bash
   npm install
   npm run bootstrap-auth     # one-time; mints the refresh token and (optionally) creates the playlist
   npm start -- --dry-run     # preview the plan
   npm start                  # rebuild the playlist for real
   ```

To run it on a schedule, push to GitHub — [`.github/workflows/daily-drive.yml`](.github/workflows/daily-drive.yml) runs the CLI on a daily cron. Add `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `SPOTIFY_REFRESH_TOKEN`, and `SPOTIFY_PLAYLIST_ID` as Actions secrets.

## Tests

```bash
npm test
```

Tests use [MSW](https://mswjs.io/) to intercept Spotify HTTP calls — no network or real credentials needed.

## License

ISC — see [LICENSE](LICENSE).
