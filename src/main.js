import { Actor, log } from 'apify';
import { gotScraping } from 'got-scraping';
import {
    extractProps, getGigs, getPagination, getCurrency, flattenGig, buildUrl, isBlocked,
} from './parser.js';
import { parseGigDetail } from './gigDetail.js';

await Actor.init();

const input = (await Actor.getInput()) ?? {};
const {
    // ---- simple mode (main UI) ----
    niches = ['power bi dashboard'],
    gigsPerNiche = 50,
    fullDetails = true,
    // ---- advanced / optional ----
    gigUrls = [],
    sortBy = 'auto',
    skipPromoted = false,
    dedupeGigs = true,
    maxReviews = 5,
    includeGallery = false,
    detailConcurrency = 3,
    delayMs = 1500,
    proxyConfiguration = { useApifyProxy: true, apifyProxyGroups: ['RESIDENTIAL'] },
    // legacy single-query support
    query,
    searchUrl,
} = input;

const PAGE_SIZE = 48;
const MAX_PAGES_PER_NICHE = 50;

// Build niche list: accepts array, or a newline / comma separated string. Legacy `query` also works.
let nicheList = Array.isArray(niches) ? niches : String(niches ?? '').split(/[\n,]/);
nicheList = nicheList.map((n) => String(n).trim()).filter(Boolean);
if (query && !nicheList.length) nicheList = [String(query).trim()];
nicheList = [...new Set(nicheList)];

const urlList = [...new Set((gigUrls ?? []).map((u) => String(u).trim().split('?')[0])
    .filter((u) => /^https?:\/\/(www\.)?fiverr\.com\/[^/]+\/[^/]+/.test(u)))];

if (!nicheList.length && !urlList.length && !searchUrl) {
    throw new Error('❌ Please enter at least one niche (e.g. "power bi dashboard") or a gig URL.');
}

const proxyConf = await Actor.createProxyConfiguration(proxyConfiguration);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Force USD regardless of proxy country (Fiverr localizes currency by IP)
const HEADERS = {
    cookie: 'currency=USD; u_currency=USD; locale=en-US',
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'accept-language': 'en-US,en;q=0.9',
    'upgrade-insecure-requests': '1',
};

async function fetchPage(url, attempt = 0) {
    const MAX_ATTEMPTS = 5;
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
        if (attempt + 1 >= MAX_ATTEMPTS) throw err;
        const wait = 1500 * (attempt + 1);
        log.warning(`  ⚠️  ${err.message} — retry ${attempt + 1}/${MAX_ATTEMPTS - 1} in ${wait} ms`);
        await sleep(wait);
        return fetchPage(url, attempt + 1);
    }
}

// ---------------------------------------------------------------------------
// 1) SEARCH PHASE — collect `gigsPerNiche` gigs for every niche
// ---------------------------------------------------------------------------
const detailQueue = [];          // { url, listing }
const summary = { niches: {}, gigsCollected: 0, detailsOk: 0, detailsFailed: 0 };
const flatOpts = { includeSellerDetails: true, includePricing: true, includePerformance: true, includeGallery };

const searchTargets = nicheList.map((n) => ({ label: n, query: n, searchUrl: null }));
if (searchUrl) searchTargets.push({ label: searchUrl, query: null, searchUrl });

log.info(`🚀 Fiverr Niche Scraper | ${searchTargets.length} niche(s) × ${gigsPerNiche} gigs | fullDetails=${fullDetails} | urls=${urlList.length}`);

for (const target of searchTargets) {
    const seenIds = new Set();
    let collected = 0;
    let total = null;
    const maxPages = Math.min(MAX_PAGES_PER_NICHE, Math.ceil(gigsPerNiche / (skipPromoted || dedupeGigs ? 38 : PAGE_SIZE)) + 1);
    log.info(`\n🔎 Niche: "${target.label}" — need ${gigsPerNiche} gigs`);

    for (let page = 1; page <= maxPages && collected < gigsPerNiche; page++) {
        const url = buildUrl({ query: target.query, searchUrl: target.searchUrl, page, sortBy });
        let props;
        try {
            props = extractProps(await fetchPage(url));
        } catch (err) {
            log.error(`  ❌ page ${page} failed: ${err.message}`);
            break;
        }
        const gigs = getGigs(props);
        const pag = getPagination(props);
        const { name: currency, rate: currencyRate } = getCurrency(props);
        if (currency !== 'USD') log.warning(`  💱 prices came in ${currency} — converting to USD`);
        total = pag.total;
        if (!gigs.length) break;

        const items = [];
        gigs.forEach((g, i) => {
            if (collected + items.length >= gigsPerNiche) return;
            const id = g.gig_id ?? g.gigId ?? g.pk_i;
            if (id == null) return;
            const promoted = g.type === 'promoted_gigs';
            if (skipPromoted && promoted) return;
            const key = dedupeGigs ? String(id) : `${page}:${g.u_id ?? `${id}_${i}`}`;
            if (seenIds.has(key)) return;
            seenIds.add(key);
            const rec = flattenGig(g, (page - 1) * pag.pageSize + i + 1, { ...flatOpts, currency, currencyRate });
            rec.niche = target.label;
            rec.search_rank = collected + items.length + 1;
            items.push(rec);
        });

        collected += items.length;
        if (fullDetails) items.forEach((it) => detailQueue.push({ url: it.url, listing: it }));
        else if (items.length) await Actor.pushData(items);

        log.info(`  📄 page ${page}: +${items.length} → ${collected}/${gigsPerNiche} (Fiverr has ${pag.total} results)`);
        if (page * pag.pageSize >= pag.total) break;
        if (collected < gigsPerNiche && delayMs > 0) await sleep(delayMs);
    }
    summary.niches[target.label] = { collected, availableOnFiverr: total };
    summary.gigsCollected += collected;
}

// ---------------------------------------------------------------------------
// 2) DETAIL PHASE — open each gig page (fullDetails) + user supplied URLs
// ---------------------------------------------------------------------------
const queuedUrls = new Set(detailQueue.map((d) => d.url));
for (const u of urlList) if (!queuedUrls.has(u)) { queuedUrls.add(u); detailQueue.push({ url: u, listing: null }); }

if (detailQueue.length) {
    log.info(`\n📦 Opening ${detailQueue.length} gig pages (concurrency ${detailConcurrency})…`);
    let idx = 0;
    const worker = async () => {
        while (idx < detailQueue.length) {
            const job = detailQueue[idx++];
            try {
                const html = await fetchPage(job.url);
                const props = extractProps(html);
                const cur = getCurrency(props);
                const detail = parseGigDetail(html, { currency: cur.name, currencyRate: cur.rate, maxReviews });
                if (!detail) throw new Error('gig data not found in page');
                const out = job.listing
                    ? { ...job.listing, ...detail, niche: job.listing.niche, search_rank: job.listing.search_rank, position: job.listing.position, is_promoted: job.listing.is_promoted, listing_type: job.listing.listing_type }
                    : { niche: 'manual_url', ...detail };
                await Actor.pushData(out);
                summary.detailsOk++;
                const done = summary.detailsOk + summary.detailsFailed;
                if (done % 10 === 0 || done === detailQueue.length) log.info(`  ✅ ${done}/${detailQueue.length} gig pages done`);
            } catch (err) {
                summary.detailsFailed++;
                log.warning(`  ❌ ${job.url} — ${err.message}`);
                if (job.listing) await Actor.pushData({ ...job.listing, detail_error: err.message });
            }
            if (delayMs > 0) await sleep(Math.min(delayMs, 1000));
        }
    };
    await Promise.all(Array.from({ length: Math.max(1, detailConcurrency) }, worker));
}

await Actor.setValue('SUMMARY', summary);
log.info(`\n🎉 Done. ${summary.gigsCollected} gigs from ${searchTargets.length} niche(s)` + (fullDetails ? ` | details: ${summary.detailsOk} ok, ${summary.detailsFailed} failed` : ''));
log.info(JSON.stringify(summary.niches));
await Actor.exit();
