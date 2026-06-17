import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE_REPO_URL = 'https://github.com/SimplifyJobs/Summer2026-Internships';
const DEFAULT_LISTINGS_URL = 'https://raw.githubusercontent.com/SimplifyJobs/Summer2026-Internships/dev/.github/scripts/listings.json';
const DEFAULT_STATE_PATH = 'data/seen.json';

const SUMMER_2027_TERM = 'summer 2027';
const MAX_UNLISTED_WHEN_PRIORITY_IS_HIGH = 5;
const MAX_UNLISTED_WHEN_PRIORITY_IS_LOW = 10;

const US_STATES = 'AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC';
const US_STATE_LOCATION = new RegExp(`\\b[A-Z][A-Za-z .'-]+,\\s*(${US_STATES})\\b`);

const SOFTWARE_KEYWORDS = [
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
    const milliseconds = value > 10_000_000_000 ? value : value * 1000;
    return new Date(milliseconds).toISOString().slice(0, 10);
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
  return /\b(usa|america)\b/i.test(value);
}

export function isUsBasedListing(raw) {
  const listing = normalizeListing(raw);
  if (listing.countries.length > 0) return listing.countries.some(isUsCountry);

  return listing.locations.some((location) => US_STATE_LOCATION.test(location) || isUsCountry(location));
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

export function buildDiscordPayload(companyPost) {
  const roleLines = companyPost.listings.map((listing) => {
    const locations = listing.locations.join(', ') || 'Unknown location';
    return `- [${listing.title}](${listing.url}) — ${locations}`;
  });
  const roleCount = companyPost.listings.length;

  return {
    username: 'Internship Notifier',
    allowed_mentions: { parse: [] },
    embeds: [
      {
        title: `${companyPost.company} (${roleCount} role${roleCount === 1 ? '' : 's'})`.slice(0, 256),
        description: roleLines.join('\n').slice(0, 4096),
        fields: [{ name: 'Source', value: `[SimplifyJobs internship repo](${SOURCE_REPO_URL})`, inline: false }]
      }
    ]
  };
}

async function fetchListings(url) {
  const response = await fetch(url, {
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

async function postToDiscord(webhookUrl, companyPost) {
  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(buildDiscordPayload(companyPost))
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Discord webhook failed: ${response.status} ${body}`);
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
  const postCompanyForRun = dependencies.postToDiscord
    ? (companyPost) => dependencies.postToDiscord(companyPost)
    : (companyPost) => postToDiscord(config.webhookUrl, companyPost);
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
  const runAt = now().toISOString();

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

  for (const companyPost of companyPosts) {
    await postCompanyForRun(companyPost);

    for (const listing of companyPost.listings) {
      seen.add(createListingKey(listing));
    }

    await saveState({ seen: [...seen], lastRunAt: runAt }, statePath);
    console.log(`Posted ${companyPost.company} (${companyPost.listings.map((listing) => listing.title).join(', ')})`);
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
