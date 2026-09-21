/**
 * Scraper bridge — the web studio's connection to the actor's real parser code.
 *
 * Offline-first by design:
 *   1. `direct`  — fetch fiverr.com through your own IP (or proxy)
 *   2. `jina`    — fetch through r.jina.ai (works without a proxy when Jina is reachable)
 *   3. `sample`  — replay the bundled fixture pages (test/sample_*.html) through the exact
 *                  same parsers, so the studio always produces real, parsed output.
 *
 * Fiverr blocks most datacenter IPs, so a request that ends up blocked falls back to the
 * bundled fixture and is clearly flagged in the run log — no fake numbers, only real input
 * is ever pushed through the parsers.
 */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import {
    extractProps, getGigs, getPagination, getCurrency, flattenGig, buildUrl, isBlocked,
} from '../../src/parser.js';
import { parseGigDetail } from '../../src/gigDetail.js';
import { get, post, BROWSER_HEADERS, parseProxy, buildApifyProxyUrl } from './http.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIXTURES = {
    search: path.join(ROOT, 'test', 'sample_search_page.html'),
    gig: path.join(ROOT, 'test', 'sample_gig_page.html'),
};
const fixtureCache = new Map();

export function fixture(kind) {
    if (!fixtureCache.has(kind)) fixtureCache.set(kind, readFileSync(FIXTURES[kind], 'utf8'));
    return fixtureCache.get(kind);
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const maskProxy = (url) => (url ? String(url).replace(/\/\/[^@/]+@/, '//•••:•••@') : null);

export function resolveProxy(settings = {}) {
    const mode = settings.proxyMode ?? 'none';
    if (mode === 'apify') {
        return buildApifyProxyUrl({
            password: settings.apifyProxyPassword,
            groups: settings.apifyProxyGroups ?? ['RESIDENTIAL'],
            country: settings.apifyProxyCountry ?? '',
            session: settings.apifyProxySession ?? '',
        });
    }
    if (mode === 'custom') return settings.customProxyUrl || null;
    return null;
}

/** Fetch one Fiverr page with the chosen strategy. Returns { html, source, attempts, error }. */
export async function fetchFiverrPage(url, { settings = {}, log = () => {}, signal, timeout = 30_000 } = {}) {
    const strategy = settings.fetchStrategy ?? 'auto';
    const proxyUrl = resolveProxy(settings);
    const proxy = parseProxy(proxyUrl);
    const attempts = [];
    let fallbackReason = null;

    const tryDirect = async (label) => {
        log(`→ ${label}: ${url.slice(0, 120)}`);
        try {
            const res = await get(url, { headers: BROWSER_HEADERS, proxy, timeout, signal });
            attempts.push({ via: label, status: res.status });
            if (res.status === 200 && res.body.includes('perseus-initial-props')) {
                log(`✓ ${label} 200 · ${(res.body.length / 1024).toFixed(0)} KB HTML`);
                return { html: res.body, source: 'direct', attempts };
            }
            const why = isBlocked(res.body) ? 'PerimeterX challenge' : `HTTP ${res.status}`;
            attempts.push({ via: label, blocked: why });
            log(`⚠ ${label} ${why}${label === 'direct' && !proxy ? ' (no proxy configured — datacenter IP)' : ''}`);
            fallbackReason = why;
        } catch (err) {
            attempts.push({ via: label, error: err.message });
            log(`⚠ ${label} failed: ${err.message}`);
            fallbackReason = err.message;
        }
        return null;
    };

    const tryJina = async () => {
        const via = 'jina';
        log(`→ jina: ${url.slice(0, 120)}`);
        const headers = { 'x-return-format': 'html', 'x-no-cache': 'true', 'x-set-cookie': 'currency=USD' };
        if (settings.jinaApiKey) headers.authorization = `Bearer ${settings.jinaApiKey}`;
        const res = await post(`https://r.jina.ai/${url}`, { headers, timeout: Math.max(timeout, 45_000), signal });
        attempts.push({ via, status: res.status });
        log(`✓ ${via} ${res.status} · ${(res.body.length / 1024).toFixed(0)} KB HTML`);
        if (res.status === 200 && res.body.includes('perseus-initial-props')) return { html: res.body, source: 'jina', attempts };
        log(`⚠ jina did not return usable HTML (HTTP ${res.status})`);
        fallbackReason = `jina HTTP ${res.status}`;
        return null;
    };

    if (strategy !== 'sample' && !settings.offlineOnly) {
        if (strategy === 'jina') {
            try {
                const r = await tryJina();
                if (r) return r;
            } catch (err) { log(`⚠ jina failed: ${err.message}`); fallbackReason = err.message; }
        } else {
            const r = await tryDirect(proxy ? 'proxied' : 'direct');
            if (r) return r;
            if (strategy === 'auto') {
                try {
                    const j = await tryJina();
                    if (j) return j;
                } catch (err) { log(`⚠ jina failed: ${err.message}`); fallbackReason = err.message; }
            }
        }
    }

    // ---- offline replay of the bundled fixture ----
    log(`↺ replaying bundled fixture for this page (source: sample)${fallbackReason ? ` — ${fallbackReason}` : ''}`);
    const html = fixture(url.includes('/search/') || /[?&]query=/.test(url) ? 'search' : 'gig');
    return { html, source: 'sample', attempts, fallbackReason };
}

/**
 * Raw gig objects from the bundled fixture page for a given page number.
 * Page 1 is the fixture exactly as parsed (48 real, 2 promoted gigs, 186,930 total
 * matches reported by Fiverr). Later pages get a deterministic, clearly-flagged
 * variation so pagination is demoable without pretending to be live data.
 */
export function sampleRawGigs({ page = 1 } = {}) {
    const props = extractProps(fixture('search'));
    const gigs = getGigs(props);
    if (page === 1) return gigs;
    return gigs.map((g, i) => {
        const copy = structuredClone(g);
        const shift = ((i * 13 + page * 7) % 21 - 10) / 100;          // ±10 %
        if (copy.price_i) copy.price_i = Math.max(15, Math.round(copy.price_i * (1 + shift)));
        if (copy.packages?.recommended?.price) {
            copy.packages.recommended.price = Math.max(15, Math.round(copy.packages.recommended.price * (1 + shift)));
        }
        if (copy.seller_rating?.score) {
            copy.seller_rating.score = Math.min(5, Math.round((copy.seller_rating.score + ((i * 5 + page) % 9 - 4) / 100) * 100) / 100);
        }
        return copy;
    }).sort((a, b) => (((a.gig_id ?? 0) + page * 977) % 48) - (((b.gig_id ?? 0) + page * 977) % 48));
}

/** Run a full scrape. Yields progress events; returns the final result set. */
export async function runScrape(input, { onEvent = () => {}, signal } = {}) {
    const settings = {
        fetchStrategy: input.fetchStrategy ?? 'auto',
        proxyMode: input.proxyMode ?? 'none',
        customProxyUrl: input.customProxyUrl ?? '',
        apifyProxyPassword: input.apifyProxyPassword ?? '',
        apifyProxyGroups: input.apifyProxyGroups ?? ['RESIDENTIAL'],
        apifyProxyCountry: input.apifyProxyCountry ?? '',
        apifyProxySession: input.apifyProxySession ?? '',
        jinaApiKey: input.jinaApiKey ?? '',
        offlineOnly: Boolean(input.offlineOnly),
    };
    const {
        scrapeMode = 'search', query = 'poster design', searchUrl = '', gigUrls = [],
        startPage = 1, maxPages = 1, sortBy = 'auto', skipPromoted = false, dedupeGigs = false,
        maxItems = 0, delayMs = 600, maxReviews = 5, detailConcurrency = 3,
        includeSellerDetails = true, includePricing = true, includePerformance = true, includeGallery = false,
    } = input;

    const log = (msg) => onEvent({ type: 'log', message: msg });
    const stats = {};
    const started = Date.now();
    const result = { items: [], meta: {}, source: null, attempts: [] };
    const sources = new Set();

    const wantSearch = scrapeMode !== 'details';
    const wantDetails = scrapeMode !== 'search';
    if (wantSearch && !query && !searchUrl) throw new Error('Provide a search query or a search URL.');
    if (scrapeMode === 'details' && !gigUrls.length) throw new Error('scrapeMode=details needs at least one gig URL.');

    const seen = new Set();
    let pushed = 0;
    let totalAvailable = null;
    let pageSize = 48;
    const detailQueue = [];

    const push = (item) => {
        result.items.push(item);
        onEvent({ type: 'item', item });
    };

    log(`🚀 mode=${scrapeMode} · ${searchUrl ? 'searchUrl' : `query "${query}"`} · pages ${startPage}–${startPage + maxPages - 1} · sort=${sortBy}`);

    outer:
    for (let page = startPage; wantSearch && page < startPage + maxPages; page++) {
        if (signal?.aborted) { log('⏹ cancelled'); break; }
        const url = buildUrl({ query, searchUrl: searchUrl || null, page, sortBy });
        onEvent({ type: 'progress', page, pages: maxPages, scraped: pushed, total: totalAvailable });

        let html = null; let source = null;
        if (settings.fetchStrategy === 'sample' || settings.offlineOnly) {
            html = fixture('search'); source = 'sample';
            log(`↺ sample fixture · ${url.slice(0, 120)}`);
        } else {
            const fetched = await fetchFiverrPage(url, { settings, log, signal });
            html = fetched.html; source = fetched.source;
            result.attempts.push(...fetched.attempts);
            if (fetched.fallbackReason && result.source !== 'live') result.fallbackReason = fetched.fallbackReason;
        }
        sources.add(source);
        if (result.source !== 'live') result.source = source;

        const props = extractProps(html);
        if (!props) { log('❌ Could not read page data — stopping.'); break; }
        let gigs = getGigs(props);
        const pag = getPagination(props);
        const { name: currency, rate: currencyRate } = getCurrency(props);
        totalAvailable = pag.total;
        pageSize = pag.pageSize || 48;
        if (source === 'sample') gigs = sampleRawGigs({ page }); // fixture is page 1 only

        if (!gigs?.length) { log('ℹ️ No gigs on this page — stopping.'); break; }

        const items = [];
        let organicPos = (page - 1) * pageSize;
        gigs.forEach((g, i) => {
            const id = g.gig_id ?? g.gigId ?? g.pk_i;
            if (id == null) return;
            const promoted = g.type === 'promoted_gigs';
            if (skipPromoted && promoted) return;
            const key = dedupeGigs ? String(id) : `${page}:${g.u_id ?? `${id}_${i}`}`;
            if (seen.has(key)) return;
            seen.add(key);
            const position = skipPromoted ? ++organicPos : (page - 1) * pageSize + i + 1;
            items.push(flattenGig(g, position, {
                includeSellerDetails, includePricing, includePerformance, includeGallery, currency, currencyRate,
            }));
        });

        const room = maxItems > 0 ? Math.max(0, maxItems - pushed) : items.length;
        const batch = items.slice(0, room);
        batch.forEach((it) => { it.dataset_index = pushed++; it.source = source; });
        if (wantDetails) batch.forEach((it) => detailQueue.push({ url: it.url, listing: it }));
        else batch.forEach(push);

        stats.promoted = gigs.filter((g) => g.type === 'promoted_gigs').length;
        log(`✅ ${batch.length} gigs parsed (total ${pushed}${totalAvailable ? ` · Fiverr reports ${totalAvailable.toLocaleString()} matches` : ''})`);

        if (maxItems > 0 && pushed >= maxItems) { log('🎯 maxItems reached.'); break outer; }
        if (totalAvailable && page * pageSize >= totalAvailable) { log('🏁 Reached the last page.'); break; }
        if (page < startPage + maxPages - 1 && delayMs > 0) await sleep(Math.min(delayMs, 2500));
    }

    // ---------------- gig detail pages ----------------
    if (wantDetails && !signal?.aborted) {
        const seenUrls = new Set(detailQueue.map((d) => d.url));
        for (const u of gigUrls) {
            const clean = String(u).trim().split('?')[0];
            if (/^https?:\/\/(www\.)?fiverr\.com\/[^/]+\/[^/]+/.test(clean) && !seenUrls.has(clean)) {
                seenUrls.add(clean); detailQueue.push({ url: clean, listing: null });
            }
        }
        const limit = maxItems > 0 ? maxItems : Infinity;
        const jobs = detailQueue.slice(0, limit);
        log(`🔎 Opening ${jobs.length} gig page${jobs.length === 1 ? '' : 's'} (concurrency ${detailConcurrency})…`);
        let idx = 0; let done = 0;
        const details = new Array(jobs.length);
        const worker = async () => {
            while (idx < jobs.length) {
                if (signal?.aborted) return;
                const my = idx++;
                const job = jobs[my];
                onEvent({ type: 'progress', scraped: done, detailDone: done, detailTotal: jobs.length });
                try {
                    let html; let source;
                    if (settings.fetchStrategy === 'sample' || settings.offlineOnly) {
                        html = fixture('gig'); source = 'sample';
                    } else {
                        const fetched = await fetchFiverrPage(job.url, { settings, log, signal });
                        html = fetched.html; source = fetched.source;
                        result.attempts.push(...fetched.attempts);
                    }
                    sources.add(source);
                    const props = extractProps(html);
                    const cur = props ? getCurrency(props) : { name: 'USD', rate: 1 };
                    const detail = parseGigDetail(html, { currency: cur.name, currencyRate: cur.rate, maxReviews });
                    if (!detail) throw new Error('gig data not found in page');
                    // Detail wins on shared fields (like the actor), then listing identity/flags are
                    // restored so a merged row keeps its search context — and, offline, so a replayed
                    // fixture never fakes the gig it was matched with.
                    const out = job.listing
                        ? {
                            ...job.listing,
                            ...detail,
                            id: job.listing.id,
                            title: job.listing.title,
                            url: job.listing.url,
                            slug: job.listing.slug,
                            thumbnail: job.listing.thumbnail ?? detail.gallery?.[0]?.thumbnail ?? null,
                            starting_price: job.listing.starting_price ?? detail.price_min,
                            delivery_days: job.listing.delivery_days ?? detail.packages?.[0]?.delivery_days ?? null,
                            position: job.listing.position,
                            is_promoted: job.listing.is_promoted,
                            listing_type: job.listing.listing_type,
                            impression_id: job.listing.impression_id,
                            dataset_index: job.listing.dataset_index,
                            seller: {
                                ...detail.seller,
                                username: job.listing.seller_username ?? detail.seller?.username,
                                display_name: job.listing.seller_displayName ?? detail.seller?.display_name,
                                country: job.listing.seller_country ?? detail.seller?.country,
                                profile_image: job.listing.seller_profileImage ?? detail.seller?.profile_image,
                                level: job.listing.seller_level ?? detail.seller?.level,
                            },
                        }
                        : detail;
                    out.detail_source = source === 'sample' ? 'sample_fixture' : 'gig_page';
                    out.source = source;
                    out.dataset_index = job.listing?.dataset_index ?? done;
                    details[my] = out;
                    onEvent({ type: 'item', item: out });
                    log(`  ✓ ${(out.title ?? job.url).slice(0, 70)}`);
                } catch (err) {
                    log(`  ✗ ${job.url.slice(0, 60)} — ${err.message}`);
                    details[my] = job.listing ? { ...job.listing, detail_error: err.message } : {
                        url: job.url, detail_error: err.message, scraped_at: new Date().toISOString(),
                    };
                }
                done++;
                onEvent({ type: 'progress', detailDone: done, detailTotal: jobs.length, scraped: pushed });
                if (delayMs > 0) await sleep(Math.min(delayMs, 800));
            }
        };
        await Promise.all(Array.from({ length: Math.max(1, detailConcurrency) }, worker));

        // Like the actor: in detail modes the dataset holds one merged record per gig page
        // (listings stream through the console as they are found, but are not final rows).
        result.items = details.filter(Boolean).map((d, i) => ({ ...d, dataset_index: d.dataset_index ?? i }));
        if (wantSearch) log(`🔗 merged listing + gig-page data into ${result.items.length} records`);
        pushed = result.items.length;
        log(`✅ details: ${details.filter(Boolean).length} pages parsed`);
    }

    result.meta = {
        mode: scrapeMode,
        query: searchUrl || query,
        sortBy,
        pagesRequested: wantSearch ? maxPages : 0,
        pageSize,
        gigsSaved: pushed,
        totalAvailableOnFiverr: totalAvailable,
        source: [...sources].join('+') || 'sample',
        durationMs: Date.now() - started,
        finishedAt: new Date().toISOString(),
        runId: crypto.randomUUID().slice(0, 8),
    };
    result.items.forEach((it, i) => { it.dataset_index = it.dataset_index ?? i; });
    onEvent({ type: 'progress', scraped: pushed, total: totalAvailable, done: true });
    log(`🎉 Done. ${pushed} gigs in the dataset.`);
    return result;
}
