# Daily Drive cron trigger (Cloudflare Worker)

GitHub Actions' scheduled workflows are unreliable (often 2–5h late under load). This Worker fires
the `daily-drive.yml` workflow on time via `workflow_dispatch`.

- **Schedule:** `0 11 * * *` UTC (configured in [`wrangler.toml`](wrangler.toml)) — 6am EST / 7am EDT.
  Workers cron is UTC-only; the ET fire time shifts by 1h across DST. For exact 6am ET year-round,
  use `crons = ["0 10 * * *", "0 11 * * *"]` — the workflow's `concurrency` group lets the dup run no-op.
- **Cost:** Free tier. One request per day is well under the 100k/day Workers free limit.

## One-time setup

### 1. Mint a GitHub PAT

At <https://github.com/settings/personal-access-tokens/new>:

- Resource owner: your account
- Repository access: **Only select repositories** → `spotify-daily-drive`
- Repository permissions → **Actions: Read and write**
- Expiration: 1 year (set yourself a calendar reminder to rotate)

### 2. Deploy the Worker

```bash
cd cron-trigger
npm install
npx wrangler login
npx wrangler secret put GITHUB_TOKEN   # paste the PAT at the prompt
npx wrangler deploy
```

> ⚠️ **Do not put the PAT on the command line** (`wrangler secret put GITHUB_TOKEN <PAT>`).
> Wrangler doesn't accept the value as an argument, and the PAT will end up in your shell history.
> Always paste it into the interactive prompt that appears after running `wrangler secret put GITHUB_TOKEN`.
> If you slip up, revoke the PAT immediately and mint a new one.

The `[vars]` block in `wrangler.toml` already points at `rwparris2/spotify-daily-drive`. Fork? Change those.

## Verify it works

The Cloudflare dashboard used to have a "Trigger now" button for scheduled handlers. It no longer does, so you need to drive the test yourself. Two options, fastest first:

### Option A — Test the PAT + workflow directly (fastest, ~5s)

Skip the Worker entirely; if the GitHub side works, the Worker code is trivially small.

```bash
curl -i -X POST \
  -H "Accept: application/vnd.github+json" \
  -H "Authorization: Bearer <PAT>" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  https://api.github.com/repos/rwparris2/spotify-daily-drive/actions/workflows/daily-drive.yml/dispatches \
  -d '{"ref":"main"}'
```

Expected: `HTTP/2 204` with empty body. A new run should appear in the GitHub Actions tab within a couple of seconds. Common failures: `401` (PAT wrong/expired), `404` (workflow filename or repo wrong), `422` (`main` ref doesn't exist).

### Option B — End-to-end, exercising the real Worker code

```bash
# .dev.vars provides the secret locally (it's gitignored)
echo 'GITHUB_TOKEN="<PAT>"' > .dev.vars

# In one shell:
npx wrangler dev --test-scheduled

# In another shell:
curl "http://localhost:8787/__scheduled?cron=0+11+*+*+*"
```

The first shell should print `workflow_dispatch ok: rwparris2/spotify-daily-drive/daily-drive.yml`.
A new run should appear in the GitHub Actions tab.

Delete `.dev.vars` when you're done if you don't want the PAT sitting in plaintext on disk.

## Tail production logs

```bash
npx wrangler tail
```

Each scheduled run logs `workflow_dispatch ok: <owner>/<repo>/<workflow>` on success, or throws (with the GitHub API response) on failure.
