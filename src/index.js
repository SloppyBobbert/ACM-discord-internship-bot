import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_LISTINGS_URL = 'https://raw.githubusercontent.com/SimplifyJobs/Summer2026-Internships/dev/.github/scripts/listings.json';
const DEFAULT_STATE_PATH = 'data/seen.json';
const DEFAULT_TARGET_TERMS = ['summer 2027'];

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

const DEFAULT_BEST_COMPANIES = [
  'Google',
  'Alphabet',
  'Apple',
  'Microsoft',
  'Amazon',
  'Meta',
  'Facebook',
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
  'Block',
  'Square',
  'Coinbase',
  'Robinhood',
  'Jane Street',
  'Citadel',
  'Citadel Securities',
  'Two Sigma',
  'Hudson River Trading',
  'Jump Trading',
  'LinkedIn',
  'Salesforce',
  'Adobe',
  'Oracle',
  'AMD',
  'Broadcom',
  'Intel',
  'Qualcomm',
  'Cisco',
  'Cloudflare',
  'ServiceNow',
  'Shopify',
  'Atlassian',
  'Figma',
  'Dropbox',
  'GitHub',
  'MongoDB',
  'Datadog',
  'CrowdStrike',
  'Palo Alto Networks',
  'Zscaler'
];

const DEFAULT_GOOD_COMPANIES = [
  'Asana',
  'Box',
  'Twilio',
  'Okta',
  'Splunk',
  'Elastic',
  'HashiCorp',
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
  'Grammarly',
  'Rippling',
  'Ramp',
  'Plaid',
  'Brex',
  'Chime',
  'Affirm',
  'SoFi',
  'Lyft',
  'Instacart',
  'Zipline',
  'Anduril',
  'Scale AI',
  'Cohere',
  'Perplexity',
  'Hugging Face',
  'Vercel',
  'Netlify',
  'Linear',
  'Retool',
  'Zapier',
  'Sentry',
  'GitLab',
  'Docker',
  'Confluent',
  'Cockroach Labs',
  'PlanetScale',
  'Supabase',
  'Vanta',
  'Verkada',
  'Samsara',
  'AppLovin',
  'Roku',
  'Yelp',
  'Zillow',
  'Expedia',
  'Wayfair',
  'Chewy',
  'Capital One',
  'JPMorgan Chase',
  'Goldman Sachs',
  'Bloomberg',
  'The Trade Desk',
  'Indeed',
  'Workiva',
  'Epic',
  'Garmin',
  'IBM',
  'Hewlett Packard Enterprise',
  'HP',
  'Dell',
  'Texas Instruments',
  'Micron',
  'Lam Research',
  'ASML',
  'Arm'
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
  const terms = Array.isArray(raw.terms)
    ? raw.terms.filter(Boolean).map(String)
    : raw.term
      ? [String(raw.term)]
      : [];

  return {
    id: raw.id ? String(raw.id) : undefined,
    company: raw.company_name || raw.company || raw.companyName || 'Unknown',
    title: raw.title || raw.role || raw.position || 'Unknown role',
    category: raw.category || '',
    locations,
    terms,
    url: raw.url || raw.apply_url || raw.application_url || '',
    datePosted: normalizeDate(raw.date_posted || raw.datePosted || raw.posted_at),
    sponsorship: raw.sponsorship || undefined,
    active: raw.active,
    visible: raw.is_visible ?? raw.visible
  };
}

function hasExcludedLocation(location, nonUsTerms = DEFAULT_NON_US_TERMS) {
  const normalized = location.toLowerCase();
  return nonUsTerms.some((term) => keywordMatches(normalized, term.toLowerCase()));
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
    const hasSpecificLocation = US_STATE_LOCATION.test(location);
    return hasSpecificLocation && !mentionsRemote;
  });
}

function keywordMatches(text, keyword) {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(text);
}

export function isSoftwareInternship(raw, keywords = DEFAULT_SOFTWARE_KEYWORDS) {
  const listing = normalizeListing(raw);
  const searchable = listing.title.toLowerCase();

  return keywords.some((keyword) => keywordMatches(searchable, keyword.toLowerCase()));
}

export function isTargetTermListing(raw, targetTerms = DEFAULT_TARGET_TERMS) {
  const listing = normalizeListing(raw);
  const normalizedTargets = targetTerms.map((term) => term.toLowerCase());

  return listing.terms.some((term) => normalizedTargets.includes(term.toLowerCase()));
}

function findCompanyIndex(company, companies) {
  return companies.findIndex((rankedCompany) => keywordMatches(company, rankedCompany.toLowerCase()));
}

function compareNormalizedDates(a, b) {
  const dateA = normalizeListing(a).datePosted ?? '';
  const dateB = normalizeListing(b).datePosted ?? '';
  return dateB.localeCompare(dateA);
}

function companyRank(raw, bestCompanies = DEFAULT_BEST_COMPANIES, goodCompanies = DEFAULT_GOOD_COMPANIES) {
  const company = normalizeListing(raw).company.toLowerCase();
  const bestIndex = findCompanyIndex(company, bestCompanies);
  if (bestIndex !== -1) return { tier: 0, index: bestIndex };

  const goodIndex = findCompanyIndex(company, goodCompanies);
  if (goodIndex !== -1) return { tier: 1, index: goodIndex };

  return { tier: 2, index: Number.MAX_SAFE_INTEGER };
}

export function sortListingsByRank(listings, options = {}) {
  const bestCompanies = options.bestCompanies ?? DEFAULT_BEST_COMPANIES;
  const goodCompanies = options.goodCompanies ?? DEFAULT_GOOD_COMPANIES;

  return [...listings].sort((a, b) => {
    const rankA = companyRank(a, bestCompanies, goodCompanies);
    const rankB = companyRank(b, bestCompanies, goodCompanies);

    if (rankA.tier !== rankB.tier) return rankA.tier - rankB.tier;
    if (rankA.index !== rankB.index) return rankA.index - rankB.index;

    const dateComparison = compareNormalizedDates(a, b);
    if (dateComparison !== 0) return dateComparison;

    const listingA = normalizeListing(a);
    const listingB = normalizeListing(b);
    return listingA.company.localeCompare(listingB.company) || listingA.title.localeCompare(listingB.title);
  });
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
      isTargetTermListing(raw, options.targetTerms) &&
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
    targetTerms: splitConfigList(process.env.TARGET_TERMS, DEFAULT_TARGET_TERMS),
    nonUsTerms: splitConfigList(process.env.NON_US_LOCATION_TERMS, DEFAULT_NON_US_TERMS),
    softwareKeywords: splitConfigList(process.env.SOFTWARE_KEYWORDS, DEFAULT_SOFTWARE_KEYWORDS),
    bestCompanies: splitConfigList(process.env.BEST_COMPANIES, DEFAULT_BEST_COMPANIES),
    goodCompanies: splitConfigList(process.env.GOOD_COMPANIES, DEFAULT_GOOD_COMPANIES)
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
  const matches = sortListingsByRank(listings.filter((listing) => listingMatches(listing, config)), config);
  const newMatches = matches.filter((listing) => !seen.has(createListingKey(listing))).slice(0, config.maxPostsPerRun);
  const firstRun = state.lastRunAt === null;
  const runAt = now().toISOString();
  const targetTerms = config.targetTerms ?? DEFAULT_TARGET_TERMS;

  console.log(`Fetched ${listings.length} listings`);
  console.log(`Found ${matches.length} matching U.S. CS/software ${targetTerms.join(', ')} hybrid/on-site internships`);
  console.log(`Found ${newMatches.length} new listings`);

  if (config.dryRun) {
    console.log('Dry run enabled, not posting to Discord');
    return;
  }

  if (firstRun && !config.postOnFirstRun) {
    const seeded = matches.map(createListingKey);
    await saveState({ seen: seeded, lastRunAt: runAt }, config.statePath);
    console.log('Seeded existing listings');
    return;
  }

  for (const rawListing of newMatches) {
    const listing = normalizeListing(rawListing);
    await postListingForRun(listing);
    seen.add(createListingKey(rawListing));
    await saveState({ seen: [...seen], lastRunAt: runAt }, config.statePath);
    console.log(`Posted ${listing.company} - ${listing.title}`);
  }

  await saveState({ seen: [...seen], lastRunAt: runAt }, config.statePath);
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
