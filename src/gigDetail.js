/**
 * Gig detail page parser: https://www.fiverr.com/<seller>/<slug>
 * Data lives in <script id="perseus-initial-props"> exactly like search pages.
 * Units in raw JSON: package.price = cents, package.duration = hours.
 */
import { extractProps } from './parser.js';

const stripHtml = (s) => (s ? s.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\n{3,}/g, '\n\n').trim() : null);
const cents = (v) => (v == null ? null : Math.round(v) / 100);
const hoursToDays = (h) => (h == null ? null : Math.round((h / 24) * 100) / 100);
const LEVELS = { NO_LEVEL: 'new_seller', NEW_SELLER: 'new_seller', LEVEL_ONE: 'level_one_seller', LEVEL_TWO: 'level_two_seller', TOP_RATED_SELLER: 'top_rated_seller', TRS: 'top_rated_seller' };

export function parseGigDetail(html, { currencyRate = 1, currency = 'USD', maxReviews = 5 } = {}) {
    const d = extractProps(html);
    if (!d?.general?.gigId) return null;
    const toUsd = (v) => (v == null ? null : currency === 'USD' || !currencyRate ? v : Math.round((v / currencyRate) * 100) / 100);

    const g = d.general ?? {};
    const s = d.seller ?? {};
    const su = s.user ?? {};
    const sc = d.sellerCard ?? {};
    const ov = d.overview ?? {};
    const rv = d.reviews ?? {};
    const pk = d.packages ?? {};

    const packages = (pk.packageList ?? []).map((p) => ({
        id: p.id,
        title: p.title,
        description: p.description,
        price: toUsd(cents(p.price)),
        delivery_days: hoursToDays(p.duration),
        revisions: p.revisions?.value ?? null,
        revisions_unlimited: p.revisions?.value === -1,
        extra_fast_available: Boolean(p.extraFast && !p.extraFast.included && p.extraFast.price),
        extra_fast_price: p.extraFast?.price ? toUsd(cents(p.extraFast.price)) : null,
        extra_fast_days: p.extraFast?.duration ? hoursToDays(p.extraFast.duration) : null,
        features: (p.features ?? []).map((f) => ({
            name: f.name, label: f.label, included: Boolean(f.included),
            value: f.type === 'NUMERIC' ? f.value : undefined,
            extra_price: f.price ? toUsd(cents(f.price)) : undefined,
        })),
        custom_extras: (p.customExtras ?? []).map((e) => ({
            label: e.label ?? e.title, price: toUsd(cents(e.price)), duration_days: hoursToDays(e.duration),
        })),
    }));

    const prices = packages.map((p) => p.price).filter((v) => v != null);

    const gallery = (d.gallery?.slides ?? []).map((x) => x.slide ?? x).map((sl) => ({
        type: sl.type ?? (sl.src?.match(/\.(mp4|webm)/) ? 'video' : 'image'),
        url: sl.src ?? sl.media?.large ?? sl.media?.medium ?? null,
        thumbnail: sl.media?.small ?? null,
    })).filter((x) => x.url);

    const metadata = {};
    for (const m of d.description?.metadataAttributes ?? []) {
        metadata[m.metadata?.alias ?? m.name] = (m.options ?? []).map((o) => o.label ?? o.value);
    }

    const breakdown = {};
    for (const b of rv.breakdown ?? []) breakdown[`${b.average_valuation_value}_star`] = b.count;

    return {
        gig_id: g.gigId,
        title: g.gigTitle,
        url: `https://www.fiverr.com/${su.name ?? sc.username ?? ''}/${d.portfolio?.slug ?? ''}`.replace(/\/$/, ''),
        status: g.gigStatus,
        category: g.categoryName, category_id: g.categoryId, category_slug: g.categorySlug,
        subcategory: g.subCategoryName, subcategory_id: g.subCategoryId, subcategory_slug: g.subCategorySlug,
        nested_subcategory_id: g.nestedSubCategoryId ?? null,
        is_pro: Boolean(g.isPro), is_handpicked: Boolean(g.isHandpicked), is_studio: Boolean(g.isStudio),
        orders_in_queue: ov.gig?.ordersInQueue ?? null,
        rating: ov.gig?.rating ?? rv.average_valuation ?? null,
        rating_count: ov.gig?.ratingsCount ?? rv.total_count ?? null,

        description: stripHtml(d.description?.content),
        description_html: d.description?.content ?? null,
        metadata,
        tags: (d.tags?.tagsGigList ?? []).map((t) => t.name),
        faq: (d.faq?.questionsAndAnswers ?? []).map((q) => ({ question: q.question, answer: stripHtml(q.answer) })),
        ai_summary: d.aiSummary?.summary ?? [],

        price_min: prices.length ? Math.min(...prices) : null,
        price_max: prices.length ? Math.max(...prices) : null,
        currency: 'USD',
        packages,
        recurring_options: (pk.recurringOptions ?? []).map((r) => ({ discount_percent: r.discountPercentage, duration: r.duration, unit: (r.durationTimeUnit ?? '').replace('time_unit_', '') })),
        offers_consultation: Boolean(d.consultationData?.isConsultationAvailable ?? d.consultationData?.consultation),
        has_work_samples: Boolean(g.includeWorkSample),

        gallery, gallery_count: gallery.length,
        has_video: gallery.some((x) => x.type === 'video') || Boolean(s.introVideo?.url),

        seller: {
            id: Number(s.id ?? su.id ?? g.sellerId) || null,
            username: su.name ?? rv.seller_username ?? null,
            display_name: su.profile?.displayName ?? null,
            full_name: su.fullName ?? null,
            country: su.address?.countryCode ?? sc.countryCode ?? null,
            level: LEVELS[s.sellerLevel] ?? (s.sellerLevel ? String(s.sellerLevel).toLowerCase() : 'new_seller'),
            is_pro: Boolean(s.isPro), is_verified: Boolean(s.isVerified), is_online: s.isActive ?? null,
            one_liner: s.oneLinerTitle ?? sc.oneLiner ?? null,
            bio: s.description ?? sc.description ?? null,
            profile_image: su.profileImage?.previewUrl?.url ?? sc.profilePhoto ?? null,
            profile_url: su.name ? `https://www.fiverr.com/${su.name}` : null,
            rating: s.rating?.score ?? null, rating_count: s.rating?.count ?? sc.ratingsCount ?? null,
            completed_orders: s.completedOrdersCount ?? null,
            response_time_hours: s.responseTime?.inHours ?? sc.responseTime ?? null,
            is_highly_responsive: Boolean(s.isHighlyResponsive),
            member_since: sc.memberSince ? new Date(sc.memberSince * 1000).toISOString().slice(0, 10) : (su.joinedAt ?? null),
            recent_delivery: sc.recentDelivery ? new Date(sc.recentDelivery).toISOString() : null,
            languages: (su.languages ?? []).map((l) => `${String(l.code).toLowerCase()} (${l.level})`).join(', ') || (sc.proficientLanguages ?? []).map((l) => `${l.name} (Level ${l.level})`).join(', '),
            skills: (s.activeStructuredSkills ?? []).map((k) => k.label ?? k.name),
            education: (s.activeEducations ?? []).map((e) => `${e.degreeTitle ?? e.degree ?? ''} — ${e.school ?? ''} (${e.toYear ?? ''})`.trim()),
            certifications: (s.certifications ?? []).map((c) => `${c.certificationName} — ${c.receivedFrom} (${c.year})`),
            hourly_rate: s.hourlyRate ? toUsd(cents(s.hourlyRate)) : null,
            intro_video: s.introVideo?.url ?? null,
            on_vacation: Boolean(s.isOnVacation ?? g.isOnVacation),
            agency: s.agency?.name ?? null,
            notable_clients: (d.notableClients?.clients ?? d.notableClients ?? []).map?.((c) => c.name ?? c) ?? [],
        },

        reviews_summary: {
            total: rv.total_count ?? null,
            average: rv.average_valuation ?? null,
            communication: rv.star_summary?.communication_valuation ?? null,
            quality: rv.star_summary?.quality_of_delivery_valuation ?? null,
            value_for_money: rv.star_summary?.value_for_money_valuation ?? null,
            breakdown,
            top_industries: Object.entries(rv.filters_counters?.most_common_industries ?? {}).map(([k, v]) => `${k}:${v}`),
        },
        reviews: (rv.reviews ?? []).slice(0, maxReviews).map((r) => ({
            id: r.id, rating: r.value, comment: r.comment, language: r.comment_language,
            reviewer: r.username, reviewer_country: r.reviewer_country ?? r.reviewer_country_code,
            created_at: r.created_at, order_duration_days: r.order_duration_in_days, order_price_range: r.order_price_range_usd ?? r.order_price_range,
            seller_response: r.seller_response?.comment ?? null,
        })),

        other_gigs_count: d.otherGigs?.gigs?.length ?? null,
        scraped_at: new Date().toISOString(),
    };
}
