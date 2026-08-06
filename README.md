# Ball Court Dashboard

Cloudflare Worker deployment for the venue availability board in `index.html`.

## What it does

- Serves the existing dashboard and proxies live venue data through `/api/availability`.
- Captures hourly window snapshots from 08:25 to 21:25 China Standard Time every day
  (windows 08:30-09:30 ... 21:30-22:30, matching the gym's 08:30-22:30 opening hours).
- Retries each window up to 8 times (minutes :25-:29, then :35/:45/:55) and stops as
  soon as one attempt succeeds.
- Stores snapshots in Cloudflare D1 (one row per date + window) and exposes them at
  `/api/history`. The 19:30-21:30 "continuous" availability is derived from the
  19:30 and 20:30 hourly rows.

The schedule uses one UTC cron trigger (Cloudflare Cron Triggers use UTC):

- `* * * * *` = every minute; the Worker keeps only hours 08-21 Asia/Shanghai and
  retries at minutes 25-29, 35, 45, 55 of each hour

Only one trigger is needed (the Free plan allows five per account); the Worker maps the
current Asia/Shanghai hour to the window it should capture and skips the rest.

## Local checks

```powershell
npm run build
npx wrangler d1 migrations apply wenti-venue-history --local
npx wrangler dev --test-scheduled --local
```

Use the URL printed by Wrangler for the dashboard. With `--test-scheduled`, send a `POST` request to `/__scheduled?cron=*+*+*+*+*` to exercise the snapshot handler.

## Deployment

The D1 database ID in `wrangler.toml` is intentionally supplied during the first deployment setup. After it is set:

```powershell
npm run build
npx wrangler d1 migrations apply wenti-venue-history --remote
npx wrangler deploy
```
