# Internship Discord Notifier

Simple Node.js bot that checks the SimplifyJobs internship listings once per day and posts new Summer 2027 U.S. CS/software, AI, and data internships to Discord through a webhook.

Source repo: [SimplifyJobs/Summer2026-Internships](https://github.com/SimplifyJobs/Summer2026-Internships)

The source is still the Summer 2026 listings JSON until a Summer 2027 repo/feed exists. The bot only keeps listings tagged `Summer 2027`.

## Hardcoded filters

These rules live in `src/index.js`:

- Source JSON: `DEFAULT_LISTINGS_URL`
- State file: `DEFAULT_STATE_PATH` (`data/seen.json`)
- Target term: `SUMMER_2027_TERM`
- U.S. location rule: `US_STATE_LOCATION` plus `country` values matching `USA` or `America`
- Remote filter: `isHybridOrOnsiteListing()` rejects locations containing `remote`
- Title keywords: `SOFTWARE_KEYWORDS`
- Priority companies: `BEST_COMPANIES` and `GOOD_COMPANIES`
- Unlisted company limits: `MAX_UNLISTED_WHEN_PRIORITY_IS_HIGH` and `MAX_UNLISTED_WHEN_PRIORITY_IS_LOW`

No company list, keyword list, target term, or post cap is configured through environment variables anymore. Edit `src/index.js` if those rules need to change.

## Posting behavior

- First run seeds `data/seen.json` without posting, so the channel does not get spammed with old listings.
- Later runs post only listings that are not already in `data/seen.json`.
- Multiple roles at the same company are grouped into one Discord post. The embed title is like `Google (2 roles)`, and the role titles are listed in the embed body.
- Best and good companies are not capped.
- If best + good company posts are 10 or more, the bot adds up to 5 unlisted company posts.
- Otherwise, the bot adds up to 10 unlisted company posts.
- Every successful company post is saved immediately so retries do not repost it if a later Discord post fails.

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

Dry run without posting or updating `data/seen.json`:

```bash
npm run dry
```

Run normally:

```bash
npm start
```

Run tests:

```bash
npm test
```

## Environment variables

| Name | Default | Notes |
| --- | --- | --- |
| `DISCORD_WEBHOOK_URL` | none | Required unless `DRY_RUN=true` |
| `DRY_RUN` | `false` | Logs matches without posting or updating state |
| `LISTINGS_URL` | SimplifyJobs Summer 2026 JSON | Optional local override for testing a different feed |

## GitHub Actions

The workflow in `.github/workflows/check-internships.yml` runs manually or once per day at 19:17 UTC, shortly after noon Pacific during daylight saving time. It runs tests, checks listings, posts grouped Discord messages, and commits `data/seen.json` so duplicate listings are not posted.
