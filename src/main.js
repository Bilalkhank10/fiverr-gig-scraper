import { Actor, log } from 'apify';
import { gotScraping } from 'got-scraping';
import {
    extractProps, getGigs, getPagination, getCurrency, flattenGig, buildUrl, isBlocked,
} from './parser.js';
import { parseGigDetail } from './gigDetail.js';

await Actor.init();

const input = (await Actor.getInput()) ?? {};
const {
    scrapeMode = 'search',
    gigUrls = [],
    maxReviews = 5,
    detailConcurrency = 3,
    query = 'poster design',
    searchUrl = null,
    startPage = 1,
    maxPages = 1,
    sortBy = 'auto',
    includeSellerDetails = true,
    includePricing = true,
    includePerformance = true,
    includeGallery = false,
    skipPromoted = false,
    dedupeGigs = false,
    maxItems = 0,
    delayMs = 2000,
    fetchVia = 'auto',
    jinaApiKey = '',
    proxyConfiguration = { useApifyProxy: true, apifyProxyGroups: ['RESIDENTIAL'] },
} = input;

const wantSearch = scrapeMode !== 'details';
const wantDetails = scrapeMode !== 'search';
if (wantSearch && !query && !searchUrl) throw new Error('❌ Provide "query" or "searchUrl" (or use scrapeMode=details with gigUrls).');
if (scrapeMode === 'details' && !gigUrls?.length) throw new Error('❌ scrapeMode=details needs at least one URL in "gigUrls".');

const proxyConf = await Actor.createProxyConfiguration(proxyConfiguration);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Force USD regardless of proxy country (Fiverr localizes currency by IP)
const HEADERS = {
    cookie: 'currency=USD; u_currency=USD; locale=en-US',
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'accept-language': 'en-US,en;q=0.9',
    'upgrade-insecure-requests': '1',
};

// Fetch through Jina AI Reader (r.jina.ai) — their servers fetch the page, bypassing IP-based blocks.
async function fetchViaJina(url, attempt = 0) {
    const headers = { 'X-Return-Format': 'html', 'X-No-Cache': 'true', 'X-Set-Cookie': 'currency=USD' };
    if (jinaApiKey) headers.Authorization = `Bearer ${jinaApiKey}`;
    const res = await gotScraping({ url: `https://r.jina.ai/${url}`, headers, timeout: { request: 90_000 }, retry: { limit: 0 }, throwHttpErrors: false });
    if (res.statusCode === 200 && res.body.includes('perseus-initial-props')) return res.body;
    if (attempt < 2) { await sleep(2000 * (attempt + 1)); return fetchViaJina(url, attempt + 1); }
    throw new Error(`Jina HTTP ${res.statusCode}`);
}

async function fetchPage(url, attempt = 0) {
    if (fetchVia === 'jina') return fetchViaJina(url);
    const MAX_ATTEMPTS = fetchVia === 'auto' ? 3 : 5;
    const sessionId = `s${Math.random().toString(36).slice(2, 10)}`; // new IP each try
    const proxyUrl = proxyConf ? await proxyConf.newUrl(sessionId) : undefined;
    try {
        const res = await gotScraping({
            url,
            proxyUrl,
            headers: HEADERS,
            headerGeneratorOptions: {
                browsers: [{ name: 'chrome', minVersion: 120 }],
                devices: ['desktop'],
                operatingSystems: ['windows', 'macos'],
                locales: ['en-US'],
            },
            timeout: { request: 45_000 },
            retry: { limit: 0 },
            throwHttpErrors: false,
        });
        const html = res.body;
        if (res.statusCode === 200 && html.includes('perseus-initial-props')) return html;
        const why = isBlocked(html) ? 'PerimeterX block' : `HTTP ${res.statusCode}`;
        throw new Error(why);
    } catch (err) {
        if (attempt + 1 >= MAX_ATTEMPTS) {
            if (fetchVia === 'auto') { log.info(`  🔁 direct blocked (${err.message}) → falling back to Jina Reader`); return fetchViaJina(url); }
            throw err;
        }
        const wait = 1500 * (attempt + 1);
        log.warning(`  ⚠️  ${err.message} — retry ${attempt + 1}/${MAX_ATTEMPTS - 1} in ${wait} ms`);
        await sleep(wait);
        return fetchPage(url, attempt + 1);
    }
}

const seen = new Set();
let pushed = 0;
let totalAvailable = null;
const detailQueue = [];

log.info(`🚀 Fiverr Gig Scraper | mode=${scrapeMode} | query="${searchUrl ?? query}" | pages ${startPage}..${startPage + maxPages - 1} | sort=${sortBy}`);

outer:
for (let page = startPage; wantSearch && page < startPage + maxPages; page++) {
    const url = buildUrl({ query, searchUrl, page, sortBy });
    log.info(`📄 Page ${page} → ${url}`);

    let props;
    try {
        props = extractProps(await fetchPage(url));
    } catch (err) {
        log.error(`❌ Page ${page} failed: ${err.message}`);
        break;
    }

    const gigs = getGigs(props);
    const pag = getPagination(props);
    const { name: currency, rate: currencyRate } = getCurrency(props);
    if (currency !== 'USD') log.warning(`  💱 Fiverr returned prices in ${currency} (rate ${currencyRate}) — converting to USD`);
    totalAvailable = pag.total;

    if (!gigs.length) {
        log.info('ℹ️  No gigs on this page — stopping.');
        break;
    }

    const items = [];
    let organicPos = (page - 1) * pag.pageSize;
    gigs.forEach((g, i) => {
        const id = g.gig_id ?? g.gigId ?? g.pk_i;
        if (id == null) return;
        const promoted = g.type === 'promoted_gigs';
        if (skipPromoted && promoted) return;
        // Fiverr shows the same gig twice on a page (ad slot + organic slot). Like the
        // original actor we keep every slot (48/page) unless dedupeGigs is enabled.
        const key = dedupeGigs ? String(id) : `${page}:${g.u_id ?? `${id}_${i}`}`;
        if (seen.has(key)) return;
        seen.add(key);
        const position = skipPromoted ? ++organicPos : (page - 1) * pag.pageSize + i + 1;
        items.push(flattenGig(g, position, {
            includeSellerDetails, includePricing, includePerformance, includeGallery, currency, currencyRate,
        }));
    });

    const room = maxItems > 0 ? Math.max(0, maxItems - pushed) : items.length;
    const batch = items.slice(0, room);
    if (batch.length) {
        if (wantDetails) {
            batch.forEach((it) => detailQueue.push({ url: it.url, listing: it }));
        } else {
            await Actor.pushData(batch);
        }
        pushed += batch.length;
    }
    log.info(`  ✅ ${batch.length} gigs saved (total so far ${pushed}, Fiverr reports ${pag.total} matches)`);

    if (maxItems > 0 && pushed >= maxItems) { log.info('🎯 maxItems reached.'); break outer; }
    if (page * pag.pageSize >= pag.total) { log.info('🏁 Reached last page.'); break; }
    if (page < startPage + maxPages - 1 && delayMs > 0) await sleep(delayMs);
}

// ---------------- Gig detail pages ----------------
if (wantDetails) {
    const seenUrls = new Set(detailQueue.map((d) => d.url));
    for (const u of gigUrls ?? []) {
        const clean = String(u).trim().split('?')[0];
        if (/^https?:\/\/(www\.)?fiverr\.com\/[^/]+\/[^/]+/.test(clean) && !seenUrls.has(clean)) {
            seenUrls.add(clean); detailQueue.push({ url: clean, listing: null });
        }
    }
    const limit = maxItems > 0 ? maxItems : Infinity;
    const jobs = detailQueue.slice(0, limit);
    log.info(`🔎 Opening ${jobs.length} gig pages (concurrency ${detailConcurrency})…`);
    let done = 0; let failed = 0; let idx = 0;
    const worker = async () => {
        while (idx < jobs.length) {
            const job = jobs[idx++];
            try {
                const html = await fetchPage(job.url);
                const props = extractProps(html);
                const cur = getCurrency(props);
                const detail = parseGigDetail(html, { currency: cur.name, currencyRate: cur.rate, maxReviews });
                if (!detail) throw new Error('gig data not found in page');
                const out = job.listing
                    ? { ...job.listing, ...detail, position: job.listing.position, is_promoted: job.listing.is_promoted, listing_type: job.listing.listing_type, impression_id: job.listing.impression_id }
                    : detail;
                await Actor.pushData(out);
                done++;
                if (done % 10 === 0) log.info(`  📦 ${done}/${jobs.length} gig pages done`);
            } catch (err) {
                failed++;
                log.warning(`  ❌ ${job.url} — ${err.message}`);
                if (job.listing) await Actor.pushData({ ...job.listing, detail_error: err.message });
            }
            if (delayMs > 0) await sleep(Math.min(delayMs, 1000));
        }
    };
    await Promise.all(Array.from({ length: Math.max(1, detailConcurrency) }, worker));
    pushed = done + failed;
    log.info(`  ✅ details: ${done} ok, ${failed} failed`);
}

await Actor.setValue('SUMMARY', {
    mode: scrapeMode, query: searchUrl ?? query, sortBy, pagesRequested: maxPages, gigsSaved: pushed, totalAvailableOnFiverr: totalAvailable,
});
log.info(`🎉 Done. ${pushed} gigs in dataset.`);
await Actor.exit();
