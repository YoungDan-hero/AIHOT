# Duanju Frontline · 短剧前线

A Chinese-language industry news site following short dramas in China and overseas with equal editorial attention. It covers live-action short dramas, AI animation and vertical microdramas, groups reports about the same event, links to original sources and composes daily briefings.

Built on the [AIHOT open-source framework](https://github.com/KKKKhazix/AIHOT). Code is licensed under [MIT](LICENSE); font notices are in [NOTICE](NOTICE).

## Editorial scope

The three categories are domestic developments, overseas developments, and cross-market analysis. Market, language and company nationality do not add or subtract editorial value. Overseas reporting receives Chinese summaries. Equal attention does not impose a fixed quota of items from each market.

The source pack currently enables 51 sources: 35 domestic and 16 overseas (one additional source is paused after repeated production timeouts). Domestic coverage has priority; both markets use the same evidence and editorial standards. Sources passed native listing, date and body checks before onboarding. Some low-volume sources use an older same-publisher article as their second body sample. Short-term acceptance does not establish long-term availability. Broad feeds use keyword admission before Doubao processing.

The site publishes summaries and original links by default. Full-text display and syndication remain disabled. The 36Kr article host is rewritten to `www.36kr.com`; public Marketing Dive requests must be spaced at least five seconds apart. Short-window HTTP checks do not establish long-term reliability or complete coverage.

## Run locally

Use Node.js **24.22.1 or newer**, PostgreSQL 17, or Docker Compose. Install dependencies with `npm ci`, then follow [deployment instructions](docs/deploy.md) to configure the database, random secrets, administrator password and your own model API access. No model key is included.

Run `npm run dev:api` and `npm run dev:web`; the local website is at `http://localhost:3000`, with administration at `/admin`. Keep collection, model calls and outbound publishing disabled during development checks. See [the site operations guide](docs/short-drama.md) before starting the worker.

Existing deployments require source review: seeding adds missing sources but does not overwrite or pause old AI sources. Preserve historical data and pause old sources explicitly when switching coverage.

## Validate

```bash
npm run typecheck
DATABASE_URL=postgres://127.0.0.1:5432/duanju_test npm test
npm run build -w @aihot/web
npm run test:web
node scripts/smoke.ts --base http://localhost:3000
```

The test database name must end in `_test` or `_ci`. Tests use local fake collectors and model services. Editorial thresholds need calibration against human-labelled short-drama examples; passing software tests does not establish editorial accuracy.

Site copy and identity live in `site/`; taxonomy, sources and prompts live in `industry/`. Terms and privacy pages are deployment templates awaiting the operator's identity, contact details and actual data-retention arrangements. This repository does not assert that a public deployment is live.

[简体中文](README.md)
