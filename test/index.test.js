import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildDiscordPayload,
  createListingKey,
  isHybridOrOnsiteListing,
  isSoftwareInternship,
  isUsBasedListing,
  listingMatches,
  normalizeListing
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
  sponsorship: 'Unknown',
  date_posted: 1760990869
};

test('normalizes the current SimplifyJobs listing shape defensively', () => {
  const normalized = normalizeListing(baseListing);

  assert.equal(normalized.id, 'job-1');
  assert.equal(normalized.company, 'Example Co');
  assert.equal(normalized.title, 'Software Engineering Intern');
  assert.deepEqual(normalized.locations, ['San Francisco, CA']);
  assert.equal(normalized.url, 'https://example.com/apply');
  assert.equal(normalized.active, true);
  assert.equal(normalized.visible, true);
  assert.equal(normalized.sponsorship, 'Unknown');
  assert.equal(normalized.datePosted, '2025-10-20');
});

test('accepts U.S. city/state and rejects obvious non-U.S. locations', () => {
  assert.equal(isUsBasedListing({ ...baseListing, locations: ['Seattle, WA'] }), true);
  assert.equal(isUsBasedListing({ ...baseListing, locations: ['Austin, TX'] }), true);
  assert.equal(isUsBasedListing({ ...baseListing, locations: ['Toronto, Canada'] }), false);
  assert.equal(isUsBasedListing({ ...baseListing, locations: ['London, UK'] }), false);
});

test('rejects remote-only roles and accepts on-site or hybrid locations', () => {
  assert.equal(isHybridOrOnsiteListing({ ...baseListing, locations: ['Remote in USA'] }), false);
  assert.equal(isHybridOrOnsiteListing({ ...baseListing, locations: ['Remote - United States'] }), false);
  assert.equal(isHybridOrOnsiteListing({ ...baseListing, locations: ['New York, NY'] }), true);
  assert.equal(isHybridOrOnsiteListing({ ...baseListing, locations: ['Hybrid - San Jose, CA'] }), true);
});

test('accepts software internships and rejects unrelated internships', () => {
  assert.equal(isSoftwareInternship(baseListing), true);
  assert.equal(isSoftwareInternship({ ...baseListing, title: 'Product Manager Intern', category: 'Product' }), false);
});

test('matching requires visible active U.S. software internship with apply URL and on-site or hybrid location', () => {
  assert.equal(listingMatches(baseListing), true);
  assert.equal(listingMatches({ ...baseListing, active: false }), false);
  assert.equal(listingMatches({ ...baseListing, is_visible: false }), false);
  assert.equal(listingMatches({ ...baseListing, url: '' }), false);
  assert.equal(listingMatches({ ...baseListing, locations: ['Remote in USA'] }), false);
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
