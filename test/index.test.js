import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
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
  run
} from '../src/index.js';

const baseListing = {
  id: 'job-1',
  company_name: 'Example Co',
  title: 'Software Engineering Intern',
  category: 'Software Engineering',
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

test('accepts U.S. city/state and rejects obvious non-U.S. locations', () => {
  assert.equal(isUsBasedListing({ ...baseListing, locations: ['Seattle, WA'] }), true);
  assert.equal(isUsBasedListing({ ...baseListing, locations: ['Austin, TX'] }), true);
  assert.equal(isUsBasedListing({ ...baseListing, locations: ['Milwaukee, WI'] }), true);
  assert.equal(isUsBasedListing({ ...baseListing, locations: ['Indianapolis, IN'] }), true);
  assert.equal(isUsBasedListing({ ...baseListing, locations: ['Tukwila, WA'] }), true);
  assert.equal(isUsBasedListing({ ...baseListing, locations: ['Toronto, Canada'] }), false);
  assert.equal(isUsBasedListing({ ...baseListing, locations: ['London, UK'] }), false);
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
  assert.equal(isSoftwareInternship({ ...baseListing, title: 'Product Manager Intern', category: 'Product' }), false);
});

test('accepts only configured target terms', () => {
  assert.equal(isTargetTermListing(baseListing), true);
  assert.equal(isTargetTermListing({ ...baseListing, terms: ['Summer 2026'] }), false);
  assert.equal(isTargetTermListing({ ...baseListing, terms: ['Fall 2026'] }, ['fall 2026']), true);
  assert.equal(isTargetTermListing({ ...baseListing, terms: [] }), false);
});

test('matching requires visible active U.S. software internship for the target term with apply URL and on-site or hybrid location', () => {
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

test('builds safe Discord webhook embeds without accidental mentions', () => {
  const payload = buildDiscordPayload(normalizeListing(baseListing));

  assert.deepEqual(payload.allowed_mentions, { parse: [] });
  assert.equal(payload.username, 'Internship Notifier');
  assert.equal(payload.embeds[0].title, 'Example Co - Software Engineering Intern');
  assert.equal(payload.embeds[0].url, 'https://example.com/apply');
  assert.equal(payload.embeds[0].fields.some((field) => field.name === 'Source' && field.value === 'SimplifyJobs'), true);
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

test('first run seeds matching listings without posting when POST_ON_FIRST_RUN is false', async () => {
  await withTempState(async (statePath) => {
    const posted = [];

    await run(
      {
        dryRun: false,
        webhookUrl: 'https://discord.example/webhook',
        postOnFirstRun: false,
        maxPostsPerRun: 10,
        statePath,
        nonUsTerms: undefined,
        softwareKeywords: undefined
      },
      {
        fetchListings: async () => [matchingListing('seed-1'), matchingListing('seed-2')],
        postToDiscord: async (listing) => posted.push(listing),
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
        postOnFirstRun: false,
        maxPostsPerRun: 10,
        statePath,
        nonUsTerms: undefined,
        softwareKeywords: undefined,
        targetTerms: undefined
      },
      {
        fetchListings: async () => [],
        postToDiscord: async (listing) => posted.push(listing.id),
        now: () => new Date('2026-06-17T00:00:00.000Z')
      }
    );

    await run(
      {
        dryRun: false,
        webhookUrl: 'https://discord.example/webhook',
        postOnFirstRun: false,
        maxPostsPerRun: 10,
        statePath,
        nonUsTerms: undefined,
        softwareKeywords: undefined,
        targetTerms: undefined
      },
      {
        fetchListings: async () => [matchingListing('later-1')],
        postToDiscord: async (listing) => posted.push(listing.id),
        now: () => new Date('2026-06-17T00:30:00.000Z')
      }
    );

    const state = JSON.parse(await readFile(statePath, 'utf8'));
    assert.deepEqual(posted, ['later-1']);
    assert.deepEqual(state.seen, ['later-1']);
    assert.equal(state.lastRunAt, '2026-06-17T00:30:00.000Z');
  });
});

test('posting honors MAX_POSTS_PER_RUN and saves only posted listing keys', async () => {
  await withTempState(async (statePath) => {
    await writeFile(statePath, `${JSON.stringify({ seen: ['already-seen'], lastRunAt: null }, null, 2)}\n`);
    const posted = [];

    await run(
      {
        dryRun: false,
        webhookUrl: 'https://discord.example/webhook',
        postOnFirstRun: true,
        maxPostsPerRun: 2,
        statePath,
        nonUsTerms: undefined,
        softwareKeywords: undefined
      },
      {
        fetchListings: async () => [
          matchingListing('already-seen'),
          matchingListing('new-1'),
          matchingListing('new-2'),
          matchingListing('new-3')
        ],
        postToDiscord: async (listing) => posted.push(listing.id),
        now: () => new Date('2026-06-17T00:00:00.000Z')
      }
    );

    const state = JSON.parse(await readFile(statePath, 'utf8'));
    assert.deepEqual(posted, ['new-1', 'new-2']);
    assert.deepEqual(state.seen, ['already-seen', 'new-1', 'new-2']);
  });
});

test('saved state includes successful posts when a later Discord post fails', async () => {
  await withTempState(async (statePath) => {
    await writeFile(statePath, `${JSON.stringify({ seen: ['already-seen'], lastRunAt: '2026-06-16T00:00:00.000Z' }, null, 2)}\n`);
    const posted = [];

    await assert.rejects(
      run(
        {
          dryRun: false,
          webhookUrl: 'https://discord.example/webhook',
          postOnFirstRun: true,
          maxPostsPerRun: 10,
          statePath,
          nonUsTerms: undefined,
          softwareKeywords: undefined,
          targetTerms: undefined
        },
        {
          fetchListings: async () => [matchingListing('new-1'), matchingListing('new-2')],
          postToDiscord: async (listing) => {
            if (listing.id === 'new-2') throw new Error('Discord rejected the post');
            posted.push(listing.id);
          },
          now: () => new Date('2026-06-17T00:00:00.000Z')
        }
      ),
      /Discord rejected the post/
    );

    const state = JSON.parse(await readFile(statePath, 'utf8'));
    assert.deepEqual(posted, ['new-1']);
    assert.deepEqual(state.seen, ['already-seen', 'new-1']);
    assert.equal(state.lastRunAt, '2026-06-17T00:00:00.000Z');
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
        postOnFirstRun: true,
        maxPostsPerRun: 10,
        statePath,
        nonUsTerms: undefined,
        softwareKeywords: undefined
      },
      {
        fetchListings: async () => [matchingListing('dry-1')],
        postToDiscord: async (listing) => posted.push(listing),
        now: () => new Date('2026-06-17T00:00:00.000Z')
      }
    );

    const state = JSON.parse(await readFile(statePath, 'utf8'));
    assert.deepEqual(posted, []);
    assert.deepEqual(state, initialState);
  });
});
