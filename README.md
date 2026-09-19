# Fiverr Niche Gig Scraper 🎯

Extract Fiverr gig data for any keyword in seconds. Searches Fiverr like a buyer and saves gigs, sellers, prices, ratings and performance metrics into a clean dataset (JSON / CSV / Excel). Pure HTTP — no browser — so it is fast and cheap.

## ✨ What you get
- **Gig**: ID, title, URL, slug, thumbnail, category / subcategory, style tags
- **Seller**: username, display name, country, avatar, online status, Pro badge, level, languages, rating & review count
- **Pricing**: starting price, currency, recommended package, delivery days, number of packages
- **Performance**: search position, **promoted/ad flag**, impression ID, Fiverr's Choice, Featured, buying rating & reviews
- **Features**: consultation, video intro, work samples, recurring option
- **Gallery** (optional): all gig images + delivery work samples

## 🚀 How to use (3 clicks)
1. **Niches** — type one per line: `power bi dashboard`, `looker studio dashboard`, `tableau dashboard` …
2. **Gigs per niche** — e.g. `50`, `200`, `500`
3. **Start** — the Actor searches each niche, collects that many gigs, then (if *full details* is ON) opens every gig page and merges packages, prices, description, FAQ, reviews and the seller profile.

```json
{ "niches": ["power bi dashboard", "looker studio dashboard"], "gigsPerNiche": 100, "fullDetails": true }
```

Every row carries `niche` and `search_rank`, so you can filter / pivot per niche in Excel, Sheets or Power BI.

## ⚙️ Input
| Field | Default | Description |
|---|---|---|
| `niches` | `["power bi dashboard"]` | One keyword per line |
| `gigsPerNiche` | 50 | Gigs to collect for each niche (48 = one Fiverr page) |
| `fullDetails` | true | Open each gig page for full data (1 request/gig). OFF = fast listing only |
| `gigUrls` | [] | Extra gig URLs to scrape in full |
| `sortBy` | auto | `auto`, `rating`, `new`, `price_asc`, `price_desc` |
| `dedupeGigs` | true | One row per unique gig (Fiverr repeats gigs in ad + organic slots) |
| `skipPromoted` | false | Drop paid ads |
| `maxReviews` | 5 | Reviews per gig |
| `includeGallery` | false | Add image/video URLs |
| `detailConcurrency` | 3 | Parallel gig-page requests |
| `delayMs` | 1500 | Delay between requests |
| `proxyConfiguration` | RESIDENTIAL | Recommended |

### Full-details fields (per gig)
- **All 3 packages**: title, description, price, delivery days, revisions, extra-fast price, every feature, custom extras; `price_min` / `price_max`; subscription discounts
- Full **description**, **FAQ**, **tags**, category names, metadata, Fiverr **AI summary**, `orders_in_queue`, gallery
- **Seller**: bio, level, completed orders, response time, member since, last delivery, languages, skills, education, certifications, hourly rate, Pro/verified
- **Reviews**: 1–5 star breakdown, communication / quality / value scores, top buyer industries, latest N reviews

## 📊 Output (one item per gig)
```json
{
  "id": 459112484,
  "title": "create a professional minimalist logo design",
  "url": "https://www.fiverr.com/brandoradesign/do-a-luxury-minimalist-logo-design-for-your-business",
  "thumbnail": "https://fiverr-res.cloudinary.com/.../original/c43f8....jpg",
  "seller_username": "brandoradesign",
  "seller_displayName": "Brandora D",
  "seller_country": "PK",
  "seller_level": "level_two_seller",
  "seller_languages": "en (Level 3), de (Level 1)",
  "seller_rating_score": 4.97,
  "seller_rating_count": 630,
  "starting_price": 40,
  "currency": "USD",
  "delivery_days": 3,
  "total_packages": 3,
  "position": 6,
  "is_promoted": false,
  "isFiverrChoice": false,
  "buying_rating": 5,
  "buying_review_count": 627,
  "category_id": 3,
  "subcategory_id": 49,
  "hasVideoIntro": false,
  "hasWorkSamples": true,
  "scraped_at": "2026-09-19T15:00:00.000Z"
}
```
Two dataset views are provided: **📊 Gigs Overview** and **📋 Detailed View**.

## 💡 Tips
- Each page = 48 gigs. Start with 1–2 pages, then scale.
- Use `searchUrl` to apply Fiverr's own filters (seller level, budget, delivery time, language).
- Enable `skipPromoted` for true organic ranking analysis.
- Schedule the Actor for weekly price / competitor monitoring.

## ❓ FAQ
**Is this legal?** It reads publicly visible search results only. Respect Fiverr's ToS, rate limits and privacy law.
**Blocked / 403?** Fiverr uses PerimeterX. Switch proxy to Apify RESIDENTIAL — the Actor auto-rotates sessions and retries 5×.
