import { Actor, log } from 'apify';
import { gotScraping } from 'got-scraping';
import {
    extractProps, getGigs, getPagination, getCurrency, flattenGig, buildUrl, isBlocked,
} from './parser.js';

await Actor.init();

const input = (await Actor.getInput()) ?? {};
const {
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
    maxItems = 0,
    delayMs = 2000,
    proxyConfiguration = { useApifyProxy: true, apifyProxyGroups: ['RESIDENTIAL'] },
} = input;

if (!query && !searchUrl) {
    throw new Error('❌ Provide either "query" or "searchUrl".');
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

const seen = new Set();
let pushed = 0;
let totalAvailable = null;

log.info(`🚀 Fiverr Gig Scraper | query="${searchUrl ?? query}" | pages ${startPage}..${startPage + maxPages - 1} | sort=${sortBy}`);

outer:
for (let page = startPage; page < startPage + maxPages; page++) {
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
        if (id == null || seen.has(id)) return;
        const promoted = g.type === 'promoted_gigs';
        if (skipPromoted && promoted) return;
        seen.add(id);
        const position = skipPromoted ? ++organicPos : (page - 1) * pag.pageSize + i + 1;
        items.push(flattenGig(g, position, {
            includeSellerDetails, includePricing, includePerformance, includeGallery, currency, currencyRate,
        }));
    });

    const room = maxItems > 0 ? Math.max(0, maxItems - pushed) : items.length;
    const batch = items.slice(0, room);
    if (batch.length) {
        await Actor.pushData(batch);
        pushed += batch.length;
    }
    log.info(`  ✅ ${batch.length} gigs saved (total so far ${pushed}, Fiverr reports ${pag.total} matches)`);

    if (maxItems > 0 && pushed >= maxItems) { log.info('🎯 maxItems reached.'); break outer; }
    if (page * pag.pageSize >= pag.total) { log.info('🏁 Reached last page.'); break; }
    if (page < startPage + maxPages - 1 && delayMs > 0) await sleep(delayMs);
}

await Actor.setValue('SUMMARY', {
    query: searchUrl ?? query, sortBy, pagesRequested: maxPages, gigsSaved: pushed, totalAvailableOnFiverr: totalAvailable,
});
log.info(`🎉 Done. ${pushed} gigs in dataset.`);
await Actor.exit();
