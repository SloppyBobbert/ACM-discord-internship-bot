import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_LISTINGS_URL = 'https://raw.githubusercontent.com/SimplifyJobs/Summer2026-Internships/dev/.github/scripts/listings.json';
const DEFAULT_STATE_PATH = 'data/seen.json';

const US_STATES = 'AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC';
const US_STATE_LOCATION = new RegExp(`\\b[A-Z][A-Za-z .'-]+,\\s*(${US_STATES})\\b`);

const DEFAULT_NON_US_TERMS = [
  'canada',
  'toronto',
  'vancouver',
  'uk',
  'united kingdom',
  'london',
  'india',
  'singapore',
  'germany',
  'france',
  'netherlands'
];

const DEFAULT_SOFTWARE_KEYWORDS = [
  'software',
  'software engineer',
  'swe',
  'developer',
  'backend',
  'frontend',
  'full stack',
  'infrastructure',
  'platform',
  'cloud',
  'security',
  'machine learning',
  'ai',
  'data science',
  'ai/ml/data'
];

function envBoolean(name, defaultValue = false) {
  const value = process.env[name];
  if (value === undefined) return defaultValue;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function envInteger(name, defaultValue) {
  const value = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(value) && value >= 0 ? value : defaultValue;
}

function splitConfigList(value, fallback) {
  if (!value) return fallback;
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
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

export function normalizeListing(raw = {}) {
  const locations = Array.isArray(raw.locations)
    ? raw.locations.filter(Boolean).map(String)
    : raw.location
      ? [String(raw.location)]
      : [];

  return {
    id: raw.id ? String(raw.id) : undefined,
    company: raw.company_name || raw.company || raw.companyName || 'Unknown',
    title: raw.title || raw.role || raw.position || 'Unknown role',
    category: raw.category || '',
    locations,
    url: raw.url || raw.apply_url || raw.application_url || '',
    datePosted: normalizeDate(raw.date_posted || raw.datePosted || raw.posted_at),
    sponsorship: raw.sponsorship || undefined,
    active: raw.active,
    visible: raw.is_visible ?? raw.visible
  };
}

function hasExcludedLocation(location, nonUsTerms = DEFAULT_NON_US_TERMS) {
  const normalized = location.toLowerCase();
  return nonUsTerms.some((term) => normalized.includes(term.toLowerCase()));
}

export function isUsBasedListing(raw, nonUsTerms = DEFAULT_NON_US_TERMS) {
  const listing = normalizeListing(raw);

  return listing.locations.some((location) => {
    const normalized = location.toLowerCase();
    if (hasExcludedLocation(location, nonUsTerms)) return false;
    return US_STATE_LOCATION.test(location) || normalized.includes('united states') || /\busa\b/.test(normalized);
  });
}

export function isHybridOrOnsiteListing(raw) {
  const listing = normalizeListing(raw);

  return listing.locations.some((location) => {
    const normalized = location.toLowerCase();
    const mentionsRemote = /\bremote\b/.test(normalized);
    const mentionsHybrid = /\bhybrid\b/.test(normalized);
    return mentionsHybrid || !mentionsRemote;
  });
}

function keywordMatches(text, keyword) {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(text);
}

export function isSoftwareInternship(raw, keywords = DEFAULT_SOFTWARE_KEYWORDS) {
  const listing = normalizeListing(raw);
  const searchable = `${listing.title} ${listing.category}`.toLowerCase();

  return keywords.some((keyword) => keywordMatches(searchable, keyword.toLowerCase()));
}

function fieldAllowsListing(value) {
  return value === undefined || value === null || value === true;
}

export function listingMatches(raw, options = {}) {
  const listing = normalizeListing(raw);

  return Boolean(
    listing.url &&
      fieldAllowsListing(listing.active) &&
      fieldAllowsListing(listing.visible) &&
      isUsBasedListing(raw, options.nonUsTerms) &&
      isHybridOrOnsiteListing(raw) &&
      isSoftwareInternship(raw, options.softwareKeywords)
  );
}

export function createListingKey(raw) {
  const listing = normalizeListing(raw);
  if (listing.id) return listing.id;
  if (listing.url) return listing.url;

  const hashInput = [listing.company, listing.title, listing.locations.join('|'), listing.url].join('|');
  return `hash-${createHash('sha256').update(hashInput).digest('hex')}`;
}

export function buildDiscordPayload(listing) {
  const locations = listing.locations?.join(', ') || 'Unknown';
  const fields = [
    { name: 'Company', value: listing.company || 'Unknown', inline: true },
    { name: 'Location', value: locations, inline: true },
    { name: 'Sponsorship', value: listing.sponsorship || 'Unknown', inline: true },
    { name: 'Source', value: 'SimplifyJobs', inline: true }
  ];

  if (listing.datePosted) {
    fields.splice(3, 0, { name: 'Date posted', value: listing.datePosted, inline: true });
  }

  return {
    username: 'Internship Notifier',
    allowed_mentions: { parse: [] },
    embeds: [
      {
        title: `${listing.company || 'Unknown'} - ${listing.title || 'Unknown role'}`.slice(0, 256),
        url: listing.url,
        description: locations,
        fields
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

async function postToDiscord(webhookUrl, listing) {
  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(buildDiscordPayload(listing))
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Discord webhook failed: ${response.status} ${body}`);
  }
}

function getConfig() {
  const dryRun = envBoolean('DRY_RUN', false);

  return {
    listingsUrl: process.env.LISTINGS_URL || DEFAULT_LISTINGS_URL,
    webhookUrl: process.env.DISCORD_WEBHOOK_URL || '',
    dryRun,
    postOnFirstRun: envBoolean('POST_ON_FIRST_RUN', false),
    maxPostsPerRun: envInteger('MAX_POSTS_PER_RUN', 10),
    statePath: process.env.STATE_PATH || DEFAULT_STATE_PATH,
    nonUsTerms: splitConfigList(process.env.NON_US_LOCATION_TERMS, DEFAULT_NON_US_TERMS),
    softwareKeywords: splitConfigList(process.env.SOFTWARE_KEYWORDS, DEFAULT_SOFTWARE_KEYWORDS)
  };
}

async function sendTestWebhook(config = getConfig()) {
  if (!config.webhookUrl) {
    throw new Error('DISCORD_WEBHOOK_URL is required for --test-webhook');
  }

  await postToDiscord(config.webhookUrl, {
    company: 'Internship Notifier',
    title: 'Test message',
    locations: ['Chico, CA'],
    url: 'https://github.com/SimplifyJobs/Summer2026-Internships',
    sponsorship: 'Unknown',
    datePosted: new Date().toISOString().slice(0, 10)
  });

  console.log('Posted test webhook message');
}

export async function run(config = getConfig(), dependencies = {}) {
  if (!config.dryRun && !config.webhookUrl) {
    throw new Error('DISCORD_WEBHOOK_URL is required unless DRY_RUN=true');
  }

  const fetchListingsForRun = dependencies.fetchListings ?? fetchListings;
  const postListingForRun = dependencies.postToDiscord
    ? (listing) => dependencies.postToDiscord(listing)
    : (listing) => postToDiscord(config.webhookUrl, listing);
  const now = dependencies.now ?? (() => new Date());

  const state = await loadState(config.statePath);
  const seen = new Set(state.seen);
  const listings = await fetchListingsForRun(config.listingsUrl);
  const matches = listings.filter((listing) => listingMatches(listing, config));
  const newMatches = matches.filter((listing) => !seen.has(createListingKey(listing))).slice(0, config.maxPostsPerRun);
  const firstRun = state.seen.length === 0;

  console.log(`Fetched ${listings.length} listings`);
  console.log(`Found ${matches.length} matching U.S. CS 2027-ready hybrid/on-site internships`);
  console.log(`Found ${newMatches.length} new listings`);

  if (config.dryRun) {
    console.log('Dry run enabled, not posting to Discord');
    return;
  }

  if (firstRun && !config.postOnFirstRun) {
    const seeded = matches.map(createListingKey);
    await saveState({ seen: seeded, lastRunAt: now().toISOString() }, config.statePath);
    console.log('Seeded existing listings');
    return;
  }

  for (const listing of newMatches.map(normalizeListing)) {
    await postListingForRun(listing);
    console.log(`Posted ${listing.company} - ${listing.title}`);
  }

  for (const listing of newMatches) {
    seen.add(createListingKey(listing));
  }

  await saveState({ seen: [...seen], lastRunAt: now().toISOString() }, config.statePath);
}

const isCli = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isCli) {
  const command = process.argv[2];
  const action = command === '--test-webhook' ? sendTestWebhook : run;

  action().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
