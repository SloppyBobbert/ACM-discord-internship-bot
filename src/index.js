import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE_REPO_URL = 'https://github.com/SimplifyJobs/Summer2026-Internships';
const SIMPLIFY_2027_BOARD_URL = 'https://simplify.jobs/l/Summer2027-Internships';
const DEFAULT_LISTINGS_URL = 'https://raw.githubusercontent.com/SimplifyJobs/Summer2026-Internships/dev/.github/scripts/listings.json';
const DEFAULT_STATE_PATH = 'data/seen.json';

const SUMMER_2027_TERM = 'summer 2027';
const DAILY_POST_TIME_LABEL = 'Daily at 3:00 PM PT';
const PACIFIC_TIME_ZONE = 'America/Los_Angeles';
const NETWORK_TIMEOUT_MS = 30_000;
const DISCORD_CONTENT_LIMIT = 2000;
const DATE_TIMESTAMP_LIMIT_MS = 8_640_000_000_000_000;
const MAX_DISCORD_RATE_LIMIT_RETRIES = 3;
const DEFAULT_RATE_LIMIT_DELAY_MS = 1_000;
const MAX_UNLISTED_WHEN_PRIORITY_IS_HIGH = 5;
const MAX_UNLISTED_WHEN_PRIORITY_IS_LOW = 10;

const US_STATES = 'AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC';
const US_STATE_LOCATION = new RegExp(`\\b[A-Z][A-Za-z .'-]+,\\s*(${US_STATES})\\b`);

const SOFTWARE_KEYWORDS = [
  'cs',
  'computer science',
  'software',
  'swe',
  'developer',
  'backend',
  'frontend',
  'full stack',
  'data science',
  'machine learning',
  'ai'
];

const BEST_COMPANIES = [
  'Google',
  'Apple',
  'Microsoft',
  'Amazon',
  'Meta',
  'Netflix',
  'NVIDIA',
  'OpenAI',
  'Anthropic',
  'Tesla',
  'Stripe',
  'Databricks',
  'Snowflake',
  'Palantir',
  'Uber',
  'Airbnb',
  'DoorDash',
  'Coinbase',
  'Robinhood',
  'Jane Street',
  'Citadel',
  'Two Sigma',
  'Hudson River Trading',
  'LinkedIn',
  'Salesforce',
  'Adobe',
  'Oracle',
  'AMD',
  'Broadcom',
  'Intel'
];

const GOOD_COMPANIES = [
  'Datadog',
  'Cloudflare',
  'ServiceNow',
  'Shopify',
  'Atlassian',
  'Figma',
  'Dropbox',
  'GitHub',
  'MongoDB',
  'CrowdStrike',
  'Palo Alto Networks',
  'Zscaler',
  'Asana',
  'Box',
  'Twilio',
  'Okta',
  'HubSpot',
  'Workday',
  'Intuit',
  'PayPal',
  'Pinterest',
  'Snap',
  'Reddit',
  'Roblox',
  'Spotify',
  'Discord',
  'Canva',
  'Notion',
  'Airtable',
  'Rippling',
  'Ramp',
  'Plaid',
  'Brex',
  'Affirm',
  'Lyft',
  'Instacart',
  'Anduril',
  'Scale AI',
  'Bloomberg',
  'Capital One',
  'JPMorgan Chase'
];

function envBoolean(name, defaultValue = false) {
  const value = process.env[name];
  if (value === undefined) return defaultValue;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function normalizeDate(value) {
  if (!value) return undefined;

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return undefined;

    const milliseconds = value > 10_000_000_000 ? value : value * 1000;
    if (!Number.isFinite(milliseconds) || milliseconds <= 0 || Math.abs(milliseconds) > DATE_TIMESTAMP_LIMIT_MS) {
      return undefined;
    }

    const parsed = new Date(milliseconds);
    if (Number.isNaN(parsed.getTime())) return undefined;
    return parsed.toISOString().slice(0, 10);
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString().slice(0, 10);
}

function normalizeStringList(arrayValue, singleValue) {
  if (Array.isArray(arrayValue)) return arrayValue.filter(Boolean).map(String);
  if (singleValue) return [String(singleValue)];
  return [];
}

export function normalizeListing(raw = {}) {
  return {
    id: raw.id ? String(raw.id) : undefined,
    company: raw.company_name || raw.company || raw.companyName || 'Unknown',
    title: raw.title || raw.role || raw.position || 'Unknown role',
    locations: normalizeStringList(raw.locations, raw.location),
    countries: normalizeStringList(raw.countries, raw.country),
    terms: normalizeStringList(raw.terms, raw.term),
    url: raw.url || raw.apply_url || raw.application_url || '',
    datePosted: normalizeDate(raw.date_posted || raw.datePosted || raw.posted_at),
    sponsorship: raw.sponsorship || undefined,
    active: raw.active,
    visible: raw.is_visible ?? raw.visible
  };
}

function isUsCountry(value) {
  const normalized = String(value).trim().toLowerCase().replace(/\./g, '');
  return ['us', 'usa', 'america', 'united states', 'united states of america'].includes(normalized);
}

export function isUsBasedListing(raw) {
  const listing = normalizeListing(raw);
  const hasUsLocation = listing.locations.some((location) => US_STATE_LOCATION.test(location) || isUsCountry(location));
  return hasUsLocation || listing.countries.some(isUsCountry);
}

export function isHybridOrOnsiteListing(raw) {
  const listing = normalizeListing(raw);

  return listing.locations.some((location) => US_STATE_LOCATION.test(location) && !/\bremote\b/i.test(location));
}

function keywordMatches(text, keyword) {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(text);
}

export function isSoftwareInternship(raw) {
  const listing = normalizeListing(raw);
  return SOFTWARE_KEYWORDS.some((keyword) => keywordMatches(listing.title.toLowerCase(), keyword));
}

export function isTargetTermListing(raw) {
  const listing = normalizeListing(raw);
  return listing.terms.some((term) => term.toLowerCase() === SUMMER_2027_TERM);
}

function fieldAllowsListing(value) {
  return value === undefined || value === null || value === true;
}

export function listingMatches(raw) {
  const listing = normalizeListing(raw);

  return Boolean(
    listing.url &&
      fieldAllowsListing(listing.active) &&
      fieldAllowsListing(listing.visible) &&
      isUsBasedListing(raw) &&
      isHybridOrOnsiteListing(raw) &&
      isTargetTermListing(raw) &&
      isSoftwareInternship(raw)
  );
}

export function createListingKey(raw) {
  const listing = normalizeListing(raw);
  if (listing.id) return listing.id;
  if (listing.url) return listing.url;

  const hashInput = [listing.company, listing.title, listing.locations.join('|'), listing.url].join('|');
  return `hash-${createHash('sha256').update(hashInput).digest('hex')}`;
}

function findCompanyIndex(company, companies) {
  return companies.findIndex((rankedCompany) => keywordMatches(company.toLowerCase(), rankedCompany.toLowerCase()));
}

function companyTier(company) {
  const bestIndex = findCompanyIndex(company, BEST_COMPANIES);
  if (bestIndex !== -1) return { tier: 'best', rank: 0, index: bestIndex };

  const goodIndex = findCompanyIndex(company, GOOD_COMPANIES);
  if (goodIndex !== -1) return { tier: 'good', rank: 1, index: goodIndex };

  return { tier: 'other', rank: 2, index: Number.MAX_SAFE_INTEGER };
}

function compareNormalizedDates(a, b) {
  return (normalizeListing(b).datePosted ?? '').localeCompare(normalizeListing(a).datePosted ?? '');
}

export function sortListingsForPosting(listings) {
  return [...listings].sort((a, b) => {
    const listingA = normalizeListing(a);
    const listingB = normalizeListing(b);
    const rankA = companyTier(listingA.company);
    const rankB = companyTier(listingB.company);

    if (rankA.rank !== rankB.rank) return rankA.rank - rankB.rank;
    if (rankA.index !== rankB.index) return rankA.index - rankB.index;

    const dateComparison = compareNormalizedDates(a, b);
    if (dateComparison !== 0) return dateComparison;

    return listingA.company.localeCompare(listingB.company) || listingA.title.localeCompare(listingB.title);
  });
}

function groupListingsByCompany(listings) {
  const groups = new Map();

  for (const rawListing of listings) {
    const listing = normalizeListing(rawListing);
    const key = listing.company.toLowerCase();

    if (!groups.has(key)) {
      groups.set(key, {
        company: listing.company,
        tier: companyTier(listing.company).tier,
        listings: []
      });
    }

    groups.get(key).listings.push(listing);
  }

  return [...groups.values()];
}

export function selectCompanyGroups(groups) {
  const priorityGroups = groups.filter((group) => group.tier !== 'other');
  const unlistedGroups = groups.filter((group) => group.tier === 'other');

  const unlistedLimit = priorityGroups.length >= 10
    ? MAX_UNLISTED_WHEN_PRIORITY_IS_HIGH
    : MAX_UNLISTED_WHEN_PRIORITY_IS_LOW;

  return [...priorityGroups, ...unlistedGroups.slice(0, unlistedLimit)];
}

function tierIcon(tier) {
  if (tier === 'best') return '🔥 ';
  if (tier === 'good') return '✨ ';
  return '';
}

function formatPacificDate(date) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    timeZone: PACIFIC_TIME_ZONE
  }).format(date);
}

function formatDateRange(now) {
  const end = new Date(now);
  const start = new Date(end.getTime() - 24 * 60 * 60 * 1000);
  return `${formatPacificDate(start)} - ${formatPacificDate(end)}`;
}

function formatCompanySection(companyPost, index) {
  const heading = `### ${index + 1}. ${tierIcon(companyPost.tier)}**${companyPost.company}**`;

  if (companyPost.listings.length === 1) {
    const listing = companyPost.listings[0];
    return [
      heading,
      `Title: ${listing.title}`,
      `Location: ${listing.locations.join(', ') || 'Unknown location'}`,
      `Apply: ${listing.url}`
    ].join('\n');
  }

  const roleLines = companyPost.listings.map((listing) => {
    const locations = listing.locations.join(', ') || 'Unknown location';
    return `- ${listing.title} — ${locations} — ${listing.url}`;
  });

  return [heading, 'Titles:', ...roleLines].join('\n');
}

function splitLinesForDiscord(lines) {
  const chunks = [];
  let current = '';

  for (const line of lines) {
    if (line.length > DISCORD_CONTENT_LIMIT) {
      if (current) {
        chunks.push(current.trim());
        current = '';
      }

      for (let index = 0; index < line.length; index += DISCORD_CONTENT_LIMIT) {
        chunks.push(line.slice(index, index + DISCORD_CONTENT_LIMIT));
      }
      continue;
    }

    const next = current ? `${current}\n${line}` : line;
    if (next.length <= DISCORD_CONTENT_LIMIT) {
      current = next;
      continue;
    }

    if (current) chunks.push(current.trim());
    current = line;
  }

  if (current) chunks.push(current.trim());
  return chunks;
}

function buildPayload(content) {
  return {
    username: 'Internship Notifier',
    allowed_mentions: { parse: [] },
    content
  };
}

export function buildDiscordPayload(companyPosts, options = {}) {
  const posts = Array.isArray(companyPosts) ? companyPosts : [companyPosts];
  const now = options.now ?? new Date();
  const listingCount = posts.reduce((count, companyPost) => count + companyPost.listings.length, 0);
  const sections = posts.map(formatCompanySection);
  const internshipLabel = listingCount === 1 ? 'internship' : 'internships';
  const lines = [
    '# Daily 2027 Summer Internship Updates',
    '',
    `**${listingCount} new U.S. CS/software ${internshipLabel} found today**  `,
    formatDateRange(now),
    DAILY_POST_TIME_LABEL,
    '',
    '━━━━━━━━━━━━━━━━━━━━',
    '',
    ...sections.flatMap((section) => [...section.split('\n'), '']),
    '━━━━━━━━━━━━━━━━━━━━',
    '',
    `Source repo: ${SOURCE_REPO_URL}`,
    '',
    'Simplify 2027 Internship Board:',
    SIMPLIFY_2027_BOARD_URL
  ];

  return splitLinesForDiscord(lines).map(buildPayload);
}

export async function fetchWithTimeout(url, options = {}, timeoutMs = NETWORK_TIMEOUT_MS, fetchImpl = fetch) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetchImpl(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchListings(url) {
  const response = await fetchWithTimeout(url, {
    headers: { accept: 'application/json' }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch listings: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  if (Array.isArray(data)) return data;

  const nestedArray = Object.values(data ?? {}).find(Array.isArray);
  return nestedArray ?? [];
}

async function loadState(path = DEFAULT_STATE_PATH) {
  try {
    const state = JSON.parse(await readFile(path, 'utf8'));
    return {
      seen: Array.isArray(state.seen) ? state.seen : [],
      lastRunAt: state.lastRunAt || null
    };
  } catch (error) {
    if (error.code === 'ENOENT') return { seen: [], lastRunAt: null };
    throw error;
  }
}

async function saveState(state, path = DEFAULT_STATE_PATH) {
  await mkdir(dirname(path), { recursive: true });
  const body = `${JSON.stringify({ seen: [...new Set(state.seen)], lastRunAt: state.lastRunAt }, null, 2)}\n`;
  await writeFile(path, body);
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function retryAfterDelayMs(response, attempt) {
  const retryAfter = response.headers?.get?.('retry-after');

  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;

    const retryAt = Date.parse(retryAfter);
    if (!Number.isNaN(retryAt)) return Math.max(0, retryAt - Date.now());
  }

  return DEFAULT_RATE_LIMIT_DELAY_MS * 2 ** attempt;
}

async function postPayloadToDiscord(webhookUrl, payload) {
  for (let attempt = 0; attempt <= MAX_DISCORD_RATE_LIMIT_RETRIES; attempt += 1) {
    const response = await fetchWithTimeout(webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (response.ok) return;

    if (response.status === 429 && attempt < MAX_DISCORD_RATE_LIMIT_RETRIES) {
      await wait(retryAfterDelayMs(response, attempt));
      continue;
    }

    const body = await response.text();
    throw new Error(`Discord webhook failed: ${response.status} ${body}`);
  }
}

export async function postToDiscord(webhookUrl, companyPosts, options = {}) {
  const payloads = buildDiscordPayload(companyPosts, options);
  for (const payload of payloads) {
    await postPayloadToDiscord(webhookUrl, payload);
  }
}

function getConfig() {
  return {
    listingsUrl: process.env.LISTINGS_URL || DEFAULT_LISTINGS_URL,
    webhookUrl: process.env.DISCORD_WEBHOOK_URL || '',
    dryRun: envBoolean('DRY_RUN', false),
    statePath: DEFAULT_STATE_PATH
  };
}

export async function run(config = getConfig(), dependencies = {}) {
  if (!config.dryRun && !config.webhookUrl) {
    throw new Error('DISCORD_WEBHOOK_URL is required unless DRY_RUN=true');
  }

  const fetchListingsForRun = dependencies.fetchListings ?? fetchListings;
  const postDailyUpdateForRun = dependencies.postToDiscord
    ? (companyPosts, options) => dependencies.postToDiscord(companyPosts, options)
    : (companyPosts, options) => postToDiscord(config.webhookUrl, companyPosts, options);
  const now = dependencies.now ?? (() => new Date());
  const listingsUrl = config.listingsUrl || DEFAULT_LISTINGS_URL;
  const statePath = config.statePath || DEFAULT_STATE_PATH;

  const state = await loadState(statePath);
  const seen = new Set(state.seen);
  const listings = await fetchListingsForRun(listingsUrl);
  const matches = sortListingsForPosting(listings.filter(listingMatches));
  const newMatches = matches.filter((listing) => !seen.has(createListingKey(listing)));
  const companyPosts = selectCompanyGroups(groupListingsByCompany(newMatches));
  const firstRun = state.lastRunAt === null;
  const currentRun = now();
  const runAt = currentRun.toISOString();

  console.log(`Fetched ${listings.length} listings`);
  console.log('Found %d matching U.S. Summer 2027 hybrid/on-site CS/software, AI, or data internships', matches.length);
  console.log(`Found ${newMatches.length} new listings in ${companyPosts.length} company posts`);

  if (config.dryRun) {
    console.log('Dry run enabled, not posting to Discord');
    return;
  }

  if (firstRun) {
    await saveState({ seen: matches.map(createListingKey), lastRunAt: runAt }, statePath);
    console.log('Seeded existing listings');
    return;
  }

  if (companyPosts.length > 0) {
    await postDailyUpdateForRun(companyPosts, { now: currentRun });
  }

  for (const companyPost of companyPosts) {
    for (const listing of companyPost.listings) {
      seen.add(createListingKey(listing));
    }
  }

  if (companyPosts.length > 0) {
    console.log(`Posted daily update with ${newMatches.length} listings in ${companyPosts.length} company sections`);
  }

  await saveState({ seen: [...seen], lastRunAt: runAt }, statePath);
}

const isCli = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isCli) {
  run().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
