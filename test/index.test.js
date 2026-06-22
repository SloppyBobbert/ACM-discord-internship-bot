import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  buildDiscordPayload,
  createListingKey,
  isHybridOrOnsiteListing,
  isSoftwareInternship,
  isTargetTermListing,
  isUsBasedListing,
  listingMatches,
  normalizeListing,
  run,
  selectCompanyGroups,
  sortListingsForPosting
} from '../src/index.js';

const baseListing = {
  id: 'job-1',
  company_name: 'Example Co',
  title: 'Software Engineering Intern',
  active: true,
  is_visible: true,
  url: 'https://example.com/apply',
  locations: ['San Francisco, CA'],
  terms: ['Summer 2027'],
  sponsorship: 'Unknown',
  date_posted: 1760990869
};

test('normalizes the current SimplifyJobs listing shape defensively', () => {
  const normalized = normalizeListing(baseListing);

  assert.equal(normalized.id, 'job-1');
  assert.equal(normalized.company, 'Example Co');
  assert.equal(normalized.title, 'Software Engineering Intern');
  assert.deepEqual(normalized.locations, ['San Francisco, CA']);
  assert.deepEqual(normalized.terms, ['Summer 2027']);
  assert.equal(normalized.url, 'https://example.com/apply');
  assert.equal(normalized.active, true);
  assert.equal(normalized.visible, true);
  assert.equal(normalized.sponsorship, 'Unknown');
  assert.equal(normalized.datePosted, '2025-10-20');
});

test('accepts only USA/America country or U.S. city/state locations', () => {
  assert.equal(isUsBasedListing({ ...baseListing, locations: ['Seattle, WA'] }), true);
  assert.equal(isUsBasedListing({ ...baseListing, locations: ['Austin, TX'] }), true);
  assert.equal(isUsBasedListing({ ...baseListing, country: 'USA' }), true);
  assert.equal(isUsBasedListing({ ...baseListing, country: 'America' }), true);
  assert.equal(isUsBasedListing({ ...baseListing, locations: ['Milwaukee, WI'] }), true);
  assert.equal(isUsBasedListing({ ...baseListing, locations: ['Indianapolis, IN'] }), true);
  assert.equal(isUsBasedListing({ ...baseListing, locations: ['Tukwila, WA'] }), true);
  assert.equal(isUsBasedListing({ ...baseListing, locations: ['Toronto, Canada'] }), false);
  assert.equal(isUsBasedListing({ ...baseListing, locations: ['London, UK'] }), false);
  assert.equal(isUsBasedListing({ ...baseListing, country: 'Canada' }), false);
});

test('rejects remote-only roles and accepts on-site or hybrid locations', () => {
  assert.equal(isHybridOrOnsiteListing({ ...baseListing, locations: ['Remote in USA'] }), false);
  assert.equal(isHybridOrOnsiteListing({ ...baseListing, locations: ['Remote - United States'] }), false);
  assert.equal(isHybridOrOnsiteListing({ ...baseListing, locations: ['United States'] }), false);
  assert.equal(isHybridOrOnsiteListing({ ...baseListing, locations: ['New York, NY'] }), true);
  assert.equal(isHybridOrOnsiteListing({ ...baseListing, locations: ['Hybrid - San Jose, CA'] }), true);
});

test('accepts software internships and rejects unrelated internships', () => {
  assert.equal(isSoftwareInternship(baseListing), true);
  assert.equal(isSoftwareInternship({ ...baseListing, title: 'Product Manager Intern' }), false);
  assert.equal(isSoftwareInternship({ ...baseListing, title: 'Tax Technology Intern' }), false);
  assert.equal(isSoftwareInternship({ ...baseListing, title: 'Electricity + Natural Gas Analyst Intern' }), false);
  assert.equal(isSoftwareInternship({ ...baseListing, title: 'Data Science Intern' }), true);
});

test('accepts only the hardcoded Summer 2027 term', () => {
  assert.equal(isTargetTermListing(baseListing), true);
  assert.equal(isTargetTermListing({ ...baseListing, terms: ['Summer 2026'] }), false);
  assert.equal(isTargetTermListing({ ...baseListing, terms: ['Fall 2026'] }), false);
  assert.equal(isTargetTermListing({ ...baseListing, terms: [] }), false);
});

test('matching requires visible active U.S. software internship for Summer 2027 with apply URL and on-site or hybrid location', () => {
  assert.equal(listingMatches(baseListing), true);
  assert.equal(listingMatches({ ...baseListing, active: false }), false);
  assert.equal(listingMatches({ ...baseListing, is_visible: false }), false);
  assert.equal(listingMatches({ ...baseListing, url: '' }), false);
  assert.equal(listingMatches({ ...baseListing, locations: ['Remote in USA'] }), false);
  assert.equal(listingMatches({ ...baseListing, locations: ['United States'] }), false);
  assert.equal(listingMatches({ ...baseListing, terms: ['Summer 2026'] }), false);
});

test('creates stable listing keys by id, then url, then content hash', () => {
  assert.equal(createListingKey(baseListing), 'job-1');
  assert.equal(createListingKey({ ...baseListing, id: undefined }), 'https://example.com/apply');

  const key = createListingKey({ ...baseListing, id: undefined, url: undefined });
  assert.match(key, /^hash-[a-f0-9]{64}$/);
});

test('builds safe daily Discord updates with grouped roles, source repo, and board link', () => {
  const payload = buildDiscordPayload(
    [
      {
        company: 'Google',
        tier: 'best',
        listings: [
          normalizeListing({ ...baseListing, company_name: 'Google', title: 'Software Engineering Intern', url: 'https://example.com/swe', locations: ['Mountain View, CA'] }),
          normalizeListing({ ...baseListing, company_name: 'Google', title: 'Data Science Intern', url: 'https://example.com/data', locations: ['San Francisco, CA'] })
        ]
      },
      {
        company: 'Datadog',
        tier: 'good',
        listings: [
          normalizeListing({ ...baseListing, company_name: 'Datadog', title: 'Software Engineering Intern', url: 'https://example.com/datadog', locations: ['New York, NY'] })
        ]
      },
      {
        company: 'Local Startup',
        tier: 'other',
        listings: [
          normalizeListing({ ...baseListing, company_name: 'Local Startup', title: 'Backend Engineering Intern', url: 'https://example.com/startup', locations: ['San Francisco, CA'] })
        ]
      }
    ],
    { now: new Date('2026-06-22T22:00:00.000Z') }
  );

  assert.deepEqual(payload.allowed_mentions, { parse: [] });
  assert.equal(payload.username, 'Internship Notifier');
  assert.match(payload.content, /# Daily 2027 Summer Internship Updates/);
  assert.match(payload.content, /\*\*4 new U\.S\. CS\/software internships found today\*\*/);
  assert.match(payload.content, /June 21 - June 22/);
  assert.match(payload.content, /Daily at 3:00 PM PT/);
  assert.match(payload.content, /### 1\. 🔥 \*\*Google\*\*/);
  assert.match(payload.content, /- Software Engineering Intern — Mountain View, CA — https:\/\/example\.com\/swe/);
  assert.match(payload.content, /- Data Science Intern — San Francisco, CA — https:\/\/example\.com\/data/);
  assert.match(payload.content, /### 2\. ✨ \*\*Datadog\*\*/);
  assert.match(payload.content, /Title: Software Engineering Intern/);
  assert.match(payload.content, /### 3\. \*\*Local Startup\*\*/);
  assert.match(payload.content, /Source repo: https:\/\/github\.com\/SimplifyJobs\/Summer2026-Internships/);
  assert.match(payload.content, /Simplify 2027 Internship Board:\s+https:\/\/simplify\.jobs\/l\/Summer2027-Internships/);
});

test('sorts listings by hardcoded priority companies, then newest fallback', () => {
  const sorted = sortListingsForPosting([
    { ...baseListing, id: 'unlisted-newer', company_name: 'Local Startup', title: 'Software Intern', date_posted: '2026-06-04' },
    { ...baseListing, id: 'good', company_name: 'Datadog', title: 'Software Intern', date_posted: '2026-06-01' },
    { ...baseListing, id: 'unlisted-older', company_name: 'Another Startup', title: 'Software Intern', date_posted: '2026-06-03' },
    { ...baseListing, id: 'best-second', company_name: 'Apple', title: 'Software Intern', date_posted: '2026-06-02' },
    { ...baseListing, id: 'best-first', company_name: 'Google', title: 'Software Intern', date_posted: '2026-06-01' }
  ]);

  assert.deepEqual(sorted.map((listing) => listing.id), [
    'best-first',
    'best-second',
    'good',
    'unlisted-newer',
    'unlisted-older'
  ]);
});

test('selects unlimited priority companies and caps unlisted company posts by priority volume', () => {
  const priorityGroups = Array.from({ length: 10 }, (_, index) => ({
    company: `Priority ${index}`,
    tier: 'best',
    listings: [normalizeListing({ ...baseListing, id: `priority-${index}`, company_name: `Priority ${index}` })]
  }));
  const unlistedGroups = Array.from({ length: 11 }, (_, index) => ({
    company: `Startup ${index}`,
    tier: 'other',
    listings: [normalizeListing({ ...baseListing, id: `startup-${index}`, company_name: `Startup ${index}` })]
  }));

  assert.equal(selectCompanyGroups([...priorityGroups, ...unlistedGroups]).length, 15);
  assert.deepEqual(
    selectCompanyGroups([...priorityGroups, ...unlistedGroups]).slice(-5).map((group) => group.company),
    ['Startup 0', 'Startup 1', 'Startup 2', 'Startup 3', 'Startup 4']
  );

  assert.equal(selectCompanyGroups([...priorityGroups.slice(0, 8), ...unlistedGroups]).length, 18);
  assert.deepEqual(
    selectCompanyGroups([...priorityGroups.slice(0, 8), ...unlistedGroups]).slice(-10).map((group) => group.company),
    ['Startup 0', 'Startup 1', 'Startup 2', 'Startup 3', 'Startup 4', 'Startup 5', 'Startup 6', 'Startup 7', 'Startup 8', 'Startup 9']
  );

  assert.equal(selectCompanyGroups([...priorityGroups.slice(0, 5), ...unlistedGroups]).length, 15);
  assert.deepEqual(
    selectCompanyGroups([...priorityGroups.slice(0, 5), ...unlistedGroups]).slice(-10).map((group) => group.company),
    ['Startup 0', 'Startup 1', 'Startup 2', 'Startup 3', 'Startup 4', 'Startup 5', 'Startup 6', 'Startup 7', 'Startup 8', 'Startup 9']
  );
});

async function withTempState(testBody) {
  const directory = await mkdtemp(join(tmpdir(), 'internship-state-'));
  const statePath = join(directory, 'seen.json');

  try {
    await testBody(statePath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function matchingListing(id, title = 'Software Engineering Intern') {
  return {
    ...baseListing,
    id,
    title,
    url: `https://example.com/${id}`
  };
}

test('first run seeds matching listings without posting', async () => {
  await withTempState(async (statePath) => {
    const posted = [];

    await run(
      {
        dryRun: false,
        webhookUrl: 'https://discord.example/webhook',
        statePath
      },
      {
        fetchListings: async () => [matchingListing('seed-1'), matchingListing('seed-2')],
        postToDiscord: async (companyPost) => posted.push(companyPost),
        now: () => new Date('2026-06-17T00:00:00.000Z')
      }
    );

    const state = JSON.parse(await readFile(statePath, 'utf8'));
    assert.deepEqual(posted, []);
    assert.deepEqual(state.seen, ['seed-1', 'seed-2']);
    assert.equal(state.lastRunAt, '2026-06-17T00:00:00.000Z');
  });
});

test('second run posts new listings after an empty first run initialized state', async () => {
  await withTempState(async (statePath) => {
    const posted = [];

    await run(
      {
        dryRun: false,
        webhookUrl: 'https://discord.example/webhook',
        statePath
      },
      {
        fetchListings: async () => [],
        postToDiscord: async (companyPosts) => posted.push(...companyPosts.map((companyPost) => companyPost.company)),
        now: () => new Date('2026-06-17T00:00:00.000Z')
      }
    );

    await run(
      {
        dryRun: false,
        webhookUrl: 'https://discord.example/webhook',
        statePath
      },
      {
        fetchListings: async () => [matchingListing('later-1')],
        postToDiscord: async (companyPosts) => posted.push(...companyPosts.map((companyPost) => companyPost.company)),
        now: () => new Date('2026-06-17T00:30:00.000Z')
      }
    );

    const state = JSON.parse(await readFile(statePath, 'utf8'));
    assert.deepEqual(posted, ['Example Co']);
    assert.deepEqual(state.seen, ['later-1']);
    assert.equal(state.lastRunAt, '2026-06-17T00:30:00.000Z');
  });
});

test('posting groups duplicate companies and saves all posted listing keys', async () => {
  await withTempState(async (statePath) => {
    await writeFile(statePath, `${JSON.stringify({ seen: ['already-seen'], lastRunAt: '2026-06-16T00:00:00.000Z' }, null, 2)}\n`);
    const posted = [];

    await run(
      {
        dryRun: false,
        webhookUrl: 'https://discord.example/webhook',
        statePath
      },
      {
        fetchListings: async () => [
          matchingListing('already-seen'),
          { ...matchingListing('google-1'), company_name: 'Google', title: 'Software Engineering Intern' },
          { ...matchingListing('google-2'), company_name: 'Google', title: 'Data Science Intern' },
          { ...matchingListing('apple-1'), company_name: 'Apple', title: 'Software Intern' }
        ],
        postToDiscord: async (companyPosts) => posted.push(companyPosts.map((companyPost) => `${companyPost.company}(${companyPost.listings.map((listing) => listing.title).join(', ')})`)),
        now: () => new Date('2026-06-17T00:00:00.000Z')
      }
    );

    const state = JSON.parse(await readFile(statePath, 'utf8'));
    assert.deepEqual(posted, [['Google(Data Science Intern, Software Engineering Intern)', 'Apple(Software Intern)']]);
    assert.deepEqual(state.seen, ['already-seen', 'google-2', 'google-1', 'apple-1']);
  });
});

test('daily company post selection uses ranked grouped order before posting', async () => {
  await withTempState(async (statePath) => {
    await writeFile(statePath, `${JSON.stringify({ seen: [], lastRunAt: '2026-06-16T00:00:00.000Z' }, null, 2)}\n`);
    const posted = [];

    await run(
      {
        dryRun: false,
        webhookUrl: 'https://discord.example/webhook',
        statePath
      },
      {
        fetchListings: async () => [
          { ...matchingListing('unlisted-newer'), company_name: 'Local Startup', date_posted: '2026-06-04' },
          { ...matchingListing('good'), company_name: 'Datadog', date_posted: '2026-06-01' },
          { ...matchingListing('best-second'), company_name: 'Apple', date_posted: '2026-06-02' },
          { ...matchingListing('best-first'), company_name: 'Google', date_posted: '2026-06-01' }
        ],
        postToDiscord: async (companyPosts) => posted.push(...companyPosts.map((companyPost) => companyPost.company)),
        now: () => new Date('2026-06-17T19:00:00.000Z')
      }
    );

    const state = JSON.parse(await readFile(statePath, 'utf8'));
    assert.deepEqual(posted, ['Google', 'Apple', 'Datadog', 'Local Startup']);
    assert.deepEqual(state.seen, ['best-first', 'best-second', 'good', 'unlisted-newer']);
  });
});

test('state is not updated when the daily Discord update fails', async () => {
  await withTempState(async (statePath) => {
    await writeFile(statePath, `${JSON.stringify({ seen: ['already-seen'], lastRunAt: '2026-06-16T00:00:00.000Z' }, null, 2)}\n`);

    await assert.rejects(
      run(
        {
          dryRun: false,
          webhookUrl: 'https://discord.example/webhook',
          statePath
        },
        {
          fetchListings: async () => [
            { ...matchingListing('new-1'), company_name: 'Google' },
            { ...matchingListing('new-2'), company_name: 'Local Startup' }
          ],
          postToDiscord: async () => {
            throw new Error('Discord rejected the post');
          },
          now: () => new Date('2026-06-17T00:00:00.000Z')
        }
      ),
      /Discord rejected the post/
    );

    const state = JSON.parse(await readFile(statePath, 'utf8'));
    assert.deepEqual(state.seen, ['already-seen']);
    assert.equal(state.lastRunAt, '2026-06-16T00:00:00.000Z');
  });
});

test('dry run does not post or mutate seen state', async () => {
  await withTempState(async (statePath) => {
    const initialState = { seen: [], lastRunAt: null };
    await writeFile(statePath, `${JSON.stringify(initialState, null, 2)}\n`);
    const posted = [];

    await run(
      {
        dryRun: true,
        webhookUrl: '',
        statePath
      },
      {
        fetchListings: async () => [matchingListing('dry-1')],
        postToDiscord: async (companyPost) => posted.push(companyPost),
        now: () => new Date('2026-06-17T00:00:00.000Z')
      }
    );

    const state = JSON.parse(await readFile(statePath, 'utf8'));
    assert.deepEqual(posted, []);
    assert.deepEqual(state, initialState);
  });
});
