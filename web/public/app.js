/**
 * Fiverr Gig Studio — single-page console.
 * Plain ES modules: hash router · live SSE run streaming · dataset explorer.
 */
import {
    h, frag, clear, icon, num, compact, money, duration, timeAgo, truncate, flag, levelInfo, stars,
    toast, copy, openDrawer, markdown, prettyJson, spotlight,
} from './ui.js';
import { barChart, sparkline, ring, donut } from './charts.js';

/* ================================ state ================================== */
const state = {
    actor: null,
    inputSchema: null,
    runs: [],
    connectivity: null,
    datasetRunId: null,
    dataset: null,          // { items, meta, stats, input }
    resultsView: localStorage.getItem('view.mode') ?? 'cards',
    filter: '',
    quickFilters: new Set(),
    sort: { key: 'position', dir: 'asc' },
    limit: 24,
};

const DEFAULT_INPUT = {
    scrapeMode: 'search',
    query: 'logo design',
    searchUrl: '',
    gigUrls: [],
    startPage: 1,
    maxPages: 2,
    sortBy: 'auto',
    includeSellerDetails: true,
    includePricing: true,
    includePerformance: true,
    includeGallery: false,
    skipPromoted: false,
    dedupeGigs: false,
    maxItems: 0,
    delayMs: 600,
    maxReviews: 5,
    detailConcurrency: 3,
    fetchStrategy: 'auto',
    proxyMode: 'none',
    customProxyUrl: '',
    apifyProxyPassword: '',
    apifyProxyGroups: ['RESIDENTIAL'],
    apifyProxyCountry: '',
    jinaApiKey: '',
    offlineOnly: false,
};

const composer = { ...DEFAULT_INPUT, ...JSON.parse(localStorage.getItem('composer') ?? '{}') };
const saveComposer = () => localStorage.setItem('composer', JSON.stringify(composer));

const RECIPES = [
    { icon: 'tag', label: 'Logo design market scan', patch: { query: 'logo design', maxPages: 2 } },
    { icon: 'image', label: 'Poster design, organic only', patch: { query: 'poster design', maxPages: 3, skipPromoted: true, dedupeGigs: true } },
    { icon: 'message', label: 'Voice over — best rated', patch: { query: 'voice over', sortBy: 'rating', maxPages: 2 } },
    { icon: 'bolt', label: 'Deep dive: 1 page + gig pages', patch: { scrapeMode: 'search_details', query: 'wordpress speed optimization', maxPages: 1, maxReviews: 5 } },
    { icon: 'star', label: 'Cheapest first, 4 pages', patch: { query: 'data entry', sortBy: 'price_asc', maxPages: 4, maxItems: 150 } },
    { icon: 'shield', label: 'Seller landscape (full data)', patch: { scrapeMode: 'search_details', query: 'shopify developer', dedupeGigs: true, includeGallery: true } },
];

/* ================================= api =================================== */
const api = {
    async req(path, opts = {}) {
        const res = await fetch(path, { headers: { 'content-type': 'application/json' }, ...opts });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
        return res.json();
    },
    state: () => api.req('/api/state'),
    runs: () => api.req('/api/runs'),
    run: (id) => api.req(`/api/runs/${id}`),
    docs: () => api.req('/api/docs'),
    connectivity: () => api.req('/api/connectivity'),
    createRun: (input) => api.req('/api/runs', { method: 'POST', body: JSON.stringify({ input }) }),
    cancel: (id) => api.req(`/api/runs/${id}/cancel`, { method: 'POST' }),
    remove: (id) => api.req(`/api/runs/${id}`, { method: 'DELETE' }),
};

/* =============================== helpers ================================= */
const VIEWS = {
    overview: 'Overview',
    new: 'New run',
    jobs: 'Jobs',
    job: 'Run console',
    results: 'Dataset',
    api: 'API & deploy',
    about: 'Readme',
};

const STATUS = {
    running: { label: 'Running', cls: 'blue' },
    succeeded: { label: 'Completed', cls: 'green' },
    failed: { label: 'Failed', cls: 'red' },
    cancelled: { label: 'Cancelled', cls: 'gray' },
    interrupted: { label: 'Interrupted', cls: 'gold' },
};
const statusBadge = (s) => h('span', { class: `badge ${STATUS[s]?.cls ?? 'gray'}` }, h('span', { class: 'dot-i', style: { background: 'currentColor' } }), STATUS[s]?.label ?? s);

const SOURCE_INFO = {
    direct: { label: 'Live · direct', cls: 'green' },
    jina: { label: 'Live · Jina reader', cls: 'green' },
    sample: { label: 'Offline sample', cls: 'gold' },
};
const sourceBadge = (src) => {
    const key = String(src ?? 'sample').split('+').pop();
    const info = SOURCE_INFO[key] ?? { label: key, cls: 'gray' };
    return h('span', { class: `badge ${info.cls}`, title: 'sample = bundled fixture pages parsed by the real scraper code' }, icon('shield'), info.label);
};

const avatarFor = (item, cls = '') => {
    const wrap = h('div', { class: `avatar ${cls}`.trim() });
    const initials = (item.seller_displayName ?? item.seller_username ?? '?').trim().slice(0, 2).toUpperCase();
    wrap.append(initials);
    const url = item.seller_profileImage ?? item.seller?.profile_image;
    if (url) {
        const img = h('img', {
            src: url, alt: '', loading: 'lazy',
            onerror: (e) => { e.target.remove(); },
        });
        wrap.append(img);
    }
    return wrap;
};

function gigMedia(item, { tall = false } = {}) {
    const media = h('div', { class: 'gig-media', style: tall ? { aspectRatio: '16/9' } : null });
    const url = item.thumbnail ?? item.gallery?.[0]?.thumbnail ?? item.gallery?.[0]?.url;
    const fallback = h('div', { class: 'fallback' }, icon('image', 'lg'));
    media.append(fallback);
    if (url) {
        const reveal = (el) => { el.style.opacity = '1'; fallback.style.display = 'none'; };
        const img = h('img', {
            src: url, alt: truncate(item.title, 70), loading: 'lazy',
            onload: (e) => reveal(e.target),
            onerror: (e) => { e.target.remove(); },
        });
        img.style.opacity = '0';
        img.style.transition = 'opacity .6s';
        media.append(img);
        if (img.complete && img.naturalWidth) requestAnimationFrame(() => reveal(img));
    }
    media.append(h('div', { class: 'ove' }));
    return media;
}

function gigBadges(item) {
    const wrap = h('div', { class: 'top-badges' });
    if (item.is_promoted) wrap.append(h('span', { class: 'badge red', title: `Promoted listing (${item.listing_type ?? 'ad'})` }, 'AD'));
    if (item.isFiverrChoice) wrap.append(h('span', { class: 'badge green' }, icon('star'), "Fiverr's Choice"));
    else if (item.isFeatured) wrap.append(h('span', { class: 'badge gold' }, 'Featured'));
    if (item.seller_isPro || item.is_pro) wrap.append(h('span', { class: 'badge violet' }, 'Pro'));
    if (item.seller_isOnline) wrap.append(h('span', { class: 'badge gray' }, 'Online'));
    return wrap;
}

function gigCard(item, { index, compactMode = false } = {}) {
    const level = levelInfo(item.seller_level);
    const card = h('article', { class: 'gig', dataset: { id: item.id }, onclick: () => showGig(item) });
    const media = gigMedia(item);
    media.append(gigBadges(item), h('span', { class: 'pos' }, `#${item.position ?? index + 1}`));

    const rating = Number(item.seller_rating_score ?? item.rating ?? 0);
    const reviews = item.seller_rating_count ?? item.rating_count ?? item.buying_review_count ?? 0;
    const price = item.starting_price ?? item.price_min ?? null;
    const delivery = item.delivery_days;
    const packages = item.total_packages ?? item.packages?.length ?? 0;

    card.append(media, h('div', { class: 'gig-body' },
        h('a', { class: 'gig-title', href: item.url ?? '#', target: '_blank', rel: 'noopener', onclick: (e) => e.stopPropagation() },
            item.title ?? 'Untitled gig'),
        h('div', { class: 'gig-seller' },
            avatarFor(item),
            h('div', { class: 'who' },
                h('b', { class: 'truncate' }, item.seller_displayName ?? item.seller_username ?? 'Unknown seller'),
                h('span', { class: 'truncate' }, `${flag(item.seller_country ?? item.seller?.country)} ${item.seller_country ?? '—'} · ${level.label}${delivery ? ` · ${delivery}d` : ''}`))),
        compactMode ? null : h('div', { class: 'gig-stats' },
            h('div', { class: 'stat grow' },
                h('b', { class: 'row', style: { gap: '7px' } }, rating ? stars(rating) : null, rating ? rating.toFixed(2) : 'no rating'),
                h('span', {}, reviews ? `${compact(reviews)} reviews · pos #${item.position ?? index + 1}` : 'unrated seller')),
            h('div', { class: 'price' },
                h('b', {}, money(price)),
                h('span', {}, packages ? `from · ${packages} packages` : 'starting at'))),
    ));
    return card;
}

function statTile({ label, value, unit, sub, iconName, accent = false }) {
    return h('div', { class: `kpi ${accent ? 'accent' : ''}` },
        h('div', { class: 'k-top' }, iconName ? icon(iconName, 'sm') : null, label),
        h('div', { class: 'k-val' }, value, unit ? h('small', {}, unit) : null),
        sub ? h('div', { class: 'k-sub' }, sub) : null);
}

function emptyState({ iconName = 'grid', title, body, action }) {
    return h('div', { class: 'empty' },
        h('div', { class: 'orb' }, icon(iconName, 'lg')),
        h('h3', {}, title),
        h('p', {}, body),
        action ?? null);
}

function field(label, control, hint) {
    return h('div', { class: 'field' }, h('label', {}, label), control, hint ? h('span', { class: 'hint' }, hint) : null);
}

function toggle(label, key, onchange) {
    const btn = h('button', {
        class: `switch ${composer[key] ? 'on' : ''}`, type: 'button',
        onclick: () => {
            composer[key] = !composer[key];
            btn.classList.toggle('on', composer[key]);
            saveComposer();
            onchange?.();
        },
    }, h('span', { class: 'track' }), label);
    return btn;
}

/* ================================ router ================================= */
const view = () => document.getElementById('view');

/**
 * Async views are guarded by a render token: every navigation bumps it, so a slow render
 * can never keep writing into a view the user already left (that used to leave a duplicated
 * run console — and two competing SSE streams — behind on fast navigation).
 */
let renderToken = 0;
/**
 * Per-invocation guard. The token is captured by value, so if a newer navigation (or a second
 * render of the same hash) happened while this render was awaiting data, the guard goes stale
 * and the render stops touching the DOM — no duplicated consoles, no orphaned SSE streams.
 */
const viewGuard = (el, token) => () => Boolean(el) && document.getElementById('view') === el && token === renderToken;

function route() {
    const hash = location.hash.replace(/^#\/?/, '') || 'overview';
    const [name, param] = hash.split('/');
    const key = name === 'jobs' && param ? 'job' : name;
    if (key !== 'job' && activeStream) { activeStream.close(); activeStream = null; }
    document.querySelectorAll('.nav-item').forEach((a) => a.classList.toggle('active', a.dataset.route === (key === 'job' ? 'jobs' : key)));
    document.getElementById('crumbTitle').textContent = VIEWS[key] ?? 'Overview';
    const el = clear(view());
    const token = ++renderToken;
    el.dataset.token = String(token);
    el.classList.remove('entering');
    void el.offsetWidth;
    el.classList.add('entering');
    window.scrollTo({ top: 0, behavior: 'instant' });
    const render = { overview: renderOverview, new: renderNewRun, jobs: renderJobs, job: renderJobConsole, results: renderResults, api: renderApi, about: renderAbout }[key] ?? renderOverview;
    render(el, param, token);
}

window.addEventListener('hashchange', route);

/* =============================== overview ================================ */
async function renderOverview(root, _param, token) {
    const current = viewGuard(root, token);
    root.append(h('div', { class: 'page-head' },
        h('div', {},
            h('div', { class: 'eyebrow' }, 'Fiverr gig intelligence'),
            h('h1', {}, 'Every Fiverr search page, turned into clean data.'),
            h('p', { class: 'sub' }, 'Search any keyword the way a buyer would, then work with gigs, sellers, pricing, ratings and ad placement as a tidy dataset — or open the full gig page for packages, FAQs and reviews.') ),
        h('div', { class: 'spacer' }),
        h('button', { class: 'primary lg', onclick: () => { location.hash = '#/new'; } }, icon('bolt'), 'Start a run'),
    ));

    const banner = h('div', { id: 'overviewBanner' });
    const kpis = h('div', { class: 'kpis', id: 'overviewKpis' });
    const recent = h('div', { class: 'card pad', id: 'recentRuns' });
    const insights = h('div', { class: 'grid c2', id: 'overviewInsights' });
    const pipeline = h('div', { class: 'grid c4', id: 'pipeline' });

    root.append(banner, h('div', { class: 'section' }, kpis), h('div', { class: 'grid c2', style: { alignItems: 'start' } }, recent, h('div', { class: 'stack' }, insights)), pipeline);
    pipeline.append(...[
        { n: '01', t: 'Configure', d: 'Keyword, filters, pages, proxy and how deep to dig into each gig.', i: 'spark' },
        { n: '02', t: 'Fetch', d: 'Plain HTTP with retries and rotation — through your IP, an Apify proxy or the Jina reader.', i: 'globe' },
        { n: '03', t: 'Parse', d: 'The actor’s own parser extracts every field from the embedded perseus JSON.', i: 'layers' },
        { n: '04', t: 'Ship it', d: 'Browse, filter, and export to JSON, CSV, XLSX or Markdown in one click.', i: 'download' },
    ].map((s) => h('div', { class: 'card pad hover', style: { display: 'flex', flexDirection: 'column', gap: '10px' } },
        h('div', { class: 'row' }, h('span', { class: 'badge gray mono' }, s.n), icon(s.i)),
        h('h3', { style: { fontSize: '15px' } }, s.t),
        h('p', { class: 'tiny muted', style: { lineHeight: '1.6' } }, s.d))));

    // connectivity
    refreshConnectivity(banner);

    try {
        state.runs = (await api.runs()).runs;
        if (!current()) return;
        document.getElementById('jobCount').textContent = state.runs.length;
        const totalGigs = state.runs.reduce((a, r) => a + (r.gigs ?? 0), 0);
        const latest = state.runs.find((r) => r.gigs > 0);
        let latestStats = null;
        if (latest) latestStats = (await api.run(latest.id)).stats;
        if (!current()) return;

        kpis.append(
            statTile({ label: 'Gigs scraped', value: compact(totalGigs), iconName: 'layers', sub: `${state.runs.length} run${state.runs.length === 1 ? '' : 's'} recorded`, accent: true }),
            statTile({ label: 'Avg starting price', value: latestStats?.avgPrice != null ? money(latestStats.avgPrice) : '—', iconName: 'tag', sub: latestStats ? `median ${money(latestStats.medianPrice)} · max ${money(latestStats.maxPrice, { compact: true })}` : 'run a scrape to populate' }),
            statTile({ label: 'Sellers seen', value: latestStats ? compact(latestStats.uniqueSellers) : '—', iconName: 'user', sub: latestStats ? `${latestStats.online} online now · ${latestStats.pro} pro` : '—' }),
            statTile({ label: 'Avg rating', value: latestStats?.avgRating != null ? latestStats.avgRating.toFixed(2) : '—', iconName: 'star', sub: latestStats ? `${compact(latestStats.totalReviews)} reviews counted` : '—' }),
        );

        // recent runs list
        clear(recent);
        recent.append(h('div', { class: 'card-title' }, icon('clock'), 'Recent runs'),
            state.runs.length ? h('div', { class: 'stack', style: { marginTop: '14px', gap: '6px' } }, ...state.runs.slice(0, 6).map((r) => h('div', {
                class: 'row', style: { padding: '10px 12px', borderRadius: '12px', background: 'var(--surface)', border: '1px solid var(--line)', cursor: 'pointer' },
                onclick: () => { location.hash = `#/jobs/${r.id}`; },
            },
                statusBadge(r.status),
                h('div', { style: { display: 'flex', flexDirection: 'column', minWidth: 0 } },
                    h('b', { class: 'truncate sm-text' }, r.query || '(no query)'),
                    h('span', { class: 'tiny faint' }, `${r.mode.replace('_', ' + ')} · ${timeAgo(r.startedAt)}`)),
                h('span', { class: 'spacer' }),
                h('b', { class: 'mono sm-text' }, num(r.gigs)),
                h('span', { class: 'tiny faint' }, 'gigs'))))
                : h('div', { class: 'stack', style: { marginTop: '14px' } },
                    emptyState({
                        iconName: 'layers', title: 'No runs yet',
                        body: 'Compose one in the New run screen, or fire the bundled sample straight away — it parses the fixture pages with the actor’s own parser, so you can see the whole pipeline immediately.',
                        action: h('div', { class: 'row wrap center' },
                            h('button', { class: 'primary', onclick: () => { location.hash = '#/new'; } }, icon('bolt'), 'Compose a run'),
                            h('button', { class: 'soft', onclick: () => startSampleRun() }, icon('play'), 'Run the sample dataset')),
                    })));

        // insights from latest dataset
        clear(insights);
        if (latestStats) {
            insights.append(
                h('div', { class: 'card pad' }, h('div', { class: 'card-title' }, icon('tag'), 'Price distribution'),
                    h('div', { style: { marginTop: '16px' } }, barChart(latestStats.priceBuckets.map((b) => ({ label: b.label, value: b.count })), { format: (v) => `${v} gigs` }))),
                h('div', { class: 'card pad' }, h('div', { class: 'card-title' }, icon('globe'), 'Top seller countries'),
                    h('div', { class: 'bars', style: { marginTop: '16px' } }, ...latestStats.countries.slice(0, 6).map(([cc, count]) => {
                        const max = latestStats.countries[0][1];
                        return h('div', { class: 'bar-row' },
                            h('span', {}, `${flag(cc)} ${cc}`),
                            h('div', { class: 'bar-track' }, h('div', { class: 'bar-fill', style: { width: `${(count / max) * 100}%` } })),
                            h('b', { class: 'right num' }, count));
                    }))),
            );
        } else {
            insights.append(h('div', { class: 'card pad' }, h('div', { class: 'card-title' }, icon('tag'), 'Price distribution'), emptyState({ iconName: 'tag', title: 'Nothing to chart yet', body: 'Scrape a page of gigs and the price, country and level breakdowns show up here.' })));
        }
    } catch (err) {
        toast(`Could not load state: ${err.message}`, 'err');
    }
    spotlight(root);
}

async function refreshConnectivity(bannerEl) {
    try {
        const conn = await api.connectivity();
        state.connectivity = conn;
        const dot = document.getElementById('connDot');
        const fiverrOk = conn.fiverr.ok;
        const jinaOk = conn.jina.ok;
        dot.className = `dot ${fiverrOk || jinaOk ? 'ok' : 'bad'}`;
        document.getElementById('connLabel').textContent = fiverrOk ? 'Fiverr reachable' : jinaOk ? 'Jina reachable' : 'Offline sandbox';
        document.getElementById('connSub').textContent = fiverrOk ? 'live scraping ready' : jinaOk ? 'jina fallback ready' : 'runs replay bundled sample';

        if (!bannerEl) return;
        clear(bannerEl);
        if (fiverrOk) {
            bannerEl.append(h('div', { class: 'banner ok' }, icon('check'),
                h('div', {}, h('b', {}, 'Live mode available. '), `fiverr.com answered in ${conn.fiverr.ms} ms — runs will hit Fiverr for real. Residential proxies still help against PerimeterX.`)));
        } else {
            bannerEl.append(h('div', { class: 'banner warn' }, icon('shield'),
                h('div', {},
                    h('b', {}, `This sandbox cannot reach fiverr.com (${conn.fiverr.error ?? 'blocked'}). `),
                    'Runs still work: the studio replays the bundled fixture pages through the exact same parser, so you get a genuine dataset to explore. ',
                    h('br'),
                    'For live data, open ', h('a', { href: '#/new', style: { color: 'var(--accent)' } }, 'New run → Advanced'), ' and add an Apify residential proxy, or point the fetch method at the Jina reader.')));
        }
    } catch (err) {
        document.getElementById('connLabel').textContent = 'Probe failed';
    }
}

/* ================================ new run ================================ */
function renderNewRun(root) {
    const left = h('div', { class: 'stack', style: { gap: '18px' } });
    const right = h('div', { class: 'stack', style: { position: 'sticky', top: '84px', gap: '14px' } });
    root.append(h('div', { class: 'page-head' },
        h('div', {},
            h('div', { class: 'eyebrow' }, 'Compose'),
            h('h1', {}, 'New scrape run'),
            h('p', { class: 'sub' }, 'Pick what to search, how deep to go and how to reach Fiverr. The estimate on the right is recalculated as you type.'))),
        h('div', { class: 'composer' }, left, right));

    /* --- mode --- */
    const MODES = [
        { id: 'search', icon: 'bolt', tag: 'fast', title: 'Search listing only', desc: '48 gigs per page in a single request. Price, seller, rating, ad flags.' },
        { id: 'search_details', icon: 'layers', tag: 'full', title: 'Search + gig pages', desc: 'Everything above, then every gig page for packages, FAQ, reviews and seller bio.' },
        { id: 'details', icon: 'external', tag: 'targeted', title: 'Gig URLs only', desc: 'Skip search — paste gig links and scrape those pages in full detail.' },
    ];
    const modeCards = h('div', { class: 'mode-cards' });
    MODES.forEach((m) => {
        const card = h('button', { class: `mode-card ${composer.scrapeMode === m.id ? 'active' : ''}`, type: 'button' },
            h('span', { class: 'tag' }, m.tag),
            h('span', { class: 'mc-top' }, icon(m.icon), m.title),
            h('p', {}, m.desc));
        card.onclick = () => {
            composer.scrapeMode = m.id;
            saveComposer();
            route(); // mode changes the visible fields (gig URLs, reviews, estimate)
        };
        modeCards.append(card);
    });

    /* --- query --- */
    const queryInput = h('input', {
        type: 'text', value: composer.query, placeholder: 'e.g. logo design, voice over, shopify developer',
        oninput: (e) => { composer.query = e.target.value; saveComposer(); syncComposer(); },
        onkeydown: (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) startRun(); },
    });
    const searchUrlInput = h('input', {
        type: 'text', value: composer.searchUrl, placeholder: 'https://www.fiverr.com/search/gigs?query=logo&ref=seller_level:top_rated_seller',
        oninput: (e) => { composer.searchUrl = e.target.value; saveComposer(); syncComposer(); },
    });
    const gigUrlsArea = h('textarea', {
        rows: 4, value: (composer.gigUrls ?? []).join('\n'), placeholder: 'https://www.fiverr.com/seller/gig-slug\nhttps://www.fiverr.com/another/seller-gig',
        oninput: (e) => { composer.gigUrls = e.target.value.split('\n').map((s) => s.trim()).filter(Boolean); saveComposer(); syncComposer(); },
    });
    const gigUrlsField = field('Gig URLs (one per line)', gigUrlsArea, 'Used by “Gig URLs only” mode — also appended in the other modes.');

    const queryCard = h('div', { class: 'card pad stack' },
        h('div', { class: 'card-title' }, icon('search'), 'What to search'),
        h('div', { class: 'search-box big' }, icon('search'), queryInput),
        h('div', { class: 'row wrap' }, h('span', { class: 'tiny faint' }, 'Recipes:'),
            ...RECIPES.map((r) => h('button', { class: 'chip click', onclick: () => { Object.assign(composer, r.patch); saveComposer(); route(); toast(`Recipe applied · ${r.label}`); } }, r.label))),
        h('div', { class: 'hr' }),
        fieldStack([field('Search / category URL (optional)', searchUrlInput, 'Overrides the query — paste a Fiverr search or category URL with filters applied.'), composer.scrapeMode === 'details' ? gigUrlsField : null]));

    /* --- controls --- */
    const pagesInput = h('input', { type: 'number', min: 1, max: 50, value: composer.maxPages, oninput: (e) => { composer.maxPages = clamp(+e.target.value || 1, 1, 50); saveComposer(); syncComposer(); } });
    const startPageInput = h('input', { type: 'number', min: 1, value: composer.startPage, oninput: (e) => { composer.startPage = Math.max(1, +e.target.value || 1); saveComposer(); } });
    const maxItemsInput = h('input', { type: 'number', min: 0, value: composer.maxItems, oninput: (e) => { composer.maxItems = Math.max(0, +e.target.value || 0); saveComposer(); syncComposer(); } });
    const sortSelect = h('select', { onchange: (e) => { composer.sortBy = e.target.value; saveComposer(); syncComposer(); } },
        ...[['auto', 'Recommended'], ['rating', 'Best selling / rating'], ['new', 'Newest arrivals'], ['price_asc', 'Price: low → high'], ['price_desc', 'Price: high → low']]
            .map(([v, l]) => h('option', { value: v, selected: composer.sortBy === v }, l)));
    const reviewsInput = h('input', { type: 'number', min: 0, max: 20, value: composer.maxReviews, oninput: (e) => { composer.maxReviews = clamp(+e.target.value || 0, 0, 20); saveComposer(); } });
    const pageSizeNote = h('span', { class: 'hint' });

    const controlsCard = h('div', { class: 'card pad stack' },
        h('div', { class: 'card-title' }, icon('spark'), 'Scope'),
        h('div', { class: 'grid c3' },
            field('Pages to scrape', pagesInput, '48 gigs per page'),
            field('Start page', startPageInput, 'Pick up where the last run stopped'),
            field('Sort order', sortSelect)),
        h('div', { class: 'grid c3' },
            field('Max results', maxItemsInput, '0 = no limit (cost control)'),
            field('Reviews per gig', reviewsInput, 'Details modes only, max 20'),
            h('div', { class: 'field' }, h('label', {}, 'Live scope'), pageSizeNote)),
        h('div', { class: 'hr' }),
        h('div', { class: 'card-title' }, icon('check'), 'Field groups'),
        h('div', { class: 'opts' },
            toggle('Seller details', 'includeSellerDetails'),
            toggle('Pricing', 'includePricing'),
            toggle('Performance metrics', 'includePerformance'),
            toggle('Gallery images', 'includeGallery'),
            toggle('Skip promoted (ads)', 'skipPromoted'),
            toggle('Deduplicate gigs', 'dedupeGigs')));

    /* --- advanced --- */
    const strategySelect = h('select', { onchange: (e) => { composer.fetchStrategy = e.target.value; saveComposer(); syncComposer(); } },
        ...[['auto', 'Auto — direct, then Jina reader'], ['direct', 'Direct / proxy only'], ['jina', 'Jina AI reader only'], ['sample', 'Offline sample (bundled fixture)']]
            .map(([v, l]) => h('option', { value: v, selected: composer.fetchStrategy === v }, l)));
    const proxyModeSelect = h('select', { onchange: (e) => { composer.proxyMode = e.target.value; saveComposer(); syncComposer(); } },
        ...[['none', 'No proxy (your IP)'], ['apify', 'Apify proxy'], ['custom', 'Custom proxy URL']]
            .map(([v, l]) => h('option', { value: v, selected: composer.proxyMode === v }, l)));
    const customProxyInput = h('input', { type: 'text', value: composer.customProxyUrl, placeholder: 'http://user:pass@proxy.host:8000', oninput: (e) => { composer.customProxyUrl = e.target.value; saveComposer(); } });
    const apifyPasswordInput = h('input', { type: 'password', value: composer.apifyProxyPassword, placeholder: 'Apify proxy password (never stored on the server)', oninput: (e) => { composer.apifyProxyPassword = e.target.value; saveComposer(); syncComposer(); } });
    const apifyCountryInput = h('input', { type: 'text', value: composer.apifyProxyCountry, placeholder: 'US', oninput: (e) => { composer.apifyProxyCountry = e.target.value.toUpperCase(); saveComposer(); } });
    const jinaKeyInput = h('input', { type: 'password', value: composer.jinaApiKey, placeholder: 'optional jina.ai key', oninput: (e) => { composer.jinaApiKey = e.target.value; saveComposer(); } });
    const concurrencyInput = h('input', { type: 'number', min: 1, max: 10, value: composer.detailConcurrency, oninput: (e) => { composer.detailConcurrency = clamp(+e.target.value || 1, 1, 10); saveComposer(); } });
    const delayInput = h('input', { type: 'number', min: 0, value: composer.delayMs, oninput: (e) => { composer.delayMs = Math.max(0, +e.target.value || 0); saveComposer(); syncComposer(); } });

    const apifyPanel = h('div', { class: 'grid c2', style: composer.proxyMode === 'apify' ? null : { display: 'none' } },
        field('Apify proxy password', apifyPasswordInput, 'Kept in this browser only, used for the run, and redacted before anything is stored or served.'),
        field('Proxy country', apifyCountryInput, 'Optional two-letter country code'));
    const customPanel = h('div', { style: composer.proxyMode === 'custom' ? null : { display: 'none' } },
        field('Proxy URL', customProxyInput, 'http or https proxies, basic auth supported. Credentials are redacted server-side.'));
    proxyModeSelect.addEventListener('change', () => {
        apifyPanel.style.display = composer.proxyMode === 'apify' ? null : 'none';
        customPanel.style.display = composer.proxyMode === 'custom' ? null : 'none';
        syncComposer();
    });

    const advanced = h('details', { class: 'adv' },
        h('summary', {}, icon('shield'), 'Network, proxies & performance', icon('chevron', 'chev')),
        h('div', { class: 'adv-body stack' },
            h('div', { class: 'grid c2' },
                field('Fetch method', strategySelect, 'Fiverr sits behind PerimeterX: residential proxies are the reliable path. Jina needs no proxy at all.'),
                field('Proxy', proxyModeSelect, 'Apify RESIDENTIAL is the recommended default.')),
            apifyPanel, customPanel,
            h('div', { class: 'grid c3' },
                field('Jina API key', jinaKeyInput, 'Raises the reader rate limit.'),
                field('Detail concurrency', concurrencyInput, 'Parallel gig-page requests.'),
                field('Delay between pages (ms)', delayInput, 'Be polite, stay unblocked.')),
            h('div', { class: 'opts' },
                toggle('Force offline replay', 'offlineOnly', syncComposer))));

    left.append(queryCard, modeCards, controlsCard, advanced);

    /* --- start panel --- */
    function syncComposer() {
        const est = estimate(composer);
        pageSizeNote.textContent = `${est.items} gigs · ${est.requests} request${est.requests === 1 ? '' : 's'}`;
        clear(right);
        right.append(h('div', { class: 'card pad stack', style: { borderColor: 'var(--accent-line)', boxShadow: 'var(--glow)' } },
            h('div', { class: 'row' }, h('div', { class: 'card-title' }, icon('bolt'), 'Run estimate'), h('span', { class: 'spacer' }), sourceBadge(est.source)),
            h('div', { class: 'kpis', style: { gridTemplateColumns: '1fr 1fr' } },
                statTile({ label: 'Gigs', value: est.items, accent: true }),
                statTile({ label: 'HTTP requests', value: est.requests })),
            h('div', { class: 'stack', style: { gap: '8px', fontSize: '12.5px' } },
                estRow('Estimated time', duration(est.ms)),
                estRow('Apify compute + events', `≈ $${est.apifyCost.toFixed(3)}`),
                estRow('Proxy traffic (residential)', est.proxyGb ? `≈ $${est.proxyCost.toFixed(2)} · ${est.proxyGb.toFixed(2)} GB` : '—'),
                estRow('Mode', { search: 'Listing only', search_details: 'Listing + gig pages', details: 'Gig pages only' }[composer.scrapeMode]),
                estRow('Output fields', est.fields)),
            h('button', { class: 'primary lg', style: { width: '100%' }, onclick: startRun }, icon('play'), 'Start scrape'),
            h('span', { class: 'hint', style: { textAlign: 'center' } }, '⌘/Ctrl + Enter starts the run too'),
            h('div', { class: 'hr' }),
            h('div', { class: 'tiny faint', style: { lineHeight: '1.6' } },
                'Runs stream live into the console: logs on the left, gigs appearing as they are parsed. Nothing is written to Fiverr — the actor only reads public search pages.')));

        // live JSON preview
        right.append(h('div', { class: 'card pad stack' },
            h('div', { class: 'row' }, h('div', { class: 'card-title' }, icon('terminal'), 'Input payload'), h('span', { class: 'spacer' }),
                h('button', { class: 'ghost sm', onclick: () => copy(JSON.stringify(buildInput(composer), null, 2), 'Input JSON copied') }, icon('copy', 'sm'), 'Copy')),
            h('pre', { class: 'code', style: { maxHeight: '280px' }, html: prettyJson(buildInput(composer)) })));
    }
    syncComposer();
}

const estRow = (label, value) => h('div', { class: 'row' }, h('span', { class: 'muted' }, label), h('span', { class: 'spacer' }),
    h('b', { class: 'mono sm-text nowrap' }, value));

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const fieldStack = (arr) => h('div', { class: 'stack', style: { gap: '14px' } }, ...arr.filter(Boolean));

function estimate(c) {
    const isSearch = c.scrapeMode !== 'details';
    const wantDetails = c.scrapeMode !== 'search';
    let items = isSearch ? c.maxPages * 48 : (c.gigUrls?.length ?? 0);
    if (c.maxItems > 0) items = Math.min(items, c.maxItems);
    const requests = (isSearch ? c.maxPages : 0) + (wantDetails ? items : 0);
    const ms = isSearch
        ? c.maxPages * (1400 + c.delayMs) + (wantDetails ? Math.ceil(items / Math.max(1, c.detailConcurrency)) * (1200 + Math.min(c.delayMs, 800)) : 0)
        : Math.ceil(items / Math.max(1, c.detailConcurrency)) * (1200 + Math.min(c.delayMs, 800));
    const offline = c.fetchStrategy === 'sample' || c.offlineOnly;
    const apifyCost = items ? 0.003 + items * 0.005 : 0;
    // ≈2.4 MB per search page, ≈0.9 MB per gig page (gig pages only exist in detail modes)
    const detailPages = wantDetails ? items : 0;
    const proxyGb = offline ? 0 : (isSearch ? c.maxPages * 2.4 : 0) + detailPages * 0.9;
    const proxyCost = proxyGb * 0.008; // ≈ $8/GB residential
    const msFinal = offline ? items * 12 + 40 : ms;
    const fields = c.scrapeMode === 'search' ? '26 listing fields'
        : c.scrapeMode === 'search_details' ? 'listing + 80 detail fields'
            : '80 detail fields';
    const source = c.fetchStrategy === 'sample' || c.offlineOnly ? 'offline sample' : c.fetchStrategy;
    return { items, requests, ms: msFinal, apifyCost, proxyGb, proxyCost, fields, source };
}

function buildInput(c) {
    return {
        scrapeMode: c.scrapeMode,
        gigUrls: c.gigUrls ?? [],
        query: c.query,
        searchUrl: c.searchUrl || null,
        startPage: c.startPage,
        maxPages: c.maxPages,
        sortBy: c.sortBy,
        maxReviews: c.maxReviews,
        detailConcurrency: c.detailConcurrency,
        includeSellerDetails: c.includeSellerDetails,
        includePricing: c.includePricing,
        includePerformance: c.includePerformance,
        includeGallery: c.includeGallery,
        skipPromoted: c.skipPromoted,
        dedupeGigs: c.dedupeGigs,
        maxItems: c.maxItems,
        delayMs: c.delayMs,
        fetchStrategy: c.fetchStrategy,
        offlineOnly: c.offlineOnly,
        proxyMode: c.proxyMode,
        customProxyUrl: c.proxyMode === 'custom' ? c.customProxyUrl : '',
        apifyProxyPassword: c.proxyMode === 'apify' ? c.apifyProxyPassword : '',
        apifyProxyGroups: c.apifyProxyGroups,
        apifyProxyCountry: c.proxyMode === 'apify' ? c.apifyProxyCountry : '',
        jinaApiKey: c.jinaApiKey,
    };
}

/** One-click run over the bundled fixtures (no network) — used from the empty state. */
async function startSampleRun() {
    try {
        const { id } = await api.createRun({
            ...DEFAULT_INPUT, query: 'logo design', maxPages: 1, fetchStrategy: 'sample', offlineOnly: true,
        });
        toast('Sample run started');
        state.runs = (await api.runs()).runs;
        document.getElementById('jobCount').textContent = state.runs.length;
        location.hash = `#/jobs/${id}`;
    } catch (err) {
        toast(`Could not start the sample run: ${err.message}`, 'err');
    }
}

async function startRun() {
    if (composer.scrapeMode === 'details' && !(composer.gigUrls ?? []).length) {
        toast('Add at least one gig URL for the “Gig URLs only” mode', 'err');
        return;
    }
    if (composer.scrapeMode !== 'details' && !composer.query && !composer.searchUrl) {
        toast('Enter a search query or a search URL', 'err');
        return;
    }
    try {
        const { id } = await api.createRun(buildInput(composer));
        toast('Run started — streaming results');
        state.runs = (await api.runs()).runs;
        document.getElementById('jobCount').textContent = state.runs.length;
        location.hash = `#/jobs/${id}`;
    } catch (err) {
        toast(`Could not start run: ${err.message}`, 'err');
    }
}

/* ================================= jobs ================================== */
async function renderJobs(root, _param, token) {
    const current = viewGuard(root, token);
    root.append(h('div', { class: 'page-head' },
        h('div', {},
            h('div', { class: 'eyebrow' }, 'History'),
            h('h1', {}, 'Jobs'),
            h('p', { class: 'sub' }, 'Every run the studio has executed, newest first. Click a job to reopen its console, logs and dataset.')),
        h('span', { class: 'spacer' }),
        h('button', { class: 'ghost', onclick: () => { route(); } }, icon('clock'), 'Refresh'),
        h('button', { class: 'primary', onclick: () => { location.hash = '#/new'; } }, icon('bolt'), 'New run')));

    const list = h('div', { class: 'stack' });
    root.append(list);

    try {
        state.runs = (await api.runs()).runs;
        if (!current()) return;
        document.getElementById('jobCount').textContent = state.runs.length;
        if (!state.runs.length) {
            list.append(emptyState({ iconName: 'layers', title: 'No jobs yet', body: 'Start a scrape and it will show up here with live logs and its dataset.', action: h('button', { class: 'primary', onclick: () => { location.hash = '#/new'; } }, icon('bolt'), 'Create the first run') }));
            return;
        }
        const counts = state.runs.slice().reverse().map((r) => r.gigs ?? 0);
        const sparkCard = h('div', { class: 'card pad' }, h('div', { class: 'card-title' }, icon('spark'), 'Gig volume per run'),
            h('div', { style: { marginTop: '10px' } }, sparkline(counts)));
        list.append(sparkCard);

        for (const r of state.runs) {
            const card = h('div', { class: 'card pad hover', style: { cursor: 'pointer' }, onclick: () => { location.hash = `#/jobs/${r.id}`; } },
                h('div', { class: 'row wrap' },
                    statusBadge(r.status),
                    h('b', { style: { fontSize: '14.5px' } }, r.query || '(no query)'),
                    r.source ? sourceBadge(r.source) : null,
                    h('span', { class: 'spacer' }),
                    h('span', { class: 'tiny faint mono' }, r.id.slice(0, 8)),
                    h('span', { class: 'tiny faint' }, timeAgo(r.startedAt))),
                h('div', { class: 'row wrap', style: { marginTop: '12px', gap: '18px' } },
                    miniStat('Gigs', num(r.gigs)),
                    miniStat('Mode', r.mode.replace('_', ' + ')),
                    miniStat('Duration', duration(r.durationMs)),
                    h('span', { class: 'spacer' }),
                    h('button', { class: 'ghost sm', onclick: (e) => { e.stopPropagation(); location.hash = `#/results/${r.id}`; } }, icon('grid', 'sm'), 'Dataset'),
                    h('a', { class: 'ghost sm', href: `/api/runs/${r.id}/export?format=csv`, onclick: (e) => e.stopPropagation() }, icon('download', 'sm'), 'CSV'),
                    h('button', { class: 'danger-btn sm', onclick: async (e) => { e.stopPropagation(); await api.remove(r.id); toast('Run deleted'); route(); } }, icon('x', 'sm'), 'Delete')));
            list.append(card);
        }
    } catch (err) {
        toast(`Could not load jobs: ${err.message}`, 'err');
    }
}

const miniStat = (label, value) => h('div', { style: { display: 'flex', flexDirection: 'column', gap: '2px' } },
    h('span', { class: 'tiny faint' }, label), h('b', { class: 'sm-text' }, value));

/* ============================== run console ============================== */
let activeStream = null;

async function renderJobConsole(root, id, token) {
    const current = viewGuard(root, token);
    if (activeStream) { activeStream.close(); activeStream = null; }
    root.append(h('div', { class: 'row', style: { marginBottom: '18px' } }, h('span', { class: 'skeleton', style: { width: '260px', height: '30px' } })));

    let run;
    try {
        run = await api.run(id);
        if (!current()) return;
    } catch {
        if (!current()) return;
        clear(root).append(emptyState({ iconName: 'layers', title: 'Run not found', body: 'It may have been deleted or trimmed from history.', action: h('button', { class: 'soft', onclick: () => { location.hash = '#/jobs'; } }, 'Back to jobs') }));
        return;
    }
    const items = run.items ?? [];
    const stats = run.stats;
    const source = run.meta?.source ?? items[0]?.source;

    /* header */
    const statusEl = h('span', {}, statusBadge(run.status));
    const cancelling = { on: false };
    const cancelBtn = h('button', { class: 'danger-btn', onclick: async () => { cancelling.on = true; await api.cancel(id); toast('Cancelling…'); } }, icon('stop', 'sm'), 'Cancel');
    const head = h('div', { class: 'page-head' },
        h('div', { style: { minWidth: 0 } },
            h('div', { class: 'eyebrow' }, 'Run console'),
            h('h1', { style: { fontSize: '26px' } }, run.input?.searchUrl || run.input?.query || run.input?.gigUrls?.[0] || 'Run'),
            h('div', { class: 'row wrap', style: { marginTop: '10px' } },
                statusEl, sourceBadge(source),
                h('span', { class: 'chip mono' }, run.id.slice(0, 8)),
                h('span', { class: 'chip' }, (run.input?.scrapeMode ?? 'search').replace('_', ' + ')),
                run.input?.sortBy && run.input.sortBy !== 'auto' ? h('span', { class: 'chip' }, `sorted: ${run.input.sortBy}`) : null,
                run.input?.skipPromoted ? h('span', { class: 'chip' }, 'ads skipped') : null,
                h('span', { class: 'chip' }, timeAgo(run.startedAt)))),
        h('span', { class: 'spacer' }),
        h('button', { class: 'ghost', onclick: () => copy(`/api/runs/${id}/dataset`, 'Dataset endpoint copied') }, icon('copy'), 'Endpoint'),
        h('a', { class: 'ghost', href: `/api/runs/${id}/export?format=json` }, icon('download'), 'JSON'),
        h('a', { class: 'ghost', href: `/api/runs/${id}/export?format=csv` }, icon('download'), 'CSV'),
        run.status === 'running' ? cancelBtn : null,
        h('button', { class: 'primary', onclick: () => { location.hash = `#/results/${id}`; } }, icon('grid'), 'Open dataset'));

    const kpiRow = h('div', { class: 'kpis' });
    const ringHost = h('div', { class: 'row', style: { gap: '26px', alignItems: 'center' } });
    const consoleEl = h('div', { class: 'console' });
    const progressLine = h('span', { class: 'tiny faint' });
    const streamHost = h('div', { class: 'stack' });
    const insightHost = h('div', { class: 'grid c2' });

    const sampleNote = source === 'sample' ? h('div', { class: 'banner warn', style: { marginTop: '16px' } }, icon('shield'),
        h('div', {},
            h('b', {}, 'Offline sample data. '),
            'fiverr.com could not be reached from this environment, so every page was replayed from the bundled fixture in ',
            h('code', { class: 'mono tiny' }, 'test/sample_search_page.html'),
            ' and parsed by the real scraper code — positions, prices, sellers, ratings and ad flags all come from that genuine parse. Pagination beyond page 1 and gig-page details are deterministic replays of the same fixture, so switch to a proxy (or the Jina reader) in ',
            h('a', { href: '#/new', style: { color: 'var(--accent)' } }, 'New run → Advanced'), ' for live data.')) : null;

    root.append(head, ...(sampleNote ? [sampleNote] : []), kpiRow,
        h('div', { class: 'grid c2', style: { marginTop: '18px', alignItems: 'stretch' } },
            h('div', { class: 'card pad stack' }, h('div', { class: 'row' }, h('div', { class: 'card-title' }, icon('spark'), 'Progress'), h('span', { class: 'spacer' }), progressLine), ringHost),
            h('div', { class: 'card pad stack' }, h('div', { class: 'card-title' }, icon('terminal'), 'Live log'), consoleEl)),
        h('div', { style: { marginTop: '18px' } }, streamHost),
        h('div', { style: { marginTop: '18px' } }, insightHost));
    spotlight(root);

    /* live counters */
    let liveItems = [...items];
    let liveStats = stats;
    const ringEl = ring(run.status === 'succeeded' ? 100 : 0, { label: 'pages' });
    const progress = { pages: 0, pagesTotal: run.input?.maxPages ?? 1, detailDone: 0, detailTotal: 0, mode: run.input?.scrapeMode };
    const progressText = () => (progress.mode === 'details'
        ? `${progress.detailDone}/${progress.detailTotal || '?'} gig pages`
        : `${progress.pages}/${progress.pagesTotal} pages`);

    function paintKpis() {
        clear(kpiRow).append(
            statTile({ label: 'Gigs in dataset', value: compact(liveItems.length), iconName: 'layers', accent: true, sub: liveStats?.totalAvailableOnFiverr ? `${num(liveItems.length)} of ${num(liveStats.totalAvailableOnFiverr)} matches on Fiverr` : null }),
            statTile({ label: 'Avg price', value: liveStats?.avgPrice != null ? money(liveStats.avgPrice) : '—', iconName: 'tag', sub: liveStats ? `min ${money(liveStats.minPrice)} · max ${money(liveStats.maxPrice, { compact: true })}` : null }),
            statTile({ label: 'Avg rating', value: liveStats?.avgRating != null ? liveStats.avgRating.toFixed(2) : '—', iconName: 'star', sub: liveStats ? `${compact(liveStats.totalReviews)} reviews · ${liveStats.fiverrChoice} top choice` : null }),
            statTile({ label: 'Elapsed', value: duration((run.finishedAt ?? Date.now()) - run.startedAt), iconName: 'clock', sub: run.status === 'running' ? 'running…' : STATUS[run.status]?.label }));
    }
    paintKpis();
    ringHost.append(ringEl, h('div', { class: 'ring-legend', style: { flex: 1 } },
        legendRow('var(--accent)', 'Gigs parsed', 'gigs'),
        legendRow('#7c5cff', 'Promoted ads', 'ads'),
        legendRow('#57b6ff', 'Sellers online', 'online'),
        legendRow('#f7c948', "Fiverr's choice", 'choice')));

    /* ---------------------- results stream (animated) ---------------------- */
    const STREAM_MAX = 12;
    const streamGrid = h('div', { class: 'stream-grid' });
    const streamCount = h('b', { class: 'stream-count num' }, '0');
    const streamLive = h('span', { class: 'live-chip' }, h('span', { class: 'live-dot' }), 'live');
    const streamBar = h('div', { class: 'stream-bar' }, h('span'));
    let lastCount = -1;

    const streamHead = h('div', { class: 'row wrap stream-head' },
        h('div', { class: 'card-title' }, icon('grid'), 'Results stream'),
        streamLive,
        h('span', { class: 'stream-tally' }, streamCount, h('span', { class: 'tiny faint' }, 'gigs in dataset')),
        h('span', { class: 'spacer' }),
        h('button', { class: 'ghost sm', onclick: () => { location.hash = `#/results/${id}`; } }, icon('table', 'sm'), 'Explore all'));

    /** Pop the counter whenever the number of streamed gigs changes. */
    function paintCount({ animate = true } = {}) {
        if (liveItems.length === lastCount) return;
        lastCount = liveItems.length;
        streamCount.textContent = num(liveItems.length);
        if (animate && renderCount) {
            streamCount.classList.remove('pop');
            void streamCount.offsetWidth;
            streamCount.classList.add('pop');
        }
    }
    const renderCount = true;

    /** Live chrome: pulsing dot, sweep bar and accent glow while gigs are still arriving. */
    let runFinished = run.status !== 'running';
    function setStreaming(on) {
        const live = Boolean(on) && !runFinished;
        streamLive.classList.toggle('off', !live);
        streamGrid.classList.toggle('busy', live);
        streamBar.classList.toggle('hidden', !live);
    }

    function paintStream({ animate = false } = {}) {
        clear(streamHost);
        if (!liveItems.length) {
            streamHost.append(h('div', { class: 'card pad' },
                h('div', { class: 'card-title' }, icon('grid'), 'Results stream'),
                emptyState({ iconName: 'grid', title: 'Waiting for the first gigs…', body: 'Parsed gigs appear here the moment they land in the dataset.' })));
            return;
        }
        const shown = liveItems.slice(-STREAM_MAX).reverse();
        setStreaming(!runFinished);
        paintCount({ animate: false });
        clear(streamGrid);
        shown.forEach((it, i) => {
            const card = streamCard(it, liveItems.length - i - 1);
            if (animate) { card.style.animationDelay = `${i * 45}ms`; }
            streamGrid.append(card);
        });
        streamHost.append(streamHead, streamBar, streamGrid);
        spotlight(streamGrid);
    }

    /** One streamed gig card, wrapped with the entry animation classes. */
    function streamCard(item, index, { fresh = false } = {}) {
        const card = gigCard(item, { index, compactMode: true });
        card.classList.add('stream-card');
        if (fresh) card.classList.add('fresh');
        return card;
    }

    /** FLIP: let existing cards glide to their new grid slots instead of jumping. */
    function flipReorder(mutate) {
        const kids = [...streamGrid.children];
        const before = new Map(kids.map((el) => [el, el.getBoundingClientRect()]));
        mutate();
        for (const el of kids) {
            if (!el.isConnected) continue;
            const a = before.get(el);
            const b = el.getBoundingClientRect();
            const dx = a.left - b.left;
            const dy = a.top - b.top;
            if (!dx && !dy) continue;
            el.style.transition = 'none';
            el.style.transform = `translate(${dx}px, ${dy}px)`;
            void el.offsetWidth;
            requestAnimationFrame(() => {
                el.classList.add('flip');
                el.style.transition = '';
                el.style.transform = '';
                setTimeout(() => el.classList.remove('flip'), 520);
            });
        }
    }

    function renderStreamItem(item) {
        if (!streamGrid.isConnected) { paintStream({ animate: true }); return; }
        flipReorder(() => {
            streamGrid.prepend(streamCard(item, liveItems.length - 1, { fresh: true }));
            const extras = [...streamGrid.children].slice(STREAM_MAX);
            extras.forEach((el) => {
                el.classList.add('leaving');
                setTimeout(() => el.remove(), 340);
            });
        });
        paintCount();
        spotlight(streamGrid);
    }

    function paintInsights() {
        clear(insightHost);
        if (!liveStats || !liveItems.length) return;
        const palette = ['#19c37d', '#7c5cff', '#57b6ff', '#f7c948'];
        const legend = h('div', { class: 'ring-legend', style: { flex: 1 } });
        liveStats.levels.forEach(([label, value], i) => {
            legend.append(h('div', { class: 'l' },
                h('span', { class: 'dot-i', style: { background: palette[i % palette.length] } }),
                h('span', {}, levelInfo(label).label),
                h('b', {}, value)));
        });
        const donutCard = h('div', { class: 'card pad' },
            h('div', { class: 'card-title' }, icon('user'), 'Seller levels'),
            h('div', { class: 'row', style: { marginTop: '8px', gap: '22px' } },
                donut(liveStats.levels.map(([label, value], i) => ({ label, value, color: palette[i % palette.length] })), { centerLabel: 'sellers' }),
                legend));
        const priceCard = h('div', { class: 'card pad' },
            h('div', { class: 'card-title' }, icon('tag'), 'Price buckets'),
            h('div', { style: { marginTop: '14px' } },
                barChart(liveStats.priceBuckets.map((b) => ({ label: b.label, value: b.count })), { format: (v) => `${v} gigs` })));
        insightHost.append(priceCard, donutCard);
    }

    paintStream({ animate: true });
    paintInsights();
    if (run.status === 'running') setStreaming(true);

    const time = (ts) => new Date(ts).toLocaleTimeString('en-US', { hour12: false });
    function logLine(msg, at) {
        const cls = /^❌|blocked|failed|✗/i.test(msg) ? 'err'
            : /^⚠|⏹|interrupted|cancel/i.test(msg) ? 'warn'
                : /^✓|^✅|^🎉|^↺/i.test(msg) ? 'ok'
                    : /^🚀|^🔎|^ℹ️/i.test(msg) ? 'sys' : '';
        const line = h('div', { class: `line ${cls}` }, h('span', { class: 't' }, time(at ?? Date.now())), h('span', {}, msg));
        consoleEl.append(line);
        consoleEl.scrollTop = consoleEl.scrollHeight;
    }
    (run.events ?? []).forEach((ev) => { if (ev.type === 'log') logLine(ev.message, ev.at); });
    if (!(run.events ?? []).length) logLine('· reconnecting to run stream…');

    const pending = [];
    let draining = false;
    function drain() {
        if (draining) return;
        draining = true;
        const step = () => {
            // once the run ends the dataset becomes the source of truth: drop whatever is
            // still queued so the counter and the cards stay consistent with the API
            if (runFinished) { pending.length = 0; draining = false; return; }
            const next = pending.shift();
            if (!next) { draining = false; return; }
            liveItems.push(next);
            renderStreamItem(next);
            setTimeout(step, 45);
        };
        step();
    }
    function refreshCounters() {
        paintKpis();
        paintCount();
        ringHost.querySelectorAll('.ring-legend .l').forEach((row) => {
            const k = row.dataset.k;
            row.querySelector('b').textContent = {
                gigs: num(liveItems.length),
                ads: num(liveItems.filter((i) => i.is_promoted).length),
                online: num(liveItems.filter((i) => i.seller_isOnline).length),
                choice: num(liveItems.filter((i) => i.isFiverrChoice).length),
            }[k];
        });
    }

    if (run.status === 'running') {
        const es = new EventSource(`/api/runs/${id}/stream`);
        activeStream = es;
        es.onmessage = (e) => {
            const ev = JSON.parse(e.data);
            if (ev.type === 'log') logLine(ev.message, ev.at);
            if (ev.type === 'progress') {
                if (ev.page) { progress.pages = ev.page - 1 + (ev.done ? 1 : 0); progress.pagesTotal = ev.pages ?? progress.pagesTotal; }
                if (ev.detailTotal) { progress.detailDone = ev.detailDone; progress.detailTotal = ev.detailTotal; progress.mode = 'details'; }
                const pct = progress.mode === 'details'
                    ? (progress.detailTotal ? (progress.detailDone / progress.detailTotal) * 100 : 5)
                    : (progress.pagesTotal ? (progress.pages / progress.pagesTotal) * 100 : 5);
                ringEl.update(run.status === 'running' ? Math.min(96, pct) : pct);
                ringEl.spin(true);
                progressLine.textContent = progressText();
                refreshCounters();
            }
            if (ev.type === 'item') { if (runFinished) return; pending.push(ev.item); drain(); refreshCounters(); }
            if (ev.type === 'end') {
                es.close();
                activeStream = null;
                ringEl.spin(false);
                ringEl.update(100);
                progressLine.textContent = 'finished';
                finish(ev.status, ev.error);
            }
        };
        es.onerror = () => { /* server closes streams cleanly at the end */ };
    } else {
        ringEl.update(100);
        ringEl.spin(false);
        progressLine.textContent = `${STATUS[run.status]?.label ?? run.status} · ${duration((run.finishedAt ?? run.startedAt) - run.startedAt)}`;
    }

    async function finish(status, error) {
        runFinished = true;
        pending.length = 0;
        clear(statusEl).append(statusBadge(status));
        cancelBtn.remove();
        if (error) logLine(`❌ ${error}`);
        const fresh = await api.run(id).catch(() => null);
        if (!current()) { activeStream?.close?.(); activeStream = null; return; }
        if (fresh) {
            liveItems = fresh.items ?? liveItems;
            liveStats = fresh.stats ?? liveStats;
            state.runs = (await api.runs()).runs;
            document.getElementById('jobCount').textContent = state.runs.length;
        }
        clear(kpiRow);
        paintKpis();
        setStreaming(false);
        refreshCounters();
        paintStream({ animate: true });
        paintInsights();
        progressLine.textContent = `${STATUS[status]?.label ?? status} · ${duration((fresh?.finishedAt ?? Date.now()) - run.startedAt)}`;
        toast(status === 'succeeded' ? `Run finished — ${num(liveItems.length)} gigs` : `Run ${status}`, status === 'succeeded' ? 'ok' : 'err');
    }
    requestAnimationFrame(() => { consoleEl.scrollTop = consoleEl.scrollHeight; });
}

const legendRow = (color, label, key) => h('div', { class: 'l', dataset: { k: key } },
    h('span', { class: 'dot-i', style: { background: color } }), h('span', {}, label), h('b', {}, '—'));

/* ================================ dataset ================================ */
async function renderResults(root, runId, token) {
    const current = viewGuard(root, token);
    const header = h('div', { class: 'page-head' },
        h('div', {},
            h('div', { class: 'eyebrow' }, 'Dataset explorer'),
            h('h1', {}, 'Gigs dataset'),
            h('p', { class: 'sub' }, 'Search, sort, filter and export everything this studio has scraped. Click any gig for the full record.')));
    const toolbar = h('div', { class: 'card pad row wrap', style: { gap: '10px' } });
    const kpis = h('div', { class: 'kpis' });
    const summary = h('div', { class: 'grid c2', style: { marginTop: '16px' } });
    const noteHost = h('div', { style: { marginTop: '16px' } });
    const quickHost = h('div', { style: { marginTop: '16px' } });
    const body = h('div', { style: { marginTop: '18px' } });
    root.append(header, h('div', { class: 'stack', style: { marginBottom: '16px' } }, toolbar), kpis, summary, noteHost, quickHost, body);

    try {
        state.runs = (await api.runs()).runs;
        if (!current()) return;
        document.getElementById('jobCount').textContent = state.runs.length;
        const withItems = state.runs.filter((r) => r.gigs > 0);
        state.datasetRunId = runId ?? state.datasetRunId ?? withItems[0]?.id ?? state.runs[0]?.id;

        if (!state.datasetRunId) {
            clear(body).append(emptyState({ iconName: 'grid', title: 'No dataset yet', body: 'Datasets are created by runs. Start a scrape and the explorer fills up instantly.', action: h('button', { class: 'primary', onclick: () => { location.hash = '#/new'; } }, icon('bolt'), 'Start a run') }));
            return;
        }

        const runSelect = h('select', { style: { maxWidth: '420px' }, onchange: (e) => { state.datasetRunId = e.target.value; state.limit = 24; route(); } },
            ...state.runs.map((r) => h('option', { value: r.id, selected: r.id === state.datasetRunId }, `${timeAgo(r.startedAt)} · ${truncate(r.query, 34)} · ${r.gigs} gigs · ${r.status}`)));
        const searchInput = h('input', {
            type: 'text', value: state.filter, placeholder: 'Filter by title, seller, country, tag…', style: { maxWidth: '320px' },
            oninput: (e) => { state.filter = e.target.value; state.limit = 24; renderBody(); },
        });
        const viewToggle = h('div', { class: 'seg' },
            h('button', { class: state.resultsView === 'cards' ? 'active' : '', onclick: () => { state.resultsView = 'cards'; localStorage.setItem('view.mode', 'cards'); route(); } }, icon('grid', 'sm'), 'Cards'),
            h('button', { class: state.resultsView === 'table' ? 'active' : '', onclick: () => { state.resultsView = 'table'; localStorage.setItem('view.mode', 'table'); route(); } }, icon('table', 'sm'), 'Table'));

        const run = await api.run(state.datasetRunId);
        if (!current()) return;
        state.dataset = run;
        const items = run.items ?? [];
        const counter = document.getElementById('datasetCount');
        if (counter) counter.textContent = compact(items.length);
        const stats = run.stats;

        clear(toolbar).append(
            runSelect,
            h('div', { class: 'search-box', style: { flex: '1 1 240px', maxWidth: '340px' } }, icon('search'), searchInput),
            viewToggle,
            h('span', { class: 'spacer' }),
            ...[['csv', 'CSV'], ['xlsx', 'XLSX'], ['json', 'JSON'], ['md', 'MD'], ['ndjson', 'NDJSON']].map(([fmt, label]) =>
                h('a', { class: 'ghost sm', href: `/api/runs/${state.datasetRunId}/export?format=${fmt}`, title: `Download ${label}` }, icon('download', 'sm'), label)),
            h('button', { class: 'ghost sm', onclick: () => copy(`${location.origin}/api/runs/${state.datasetRunId}/dataset`, 'Dataset URL copied') }, icon('copy', 'sm'), 'API URL'));

        /* summary */
        clear(kpis).append(
            statTile({ label: 'Gigs', value: num(items.length), accent: true, iconName: 'layers', sub: run.meta?.totalAvailableOnFiverr ? `of ${num(run.meta.totalAvailableOnFiverr)} matches` : null }),
            statTile({ label: 'Avg price', value: stats?.avgPrice != null ? money(stats.avgPrice) : '—', iconName: 'tag', sub: stats ? `$${stats.minPrice} – $${stats.maxPrice}` : null }),
            statTile({ label: 'Avg delivery', value: stats?.avgDelivery != null ? `${stats.avgDelivery}d` : '—', iconName: 'clock', sub: `${stats?.promoted ?? 0} promoted ad${stats?.promoted === 1 ? '' : 's'}` }),
            statTile({ label: 'Avg rating', value: stats?.avgRating?.toFixed?.(2) ?? '—', iconName: 'star', sub: `${compact(stats?.totalReviews ?? 0)} reviews` }));

        const sampleNote = run.meta?.source === 'sample' ? h('div', { class: 'banner warn', style: { marginTop: '16px' } }, icon('shield'),
            h('div', {}, h('b', {}, 'Offline sample run. '),
                'This dataset was parsed from the bundled fixture page (the actor’s own parser) because fiverr.com was unreachable. Add a residential proxy or use the Jina reader for live rows.')) : null;
        clear(noteHost).append(...(sampleNote ? [sampleNote] : []));

        clear(summary).append(
            h('div', { class: 'card pad' }, h('div', { class: 'card-title' }, icon('tag'), 'Price distribution'),
                h('div', { style: { marginTop: '14px' } }, barChart((stats?.priceBuckets ?? []).map((b) => ({ label: b.label, value: b.count })), { format: (v) => `${v} gigs` }))),
            h('div', { class: 'card pad' }, h('div', { class: 'card-title' }, icon('globe'), 'Seller countries'),
                h('div', { class: 'bars', style: { marginTop: '14px' } }, ...(stats?.countries ?? []).slice(0, 7).map(([cc, count]) => h('div', { class: 'bar-row' },
                    h('span', {}, `${flag(cc)} ${cc}`),
                    h('div', { class: 'bar-track' }, h('div', { class: 'bar-fill violet', style: { width: `${(count / (stats.countries[0]?.[1] || 1)) * 100}%` } })),
                    h('b', { class: 'right num' }, count))))));

        /* filter chips */
        const quick = h('div', { class: 'row wrap' },
            h('span', { class: 'tiny faint' }, 'Quick filters:'),
            ...[['promoted', 'Ads only'], ['choice', "Fiverr's choice"], ['online', 'Online now'], ['pro', 'Pro sellers'], ['fast', '≤3 days delivery'], ['budget', 'Under $50'], ['video', 'Video intro']]
                .map(([key, label]) => h('button', {
                    class: `chip click ${state.quickFilters.has(key) ? 'on' : ''}`, style: state.quickFilters.has(key) ? { borderColor: 'var(--accent-line)', color: 'var(--accent)' } : null,
                    title: 'Toggle filter',
                    onclick: () => { state.quickFilters.has(key) ? state.quickFilters.delete(key) : state.quickFilters.add(key); state.limit = 24; route(); },
                }, label)));
        clear(quickHost).append(quick);

        function filtered() {
            const q = state.filter.trim().toLowerCase();
            const preds = [...state.quickFilters].map((k) => ({
                promoted: (i) => i.is_promoted, choice: (i) => i.isFiverrChoice, online: (i) => i.seller_isOnline,
                pro: (i) => i.seller_isPro, fast: (i) => i.delivery_days && i.delivery_days <= 3,
                budget: (i) => i.starting_price != null && i.starting_price < 50, video: (i) => i.hasVideoIntro,
            }[k]));
            return items.filter((i) => {
                if (!preds.every((p) => p(i))) return false;
                if (!q) return true;
                return [i.title, i.seller_username, i.seller_displayName, i.seller_country, i.tags, i.slug, i.url].filter(Boolean).join(' ').toLowerCase().includes(q);
            });
        }

        function renderBody() {
            const rows = filtered();
            clear(body);
            body.append(h('div', { class: 'row', style: { marginBottom: '12px' } },
                h('span', { class: 'sm-text muted' }, `${num(rows.length)} of ${num(items.length)} gigs`),
                state.filter || state.quickFilters.size ? h('button', { class: 'ghost sm', onclick: () => { state.filter = ''; state.quickFilters.clear(); route(); } }, icon('x', 'sm'), 'Clear filters') : null));

            if (!rows.length) {
                body.append(emptyState({ iconName: 'search', title: 'No gigs match', body: 'Try a different search term or clear the quick filters.' }));
                return;
            }

            if (state.resultsView === 'cards') {
                const slice = rows.slice(0, state.limit);
                body.append(h('div', { class: 'gig-grid' }, ...slice.map((it, i) => gigCard(it, { index: i }))));
                if (rows.length > slice.length) {
                    body.append(h('div', { class: 'center', style: { marginTop: '20px' } },
                        h('button', { class: 'soft', onclick: () => { state.limit += 24; renderBody(); } }, icon('chevron'), `Show 24 more (${rows.length - slice.length} left)`)));
                }
                spotlight(body);
            } else {
                body.append(dataTable(rows, items, renderBody));
            }
        }

        function dataTable(rows, all, rerender) {
            const cols = [
                { key: 'position', label: '#', num: true, get: (i) => i.position },
                { key: 'title', label: 'Gig', get: (i) => i.title, cell: (i) => h('div', { class: 'cell-gig' },
                    h('img', { src: i.thumbnail ?? '', loading: 'lazy', onerror: (e) => { e.target.style.visibility = 'hidden'; } }),
                    h('span', {}, i.title ?? '—')) },
                { key: 'seller_username', label: 'Seller', get: (i) => i.seller_username, cell: (i) => h('span', { class: 'row', style: { gap: '6px' } }, flag(i.seller_country), i.seller_username ?? '—') },
                { key: 'seller_level', label: 'Level', get: (i) => i.seller_level, cell: (i) => h('span', { class: `badge ${levelInfo(i.seller_level).cls}` }, levelInfo(i.seller_level).label) },
                { key: 'starting_price', label: 'Price', num: true, get: (i) => i.starting_price ?? 0, cell: (i) => money(i.starting_price) },
                { key: 'delivery_days', label: 'Days', num: true, get: (i) => i.delivery_days ?? 0, cell: (i) => i.delivery_days ?? '—' },
                { key: 'seller_rating_score', label: 'Rating', num: true, get: (i) => i.seller_rating_score ?? 0, cell: (i) => `${(i.seller_rating_score ?? 0).toFixed(2)}` },
                { key: 'seller_rating_count', label: 'Reviews', num: true, get: (i) => i.seller_rating_count ?? 0, cell: (i) => compact(i.seller_rating_count) },
                { key: 'flags', label: 'Signals', get: (i) => `${i.is_promoted}${i.isFiverrChoice}`, cell: (i) => h('span', { class: 'row', style: { gap: '4px' } }, i.is_promoted ? h('span', { class: 'badge red' }, 'AD') : null, i.isFiverrChoice ? h('span', { class: 'badge green' }, 'Choice') : null, i.seller_isOnline ? h('span', { class: 'badge gray' }, 'Online') : null) },
            ];
            const sorted = rows.slice().sort((a, b) => {
                const col = cols.find((c) => c.key === state.sort.key) ?? cols[0];
                const va = col.get(a); const vb = col.get(b);
                const cmp = typeof va === 'string' || typeof vb === 'string' ? String(va ?? '').localeCompare(String(vb ?? '')) : (va ?? 0) - (vb ?? 0);
                return state.sort.dir === 'asc' ? cmp : -cmp;
            });
            const slice = sorted.slice(0, Math.max(state.limit, 60));

            const thead = h('thead', {}, h('tr', {}, ...cols.map((c) => h('th', {
                class: `${state.sort.key === c.key ? 'sorted' : ''} ${c.num ? 'right' : ''}`,
                onclick: () => {
                    state.sort = { key: c.key, dir: state.sort.key === c.key && state.sort.dir === 'asc' ? 'desc' : 'asc' };
                    rerender();
                },
            }, c.label, h('span', { class: 'sort-i' }, state.sort.key === c.key ? (state.sort.dir === 'asc' ? '↑' : '↓') : '↕')))));

            const tbody = h('tbody', {}, ...slice.map((it) => h('tr', { onclick: () => showGig(it) },
                ...cols.map((c) => h('td', { class: c.num ? 'num' : c.key === 'title' ? '' : 'strong' }, c.cell ? c.cell(it) : c.get(it))),
                h('td', {}, h('div', { class: 'row-actions' },
                    h('a', { class: 'icon-btn', href: it.url, target: '_blank', rel: 'noopener', title: 'Open on Fiverr', onclick: (e) => e.stopPropagation() }, icon('external', 'sm')),
                    h('button', { class: 'icon-btn', title: 'Copy JSON', onclick: (e) => { e.stopPropagation(); copy(JSON.stringify(it, null, 2), 'Record JSON copied'); } }, icon('copy', 'sm')))))));

            const wrap = h('div', { class: 'table-wrap' }, h('table', { class: 'data' }, thead, tbody));
            const foot = h('div', { class: 'row', style: { marginTop: '12px' } },
                h('span', { class: 'sm-text muted' }, `Showing ${slice.length} of ${sorted.length} rows`),
                h('span', { class: 'spacer' }),
                sorted.length > slice.length ? h('button', { class: 'soft sm', onclick: () => { state.limit += 250; rerender(); } }, 'Load more rows') : null);
            return frag(wrap, foot);
        }

        renderBody();
    } catch (err) {
        toast(`Could not load dataset: ${err.message}`, 'err');
        clear(body).append(emptyState({ iconName: 'x', title: 'Dataset unavailable', body: err.message }));
    }
}

/* ============================== gig drawer =============================== */
function showGig(item) {
    const body = [];
    const price = item.starting_price ?? item.price_min;
    const seller = item.seller ?? {};
    const level = levelInfo(item.seller_level ?? seller.level);

    body.push(h('div', { class: 'hero' }, (() => {
        const url = item.thumbnail ?? item.gallery?.[0]?.url;
        return url ? h('img', { src: url, alt: '', onerror: (e) => { e.target.replaceWith(h('div', { class: 'center', style: { height: '100%' } }, icon('image', 'lg'))); } }) : h('div', { class: 'center', style: { height: '100%' } }, icon('image', 'lg'));
    })()));

    body.push(h('div', { class: 'row wrap', style: { gap: '8px' } },
        item.is_promoted ? h('span', { class: 'badge red' }, 'Promoted ad') : h('span', { class: 'badge gray' }, 'Organic'),
        item.isFiverrChoice ? h('span', { class: 'badge green' }, icon('star'), "Fiverr's Choice") : null,
        level ? h('span', { class: `badge ${level.cls}` }, level.label) : null,
        item.seller_isPro ? h('span', { class: 'badge violet' }, 'Pro') : null,
        item.seller_isOnline ? h('span', { class: 'badge gray' }, 'Online now') : null,
        item.source ? sourceBadge(item.source) : null));

    body.push(h('h2', { style: { fontSize: '20px', lineHeight: '1.35' } }, item.title ?? 'Untitled gig'));

    body.push(h('div', { class: 'kv' },
        h('div', {}, h('span', {}, 'Starting price'), h('b', {}, money(price))),
        h('div', {}, h('span', {}, 'Delivery'), h('b', {}, item.delivery_days ? `${item.delivery_days} days` : '—')),
        h('div', {}, h('span', {}, 'Packages'), h('b', {}, item.total_packages ?? (item.packages?.length || '—'))),
        h('div', {}, h('span', {}, 'Search position'), h('b', {}, item.position ? `#${item.position}` : '—')),
        h('div', {}, h('span', {}, 'Rating'), h('b', { class: 'row', style: { gap: '6px' } }, stars(item.seller_rating_score ?? item.rating), (item.seller_rating_score ?? item.rating ?? 0).toFixed?.(2) ?? '—')),
        h('div', {}, h('span', {}, 'Reviews'), h('b', {}, num(item.seller_rating_count ?? item.rating_count)))));

    body.push(h('div', { class: 'row wrap', style: { gap: '10px' } },
        h('a', { class: 'primary sm', href: item.url, target: '_blank', rel: 'noopener' }, icon('external', 'sm'), 'Open on Fiverr'),
        item.seller_url || item.seller_username ? h('a', { class: 'ghost sm', href: item.seller_url ?? `https://www.fiverr.com/${item.seller_username}`, target: '_blank', rel: 'noopener' }, icon('user', 'sm'), 'Seller profile') : null,
        h('button', { class: 'ghost sm', onclick: () => copy(JSON.stringify(item, null, 2), 'Record JSON copied') }, icon('copy', 'sm'), 'Copy JSON')));

    /* seller card */
    const sellerName = item.seller_displayName ?? seller.display_name ?? item.seller_username ?? seller.username;
    body.push(h('div', { class: 'card pad stack' },
        h('div', { class: 'card-title' }, icon('user'), 'Seller'),
        h('div', { class: 'row', style: { gap: '14px' } },
            avatarFor(item, 'lg'),
            h('div', { class: 'stack', style: { gap: '4px', minWidth: 0 } },
                h('b', { style: { fontSize: '16px' } }, sellerName ?? 'Unknown'),
                h('span', { class: 'sm-text muted' }, `${flag(item.seller_country ?? seller.country)} ${seller.country ?? item.seller_country ?? ''} · joined ${seller.member_since ?? '—'}`),
                item.seller_languages || seller.languages ? h('span', { class: 'tiny faint' }, item.seller_languages ?? seller.languages) : null)),
        item.seller_bio || seller.bio ? h('p', { class: 'sm-text muted', style: { lineHeight: '1.65' } }, seller.bio ?? item.seller_bio) : null,
        h('div', { class: 'kv' },
            seller.completed_orders || item.seller_completed_orders ? h('div', {}, h('span', {}, 'Completed orders'), h('b', {}, num(seller.completed_orders))) : null,
            seller.response_time_hours ? h('div', {}, h('span', {}, 'Response time'), h('b', {}, `${seller.response_time_hours}h`)) : null,
            seller.hourly_rate ? h('div', {}, h('span', {}, 'Hourly rate'), h('b', {}, money(seller.hourly_rate))) : null,
            seller.on_vacation ? h('div', {}, h('span', {}, 'Status'), h('b', {}, 'On vacation')) : null),
        (seller.skills?.length) ? h('div', { class: 'chips' }, ...seller.skills.slice(0, 14).map((s) => h('span', { class: 'chip' }, s))) : null));

    /* packages */
    if (item.packages?.length) {
        const pkgGrid = h('div', { class: 'pkg-grid' });
        item.packages.forEach((p, idx) => {
            const featureList = h('ul');
            (p.features ?? []).slice(0, 8).forEach((f) => {
                featureList.append(h('li', { class: f.included ? '' : 'no' }, icon('check'), h('span', {}, f.label ?? f.name)));
            });
            pkgGrid.append(h('div', { class: `pkg ${idx === 1 ? 'tier' : ''}` },
                h('h4', {}, p.title ?? `Package ${idx + 1}`),
                h('div', { class: 'price' }, money(p.price)),
                h('span', { class: 'tiny faint' }, `${p.delivery_days ?? '?'} days · ${p.revisions_unlimited ? 'unlimited' : (p.revisions ?? 0)} revisions`),
                p.description ? h('p', { class: 'tiny muted', style: { lineHeight: '1.55' } }, p.description) : null,
                p.extra_fast_price ? h('span', { class: 'badge gold' }, `express +${money(p.extra_fast_price)}`) : null,
                featureList));
        });
        body.push(h('div', { class: 'stack' },
            h('div', { class: 'card-title' }, icon('tag'), `Packages · ${item.packages.length}`),
            pkgGrid));
    }

    /* reviews */
    if (item.reviews_summary) {
        const rs = item.reviews_summary;
        body.push(h('div', { class: 'card pad stack' },
            h('div', { class: 'card-title' }, icon('star'), `Reviews · ${num(rs.total)}`),
            h('div', { class: 'bars' },
                ...[['Communication', rs.communication], ['Quality', rs.quality], ['Value for money', rs.value_for_money]]
                    .map(([label, val]) => h('div', { class: 'bar-row' },
                        h('span', {}, label),
                        h('div', { class: 'bar-track' }, h('div', { class: 'bar-fill gold', style: { width: `${((val ?? 0) / 5) * 100}%` } })),
                        h('b', { class: 'right num' }, val != null ? Number(val).toFixed(2) : '—'))))));
    }
    if (item.reviews?.length) {
        body.push(h('div', { class: 'stack' },
            h('div', { class: 'card-title' }, icon('message'), `Latest reviews`),
            ...item.reviews.slice(0, 5).map((r) => h('div', { class: 'review' },
                h('div', { class: 'r-top' }, stars(r.rating), h('b', {}, r.reviewer ?? 'buyer'), h('span', { class: 'spacer' }), h('span', { class: 'tiny faint' }, `${flag(r.reviewer_country)} ${timeAgo(r.created_at)}`)),
                h('p', { class: 'sm-text muted', style: { lineHeight: '1.6' } }, r.comment ?? ''),
                r.seller_response ? h('p', { class: 'tiny', style: { color: 'var(--accent)', lineHeight: '1.55' } }, `↳ seller: ${r.seller_response}`) : null))));
    }

    /* description / faq */
    if (item.description) {
        body.push(h('div', { class: 'card pad stack' }, h('div', { class: 'card-title' }, icon('book'), 'Description'),
            h('p', { class: 'sm-text muted', style: { whiteSpace: 'pre-wrap', lineHeight: '1.7', maxHeight: '320px', overflow: 'auto' } }, truncate(item.description, 4000))));
    }
    if (item.ai_summary?.length) {
        body.push(h('div', { class: 'banner info' }, icon('spark'), h('div', {}, h('b', {}, 'AI summary · '), item.ai_summary.join(' '))));
    }
    if (item.faq?.length) {
        body.push(h('div', { class: 'stack' }, h('div', { class: 'card-title' }, icon('message'), `FAQ · ${item.faq.length}`),
            ...item.faq.slice(0, 8).map((q) => h('details', { class: 'adv' }, h('summary', {}, q.question, icon('chevron', 'chev')), h('div', { class: 'adv-body tiny muted' }, q.answer)))));
    }

    /* tags + raw */
    const tags = [item.tags, item.metadata].flatMap((v) => (typeof v === 'string' ? v.split(',').map((s) => s.trim()) : Object.values(v ?? {}).flat())).filter(Boolean);
    if (tags.length) body.push(h('div', { class: 'chips' }, ...[...new Set(tags)].slice(0, 24).map((t) => h('span', { class: 'chip' }, t))));

    body.push(h('div', { class: 'stack' },
        h('div', { class: 'row' }, h('div', { class: 'card-title' }, icon('terminal'), 'Raw record'),
            h('span', { class: 'spacer' }),
            h('span', { class: 'tiny faint' }, `${Object.keys(item).length} fields`)),
        h('pre', { class: 'code', html: prettyJson(item) })));

    openDrawer(frag(...body), { title: truncate(item.title, 60), subtitle: `${item.seller_username ?? ''} · ${item.url ?? ''}` });
}

/* ================================== api ================================== */
async function renderApi(root) {
    root.append(h('div', { class: 'page-head' },
        h('div', {},
            h('div', { class: 'eyebrow' }, 'Developer'),
            h('h1', {}, 'API & deploy'),
            h('p', { class: 'sub' }, 'The studio is a thin layer over the actor. Everything the UI does is available over HTTP, and the actor itself still deploys to Apify unchanged.'))));

    const grid = h('div', { class: 'grid c2', style: { alignItems: 'start' } });
    const endpoints = [
        ['POST', '/api/runs', 'Start a scrape run — body { input } like the actor input schema.'],
        ['GET', '/api/runs', 'Run history with status, counts and duration.'],
        ['GET', '/api/runs/:id', 'One run including streamed events, items and computed stats.'],
        ['GET', '/api/runs/:id/stream', 'Server-Sent Events: log, item, progress and end messages.'],
        ['GET', '/api/runs/:id/dataset', 'Apify-shaped dataset payload (JSON).'],
        ['GET', '/api/runs/:id/export?format=', 'csv · json · xlsx · md · ndjson download.'],
        ['POST', '/api/runs/:id/cancel', 'Abort a running job.'],
    ];
    grid.append(
        h('div', { class: 'card pad stack' },
            h('div', { class: 'card-title' }, icon('globe'), 'Studio endpoints'),
            h('div', { class: 'stack', style: { gap: '8px' } }, ...endpoints.map(([m, p, d]) => h('div', { class: 'row', style: { alignItems: 'flex-start', gap: '12px' } },
                h('span', { class: `badge ${m === 'POST' ? 'violet' : 'green'} mono`, style: { minWidth: '58px', justifyContent: 'center' } }, m),
                h('div', { style: { minWidth: 0 } },
                    h('b', { class: 'mono sm-text' }, p),
                    h('p', { class: 'tiny faint', style: { marginTop: '3px', lineHeight: '1.5' } }, d)))))),
        h('div', { class: 'card pad stack' },
            h('div', { class: 'card-title' }, icon('bolt'), 'Apify CLI'),
            h('pre', { class: 'code', html: `<span class="c"># 1. run the actor locally with an input file</span>
<span class="k">apify</span> run -p fiverr-gig-scraper

<span class="c"># 2. push it to your Apify account & build</span>
<span class="k">apify</span> push

<span class="c"># 3. or just run the studio (this UI)</span>
<span class="k">npm</span> run studio   <span class="c">→ http://localhost:4321</span>` })),
    );

    grid.append(
        h('div', { class: 'card pad stack' },
            h('div', { class: 'card-title' }, icon('terminal'), 'Start a run from the shell'),
            h('pre', { class: 'code', html: `<span class="k">curl</span> -X POST http://localhost:4321/api/runs \\
  -H <span class="s">'content-type: application/json'</span> \\
  -d <span class="s">'{"input":{"query":"logo design","maxPages":2,
       "sortBy":"rating","skipPromoted":true}}'</span>

<span class="c"># stream it</span>
<span class="k">curl</span> -N http://localhost:4321/api/runs/&lt;id&gt;/stream

<span class="c"># download</span>
<span class="k">curl</span> -O http://localhost:4321/api/runs/&lt;id&gt;/export?format=xlsx` })),
        h('div', { class: 'card pad stack' },
            h('div', { class: 'card-title' }, icon('shield'), 'Actor input schema'),
            h('div', { class: 'stack', style: { gap: '10px' } }, ...schemaRows(state.inputSchema))),
    );

    root.append(grid);
}

function schemaRows(schema) {
    const props = schema?.properties ?? {};
    return Object.entries(props).map(([key, def]) => h('div', { class: 'row wrap', style: { gap: '10px', alignItems: 'flex-start', paddingBottom: '10px', borderBottom: '1px solid var(--line)' } },
        h('span', { class: 'badge gray mono' }, key),
        h('div', { style: { minWidth: 0, flex: '1 1 240px' } },
            h('span', { class: 'sm-text' }, def.title ?? key),
            h('p', { class: 'tiny faint', style: { marginTop: '3px', lineHeight: '1.5' } }, truncate(def.description ?? '', 200))),
        h('span', { class: 'tiny faint mono nowrap' }, def.default != null ? `= ${JSON.stringify(def.default)}` : (def.enum ? def.enum.join(' | ') : def.type ?? ''))));
}

/* ================================ about ================================= */
async function renderAbout(root) {
    root.append(h('div', { class: 'page-head' },
        h('div', {},
            h('div', { class: 'eyebrow' }, 'Documentation'),
            h('h1', {}, 'Actor readme'),
            h('p', { class: 'sub' }, 'The full documentation of the scraper behind this studio — modes, input fields, output shape and tips.'))));
    const tabs = h('div', { class: 'tabs' },
        h('button', { class: 'active', onclick: (e) => { setTab(e.target, 'readme'); } }, 'README'),
        h('button', { onclick: (e) => { setTab(e.target, 'deploy'); } }, 'Deploy guide'));
    const host = h('div', { class: 'card pad', style: { marginTop: '16px' } });
    const docsHost = h('div', { class: 'stack' });
    root.append(h('div', { class: 'row' }, tabs, h('span', { class: 'spacer' }),
        h('a', { class: 'ghost sm', href: 'https://github.com/Bilalkhank10/fiverr-gig-scraper', target: '_blank', rel: 'noopener' }, icon('external', 'sm'), 'Repository')),
        host, docsHost);

    let docs = null;
    const setTab = (btn, key) => {
        host.parentElement.querySelectorAll('.tabs button').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        paint(key);
    };
    function paint(key) {
        clear(host);
        if (!docs) { host.append(h('div', { class: 'skeleton', style: { height: '300px' } })); return; }
        host.append(h('div', { class: 'md', html: markdown(key === 'readme' ? docs.readme : docs.deploy) }));
    }
    paint('readme');
    try {
        docs = await api.docs();
        paint('readme');
    } catch (err) {
        clear(host).append(emptyState({ iconName: 'book', title: 'Docs unavailable', body: err.message }));
    }
}

/* ================================ palette ================================ */
function openPalette() {
    const host = document.getElementById('paletteHost');
    clear(host);
    const input = h('input', { type: 'text', placeholder: 'Search actions, runs and gigs…', oninput: () => paintList() });
    const list = h('div', { class: 'p-list' });
    let active = 0;
    let results = [];

    const close = () => { host.classList.remove('open'); clear(host); document.removeEventListener('keydown', onKey); };
    const onKey = (e) => {
        if (e.key === 'Escape') close();
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            active = clamp(active + (e.key === 'ArrowDown' ? 1 : -1), 0, Math.max(0, results.length - 1));
            paintList(true);
        }
        if (e.key === 'Enter') { results[active]?.run?.(); close(); }
    };
    document.addEventListener('keydown', onKey);

    function items() {
        const nav = [
            { icon: 'gauge', label: 'Overview', sub: 'Go', run: () => { location.hash = '#/overview'; } },
            { icon: 'spark', label: 'New run', sub: 'Go', run: () => { location.hash = '#/new'; } },
            { icon: 'layers', label: 'Jobs', sub: 'Go', run: () => { location.hash = '#/jobs'; } },
            { icon: 'grid', label: 'Dataset explorer', sub: 'Go', run: () => { location.hash = '#/results'; } },
            { icon: 'terminal', label: 'API & deploy', sub: 'Go', run: () => { location.hash = '#/api'; } },
            { icon: 'book', label: 'Readme', sub: 'Go', run: () => { location.hash = '#/about'; } },
            { icon: 'moon', label: 'Toggle theme', sub: 'Action', run: () => toggleTheme() },
            { icon: 'shield', label: 'Re-check connectivity', sub: 'Action', run: () => { refreshConnectivity(null); toast('Probing fiverr.com and r.jina.ai…'); } },
            ...RECIPES.map((r) => ({ icon: r.icon, label: `Recipe · ${r.label}`, sub: 'Prefill', run: () => { Object.assign(composer, DEFAULT_INPUT, r.patch); saveComposer(); location.hash = '#/new'; } })),
        ];
        const gigs = (state.dataset?.items ?? []).slice(0, 400).map((it) => ({
            icon: 'tag', label: it.title ?? 'gig', sub: `#${it.position} · ${it.seller_username ?? ''}`,
            run: () => showGig(it),
        }));
        const runs = state.runs.map((r) => ({ icon: 'clock', label: `${r.query || '(no query)'}`, sub: `${r.status} · ${r.gigs} gigs`, run: () => { location.hash = `#/jobs/${r.id}`; } }));
        return [...nav, ...runs, ...gigs];
    }
    const all = items();

    function paintList(keep) {
        const q = input.value.trim().toLowerCase();
        results = (q ? all.filter((i) => `${i.label} ${i.sub}`.toLowerCase().includes(q)) : all.slice(0, 9)).slice(0, 40);
        if (!keep) active = 0;
        clear(list);
        if (!results.length) list.append(h('div', { class: 'p-item' }, 'No matches'));
        results.forEach((item, i) => {
            const row = h('div', { class: `p-item ${i === active ? 'active' : ''}`, onclick: () => { item.run?.(); close(); } },
                icon(item.icon, 'sm'), h('span', { class: 'truncate' }, item.label), h('span', { class: 'sub' }, item.sub));
            list.append(row);
        });
    }
    paintList();
    host.append(h('div', { class: 'palette-scrim', onclick: close }),
        h('div', { class: 'palette' }, h('div', { class: 'p-input' }, icon('search'), input, h('kbd', { class: 'pill-soft' }, 'esc')), list));
    host.classList.add('open');
    input.focus();
}

/* ================================ chrome ================================= */
function toggleTheme() {
    const html = document.documentElement;
    const next = html.dataset.theme === 'dark' ? 'light' : 'dark';
    html.dataset.theme = next;
    localStorage.setItem('theme', next);
    document.getElementById('themeBtn').querySelector('use').setAttribute('href', next === 'dark' ? '#i-moon' : '#i-sun');
    toast(`${next === 'dark' ? 'Dark' : 'Light'} theme`);
}

async function boot() {
    const saved = localStorage.getItem('theme');
    if (saved) document.documentElement.dataset.theme = saved;
    document.getElementById('themeBtn').querySelector('use').setAttribute('href', document.documentElement.dataset.theme === 'dark' ? '#i-moon' : '#i-sun');

    document.getElementById('themeBtn').onclick = toggleTheme;
    document.getElementById('newRunBtn').onclick = () => { location.hash = '#/new'; };
    document.getElementById('cmdkBtn').onclick = openPalette;
    document.getElementById('connChip').onclick = () => { refreshConnectivity(null); toast('Probing fiverr.com and r.jina.ai…'); };
    document.getElementById('openNav').onclick = () => document.getElementById('sidebar').classList.add('open');
    document.getElementById('closeNav').onclick = () => document.getElementById('sidebar').classList.remove('open');
    document.querySelectorAll('.nav-item').forEach((a) => a.addEventListener('click', () => document.getElementById('sidebar').classList.remove('open')));

    document.addEventListener('keydown', (e) => {
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); }
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && location.hash.startsWith('#/new')) { e.preventDefault(); startRun(); }
    });

    route();

    try {
        const s = await api.state();
        state.actor = s.actor;
        state.inputSchema = s.inputSchema;
        state.runs = s.runs;
        document.getElementById('jobCount').textContent = s.runs.length;
        document.title = `${s.actor.title ?? 'Fiverr Gig Studio'} — Studio`;
        if (location.hash === '' || location.hash === '#/overview') route();
        fetch('/api/runs').then((r) => r.json()).then(({ runs }) => {
            const withItems = runs.filter((x) => x.gigs > 0);
            if (withItems[0] && !state.dataset) {
                api.run(withItems[0].id).then((run) => {
                    state.dataset = run;
                    document.getElementById('datasetCount').textContent = compact((run.items ?? []).length);
                });
            }
        }).catch(() => {});
    } catch (err) {
        toast(`Backend not reachable: ${err.message}`, 'err');
    }
    if (!location.hash.startsWith('#/overview')) refreshConnectivity(null);
}

boot();
