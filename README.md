# Internship Discord Notifier

Node.js webhook notifier for Summer 2027 U.S. CS/software internships. It currently uses the SimplifyJobs Summer 2026 listings JSON as the test data source until a Summer 2027 listings URL is available.

The notifier only posts new matching roles to Discord and tracks seen listings in `data/seen.json`.

## What it matches

- U.S. locations
- CS/software-related internship titles or categories
- Summer 2027 listings by default
- Hybrid or on-site roles only
- Listings with an apply URL
- Active and visible listings when those fields exist

Remote-only roles are skipped.

## Setup

Create a Discord webhook for the target channel and store it as a GitHub Actions secret named:

```text
DISCORD_WEBHOOK_URL
```

Install dependencies:

```bash
npm ci
```

## Local commands

Dry run without posting:

```bash
npm run dry
```

Dry runs do not post to Discord or update `data/seen.json`.

Run normally:

```bash
npm start
```

Send one test webhook message:

```bash
node src/index.js --test-webhook
```

## Environment variables

| Name | Default | Notes |
| --- | --- | --- |
| `DISCORD_WEBHOOK_URL` | none | Required unless `DRY_RUN=true` |
| `DRY_RUN` | `false` | Logs matches without posting |
| `POST_ON_FIRST_RUN` | `false` | Seeds current matches without posting on first run |
| `MAX_POSTS_PER_RUN` | `10` | Caps Discord posts per run |
| `LISTINGS_URL` | Summer 2026 SimplifyJobs JSON | Replace with the Summer 2027 JSON when available |
| `TARGET_TERMS` | `summer 2027` | Comma-separated terms to match from the SimplifyJobs `terms` field |
| `NON_US_LOCATION_TERMS` | built-in list | Optional comma-separated override |
| `SOFTWARE_KEYWORDS` | built-in list | Optional comma-separated override |

While the default source still points at the Summer 2026 JSON, the notifier only keeps listings whose SimplifyJobs `terms` include the configured target. Override `TARGET_TERMS` only for local testing or if the target season changes.

## GitHub Actions

The workflow in `.github/workflows/check-internships.yml` runs manually or every 30 minutes at minutes 17 and 47. It commits updates to `data/seen.json` so duplicate listings are not posted.
