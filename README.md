# Internship Discord Notifier

Node.js webhook notifier for Summer 2027 U.S. CS/software internships. It currently uses the SimplifyJobs Summer 2026 listings JSON as the test data source until a Summer 2027 listings URL is available.

The notifier posts a capped, ranked set of new matching roles to Discord once per day and tracks seen listings in `data/seen.json`.

## What it matches

- U.S. locations
- CS/software, AI, or data-related internship titles
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
| `BEST_COMPANIES` | built-in list | Optional comma-separated override for the highest-priority company tier |
| `GOOD_COMPANIES` | built-in list | Optional comma-separated override for the second-priority company tier |

While the default source still points at the Summer 2026 JSON, the notifier only keeps listings whose SimplifyJobs `terms` include the configured target. Override `TARGET_TERMS` only for local testing or if the target season changes.

## Ranking

Before applying `MAX_POSTS_PER_RUN`, new listings are sorted to reduce Discord spam:

1. Companies in `BEST_COMPANIES`, in configured order
2. Companies in `GOOD_COMPANIES`, in configured order
3. Unlisted companies
4. Newer posting date, then company name, then title

The built-in tiers are a hand-seeded starting point, not a live dependency. They were seeded from public tech-company and workplace lists, then adjusted for internship relevance:

- [CompaniesMarketCap largest tech companies by market cap](https://companiesmarketcap.com/tech/largest-tech-companies-by-market-cap/)
- [Capital.com largest tech companies by market cap](https://capital.com/en-int/markets/shares/largest-tech-companies-by-market-cap)
- [Glassdoor Best Companies in Tech & AI 2026](https://www.glassdoor.com/Award/Best-Places-to-Work-Tech-and-AI-United-States-LST_KQ0,31_IL.32,45_IM612.htm)
- [Newsweek America's Greatest Workplaces in Tech 2026](https://rankings.newsweek.com/americas-greatest-workplaces-in-tech-2026)

Use `BEST_COMPANIES` and `GOOD_COMPANIES` if the channel wants a different priority order.

## GitHub Actions

The workflow in `.github/workflows/check-internships.yml` runs manually or once per day at 19:17 UTC, shortly after noon Pacific during daylight saving time. It commits updates to `data/seen.json` so duplicate listings are not posted.
