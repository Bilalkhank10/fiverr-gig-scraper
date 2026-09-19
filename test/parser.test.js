import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { extractProps, getGigs, getPagination, getCurrency, flattenGig, buildUrl, isBlocked } from '../src/parser.js';

const html = readFileSync(new URL('./sample_search_page.html', import.meta.url), 'utf8');
assert.equal(isBlocked(html), false);
const props = extractProps(html);
const gigs = getGigs(props);
assert.equal(gigs.length, 48);
assert.equal(getPagination(props).pageSize, 48);
assert.equal(getCurrency(props), 'USD');
const rec = flattenGig(gigs[5], 6, { includeGallery: true, currency: 'USD' });
assert.ok(rec.id && rec.title && rec.url.startsWith('https://www.fiverr.com/'));
assert.ok(rec.seller_username && rec.seller_rating_score > 0);
assert.ok(rec.starting_price > 0 && rec.delivery_days > 0);
assert.ok(Array.isArray(rec.gallery_images));
const promoted = gigs.filter((g) => g.type === 'promoted_gigs').length;
console.log(`✅ parser OK — 48 gigs, ${promoted} promoted, sample:`, JSON.stringify(rec, null, 1).slice(0, 600));
assert.equal(buildUrl({ query: 'logo design', page: 2, sortBy: 'rating' }),
  'https://www.fiverr.com/search/gigs?query=logo+design&source=top-bar&page=2&offset=48&sort_by=rating');
console.log('✅ all tests passed');
