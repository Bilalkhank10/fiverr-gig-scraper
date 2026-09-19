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
    return props?.requestContext?.currency?.name ?? props?.currency?.name ?? 'USD';
}

const abs = (u) => (u && u.startsWith('/') ? `https://www.fiverr.com${u}` : u ?? null);

export function flattenGig(g, position, opts = {}) {
    const {
        includeSellerDetails = true,
        includePricing = true,
        includePerformance = true,
        includeGallery = false,
        currency = 'USD',
    } = opts;

    const assets = Array.isArray(g.assets) ? g.assets : [];
    const samples = Array.isArray(g.filtered_delivery_attachments) ? g.filtered_delivery_attachments : [];
    const pkg = g.packages?.recommended ?? {};
    const rating = g.seller_rating ?? {};

    const rec = {
        id: g.gig_id ?? g.gigId ?? g.pk_i ?? null,
        title: g.title ?? null,
        url: abs(g.gig_url),
        slug: g.cached_slug ?? null,
        thumbnail: assets.find((a) => a.cloud_img_main_gig)?.cloud_img_main_gig ?? null,
        category_id: g.category_id ?? null,
        subcategory_id: g.sub_category_id ?? null,
        nested_subcategory_id: g.nested_sub_category_id ?? null,
    };

    if (includeSellerDetails) {
        Object.assign(rec, {
            seller_id: g.seller_id != null ? Number(g.seller_id) : null,
            seller_username: g.seller_name ?? null,
            seller_displayName: g.seller_display_name ?? null,
            seller_country: g.seller_country ?? null,
            seller_img: g.seller_img ?? null,
            seller_url: abs(g.seller_url) ?? (g.seller_name ? `https://www.fiverr.com/${g.seller_name}` : null),
            seller_isOnline: g.seller_online ?? null,
            seller_isPro: g.is_pro ?? null,
            seller_level: g.seller_level ?? null,
            seller_languages: (g.seller_languages ?? [])
                .map((l) => `${l.code} (Level ${l.level})`).join(', '),
            seller_rating_score: rating.score ?? null,
            seller_rating_count: rating.count ?? null,
            seller_unavailable: g.is_seller_unavailable ?? null,
        });
    }

    if (includePricing) {
        Object.assign(rec, {
            starting_price: g.price_i ?? pkg.price ?? null,
            currency,
            recommended_package_id: pkg.id ?? null,
            recommended_package_type: pkg.type ?? null,
            delivery_days: pkg.duration ?? null,
            extra_fast: pkg.extra_fast ?? null,
            total_packages: g.num_of_packages ?? null,
            hourly_rate_cents: g.hourly_rate ?? null,
        });
    }

    if (includePerformance) {
        Object.assign(rec, {
            position,
            listing_type: g.type ?? 'gigs',
            is_promoted: g.type === 'promoted_gigs',
            auction_id: g.auction?.id ?? null,
            impression_id: g.impressionId ?? g.uuid ?? null,
            isFiverrChoice: g.is_fiverr_choice ?? false,
            isFeatured: g.is_featured ?? false,
            buying_rating: g.buying_review_rating ?? null,
            buying_review_count: g.buying_review_rating_count ?? null,
        });
    }

    Object.assign(rec, {
        offerConsultation: g.offer_consultation ?? null,
        hasVideoIntro: assets.some((a) => a.type === 'VideoAsset'),
        hasWorkSamples: samples.length > 0,
        hasRecurringOption: g.has_recurring_option ?? null,
        personalizedPricingFail: g.personalized_pricing_fail ?? null,
        style_tags: (g.metadata ?? []).filter((m) => m.type === 'style').flatMap((m) => m.value ?? []),
    });

    if (includeGallery) {
        rec.gallery_images = assets.map((a) => a.cloud_img_main_gig).filter(Boolean);
        rec.work_samples = samples.map((a) => a.image_url).filter(Boolean);
    }

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
