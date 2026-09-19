# Fiverr Search Gig Scraper 🎯

Extract Fiverr gig data for any keyword in seconds. Searches Fiverr like a buyer and saves gigs, sellers, prices, ratings and performance metrics into a clean dataset (JSON / CSV / Excel). Pure HTTP — no browser — so it is fast and cheap.

## ✨ What you get
- **Gig**: ID, title, URL, slug, thumbnail, category / subcategory, style tags
- **Seller**: username, display name, country, avatar, online status, Pro badge, level, languages, rating & review count
- **Pricing**: starting price, currency, recommended package, delivery days, number of packages
- **Performance**: search position, **promoted/ad flag**, impression ID, Fiverr's Choice, Featured, buying rating & reviews
- **Features**: consultation, video intro, work samples, recurring option
- **Gallery** (optional): all gig images + delivery work samples

## ⚙️ Input
| Field | Type | Default | Description |
|---|---|---|---|
| `query` | string | `poster design` | Keyword to search |
| `searchUrl` | string | – | Any Fiverr search / category URL (with filters). Overrides `query` |
| `startPage` | int | 1 | First page (48 gigs per page) |
| `maxPages` | int | 1 | Pages to scrape (1–50) |
| `sortBy` | enum | `auto` | `auto`, `rating`, `new`, `price_asc`, `price_desc` |
| `includeSellerDetails` / `includePricing` / `includePerformance` / `includeGallery` | bool | true/true/true/false | Toggle field groups |
| `skipPromoted` | bool | false | Drop paid ads, keep organic ranking |
| `maxItems` | int | 0 | Stop after N gigs (cost control) |
| `proxyConfiguration` | object | Apify RESIDENTIAL | Recommended for reliability |
| `delayMs` | int | 2000 | Delay between pages |

```json
{ "query": "logo design", "maxPages": 3, "sortBy": "rating", "skipPromoted": true }
```

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
