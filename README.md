# Ball Court Dashboard

Cloudflare Worker deployment for the venue availability board in `index.html`.

## What it does

- Serves the existing dashboard and proxies live venue data through `/api/availability`.
- Captures hourly window snapshots from 08:25 to 21:25 China Standard Time every day
  (windows 08:30-09:30 ... 21:30-22:30, matching the gym's 08:30-22:30 opening hours).
- Retries each window up to 5 times (minutes :25-:29, all before the gym locks the
  window at :30) and stops as soon as one attempt succeeds.
- Stores snapshots in Cloudflare D1 (one row per date + window) and exposes them at
  `/api/history`. The 19:30-21:30 "continuous" availability is derived from the
  19:30 and 20:30 hourly rows.
- Optional daily alert: the dashboard can push a Bark notification when fewer than a
  user-set threshold (1-15) courts are continuously bookable for 19:30-21:30. The user
  starts it manually each day; the worker checks every 10 minutes from 08:30 to 18:00
  (Asia/Shanghai) and auto-disables after 18:00. Configuration is stored in D1 and
  exposed through `/api/alert` (GET/POST) and `/api/alert/stop` (POST).

The schedule uses two UTC cron triggers (Cloudflare Cron Triggers use UTC):

- `25-29 * * * *` = every hour at :25-:29; the Worker keeps only hours 08-21
  Asia/Shanghai and captures the corresponding window
- `*/10 * * * *` = every 10 minutes; the Worker keeps only 08:30-18:00 Asia/Shanghai
  and runs the alert check when enabled

Only two triggers are needed (the Free plan allows five per account); the Worker maps the
current Asia/Shanghai time to the work it should do and skips the rest.

## Local checks

```powershell
npm run build
npx wrangler d1 migrations apply wenti-venue-history --local
npx wrangler dev --test-scheduled --local
```

Use the URL printed by Wrangler for the dashboard. With `--test-scheduled`, send a `POST` request to `/__scheduled?cron=25-29+*+*+*+*` to exercise the snapshot handler.

## Deployment

The D1 database ID in `wrangler.toml` is intentionally supplied during the first deployment setup. After it is set:

```powershell
npm run build
npx wrangler d1 migrations apply wenti-venue-history --remote
npx wrangler deploy
```
