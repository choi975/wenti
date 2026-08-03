# Ball Court Dashboard

Cloudflare Worker deployment for the venue availability board in `index.html`.

## What it does

- Serves the existing dashboard and proxies live venue data through `/api/availability`.
- Captures the two target slots at 19:25 China Standard Time every day.
- Runs a 19:27 UTC-backed retry only if the 19:25 capture did not succeed.
- Stores snapshots in Cloudflare D1 and exposes the latest records at `/api/history`.

The schedule is configured in UTC because Cloudflare Cron Triggers use UTC:

- `25 11 * * *` = 19:25 Asia/Shanghai
- `27 11 * * *` = 19:27 Asia/Shanghai backup attempt

## Local checks

```powershell
npm run build
npx wrangler d1 migrations apply wenti-venue-history --local
npx wrangler dev --test-scheduled --local
```

Use the URL printed by Wrangler for the dashboard. With `--test-scheduled`, send a `POST` request to `/__scheduled?cron=25+11+*+*+*` to exercise the snapshot handler.

## Deployment

The D1 database ID in `wrangler.toml` is intentionally supplied during the first deployment setup. After it is set:

```powershell
npm run build
npx wrangler d1 migrations apply wenti-venue-history --remote
npx wrangler deploy
```
