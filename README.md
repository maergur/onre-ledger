# Pointsbook

https://pointsbook.io - the unofficial OnRe points ledger.

A community-built ledger of every wallet in OnRe's public points programme: standings,
where points come from (by protocol and product), who holds them, daily emission, and
ledger-wide events. One self-contained page, rebuilt every hour.

Not affiliated with OnRe. Built from OnRe's public rewards API. Nothing here is financial advice.

## How it works

- `.github/workflows/update.yml` runs hourly. It fetches the full public leaderboard with
  `scripts/fetch.py`, rebuilds the page with `scripts/build.py`, and force-pushes two branches:
  - `data` - the last few days of snapshots (gzipped JSON) plus a daily system-total series
  - `site` - the built `index.html`, which Vercel deploys
- OnRe's API rejects requests from browsers, so the page cannot query it live; everything is
  fetched server-side and embedded in the page.
- Per-wallet daily rates are measured by differencing snapshots up to 4 days apart, normalised
  by the real elapsed time between them.

## Editing

Page sources are in `src/`: `_head.html` (markup and styles), `_app.js` (behaviour),
`events.json` (the "What changed" notifications), `site.json` (builder credit and referral).
Never edit the generated `index.html`; push to `main` and the workflow rebuilds.

Build locally:

    python3 scripts/fetch.py --store store
    python3 scripts/build.py --data store --series store/series.json --src src --out out
