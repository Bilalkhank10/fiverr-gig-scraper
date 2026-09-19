/**
 * Pure functions: HTML -> perseus props -> flat gig records.
 * Kept free of Apify imports so they can be unit-tested offline.
 */

const PROPS_RE = /<script[^>]*id="perseus-initial-props"[^>]*>([\s\S]*?)<\/script>/;

const decodeEntities = (s) => s
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&amp;/g, '&');

export function isBlocked(html) {
    return /It needs a human touch|perimeterx|_pxCaptcha|px-captcha/i.test(html) && !PROPS_RE.test(html);
}

export function extractProps(html) {
    const m = PROPS_RE.exec(html);
    if (!m) return null;
    const raw = m[1].trim();
    try {
        return JSON.parse(raw);
    } catch {
        return JSON.parse(decodeEntities(raw));
    }
}

export function getGigs(props) {
    return props?.listings?.[0]?.gigs
        ?? props?.rawListingData?.gigs
        ?? [];
}

export function getPagination(props) {
    const p = props?.appData?.pagination ?? {};
    return {
        page: p.page ?? props?.listingAttributes?.page ?? 1,
        pageSize: p.page_size ?? props?.listingAttributes?.pageSize ?? 48,
        total: p.total ?? 0,
    };
}

export function getCurrency(props) {
    const c = props?.requestContext?.currency ?? props?.currency ?? {};
    return { name: c.name ?? 'USD', rate: Number(c.rate) || 1 };
}

const abs = (u) => (u && u.startsWith('/') ? `https://www.fiverr.com${u}` : u ?? null);

export function flattenGig(g, position, opts = {}) {
    const {
        includeSellerDetails = true,
        includePricing = true,
        includePerformance = true,
        includeGallery = false,
        currency = 'USD',
        currencyRate = 1,
    } = opts;

    const assets = Array.isArray(g.assets) ? g.assets : [];
    const samples = Array.isArray(g.filtered_delivery_attachments) ? g.filtered_delivery_attachments : [];
    const pkg = g.packages?.recommended ?? {};
    const rating = g.seller_rating ?? {};
    const toUsd = (v) => (v == null ? null : (currency === 'USD' || !currencyRate ? v : Math.round((v / currencyRate) * 100) / 100));

    // metadata: [{type:'style',value:[..]},{type:'file_format',value:[..]}] -> object + flat tag string
    const metadata = {};
    for (const m of g.metadata ?? []) if (m?.type && Array.isArray(m.value) && m.value.length) metadata[m.type] = m.value;
    const tags = Object.values(metadata).flat().join(', ');

    const rec = {
        id: g.gig_id ?? g.gigId ?? g.pk_i ?? null,
        title: g.title ?? null,
        url: abs(g.gig_url),
        slug: g.cached_slug ?? null,
        thumbnail: assets.find((a) => a.cloud_img_main_gig)?.cloud_img_main_gig ?? null,
    };

    if (includeSellerDetails) {
        Object.assign(rec, {
            seller_id: g.seller_id != null ? Number(g.seller_id) : null,
            seller_username: g.seller_name ?? null,
            seller_displayName: g.seller_display_name ?? g.seller_name ?? null,
            seller_profileImage: g.seller_img ?? null,
            seller_url: abs(g.seller_url) ?? (g.seller_name ? `https://www.fiverr.com/${g.seller_name}` : null),
            seller_country: g.seller_country ?? null,
            seller_isOnline: Boolean(g.seller_online),
            seller_isPro: Boolean(g.is_pro),
            seller_level: g.seller_level || 'new_seller',
            seller_languages: (g.seller_languages ?? []).map((l) => `${l.code} (Level ${l.level})`).join(', '),
            seller_rating_score: rating.score ?? 0,
            seller_rating_count: rating.count ?? 0,
        });
    }

    if (includePricing) {
        const price = g.price_i ?? pkg.price ?? null;
        Object.assign(rec, {
            starting_price: toUsd(price),
            currency: 'USD',
            recommended_package_id: pkg.id ?? null,
            recommended_package_price: toUsd(pkg.price ?? price),
            delivery_days: pkg.duration ?? null,
            has_extra_fast: Boolean(pkg.extra_fast ?? g.extra_fast),
            package_tier: g.package_i ?? pkg.id ?? null,
            package_type: pkg.type ?? null,
            total_packages: g.num_of_packages ?? null,
            hourly_rate: g.hourly_rate ? toUsd(g.hourly_rate / 100) : null,
        });
        if (currency !== 'USD') { rec.original_currency = currency; rec.original_price = price; }
    }

    if (includePerformance) {
        Object.assign(rec, {
            position,
            listing_type: g.type ?? 'organic',
            is_promoted: g.type === 'promoted_gigs',
            impression_id: g.impressionId ?? g.uuid ?? null,
            isFiverrChoice: Boolean(g.is_fiverr_choice),
            isFeatured: Boolean(g.is_featured),
            buying_rating: g.buying_review_rating ?? 0,
            buying_review_count: g.buying_review_rating_count ?? 0,
        });
    }

    Object.assign(rec, {
        category_id: g.category_id ?? null,
        subcategory_id: g.sub_category_id ?? null,
        nested_subcategory_id: g.nested_sub_category_id || null,
        isSellerUnavailable: Boolean(g.is_seller_unavailable),
        offerConsultation: Boolean(g.offer_consultation),
        hasRecurringOptions: Boolean(g.has_recurring_option),
        isPersonalizedPricingEnabled: !g.personalized_pricing_fail,
        hasVideoIntro: assets.some((a) => a.type === 'VideoAsset'),
        hasWorkSamples: samples.length > 0,
    });

    if (includeGallery) {
        rec.gallery = assets.map((a) => a.cloud_img_main_gig).filter(Boolean);
        rec.gallery_count = rec.gallery.length;
        rec.work_samples = samples.map((a) => a.image_url).filter(Boolean);
    } else {
        rec.gallery_count = assets.filter((a) => a.cloud_img_main_gig).length;
    }
    rec.attachments_count = samples.length;
    rec.tags = tags;
    rec.metadata = metadata;
    rec.scraped_at = new Date().toISOString();
    return rec;
}

const SORT_MAP = { auto: null, rating: 'rating', new: 'new', price_asc: 'price_asc', price_desc: 'price_desc' };

export function buildUrl({ query, searchUrl, page, sortBy = 'auto' }) {
    let url;
    if (searchUrl) {
        url = new URL(searchUrl);
    } else {
        url = new URL('https://www.fiverr.com/search/gigs');
        url.searchParams.set('query', query);
        url.searchParams.set('source', 'top-bar');
    }
    url.searchParams.set('page', String(page));
    if (page > 1) url.searchParams.set('offset', String((page - 1) * 48));
    if (SORT_MAP[sortBy]) url.searchParams.set('sort_by', SORT_MAP[sortBy]);
    return url.toString();
}
