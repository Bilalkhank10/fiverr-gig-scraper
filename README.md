# Fiverr Search Gig Scraper 🎯

Extract Fiverr gig data for any keyword in seconds. Searches Fiverr like a buyer and saves gigs, sellers, prices, ratings and performance metrics into a clean dataset (JSON / CSV / Excel). Pure HTTP — no browser — so it is fast and cheap.

## ✨ What you get
- **Gig**: ID, title, URL, slug, thumbnail, category / subcategory, style tags
- **Seller**: username, display name, country, avatar, online status, Pro badge, level, languages, rating & review count
- **Pricing**: starting price, currency, recommended package, delivery days, number of packages
- **Performance**: search position, **promoted/ad flag**, impression ID, Fiverr's Choice, Featured, buying rating & reviews
- **Features**: consultation, video intro, work samples, recurring option
- **Gallery** (optional): all gig images + delivery work samples

## 🖥️ Fiverr Gig Studio — the frontend

The repo ships a premium control room for the actor: live run console, dataset explorer and
one-click exports. No build step, no framework, zero extra dependencies.

```bash
npm run studio        # → http://localhost:4321
```

| Screen | What it does |
|---|---|
| **Overview** | Network probe, KPIs, price distribution and country/level breakdown of the latest dataset |
| **New run** | Composer for every input field, quick recipes, and a live estimate of gigs / requests / cost / runtime |
| **Run console** | Streams the run over SSE: progress ring, live log console, gigs appearing as they are parsed, price + level charts |
| **Dataset** | Search, quick filters, sortable table or premium gig cards, detail drawer with packages, FAQ, reviews and raw JSON |
| **Exports** | JSON · CSV · XLSX (real .xlsx, dependency-free writer) · Markdown · NDJSON |
| **API & deploy** | Every endpoint the UI uses, the actor input schema, CLI and curl recipes, rendered readme |

Runs are stored under `storage/web/` (gitignored) and the API is a thin, documentable layer:

```
POST   /api/runs                  { input } → start a run, get its id
GET    /api/runs/:id/stream       Server-Sent Events: log · item · progress · end
GET    /api/runs/:id/dataset      Apify-shaped dataset JSON
GET    /api/runs/:id/export       ?format=csv|json|xlsx|md|ndjson
POST   /api/runs/:id/cancel       abort a running job
```

**Offline-first.** If `fiverr.com` is not reachable (sandbox, CI, no proxy) the studio replays the
bundled fixture pages in `test/` through the *exact same parser*, flags the run as `Offline sample`,
and keeps working end to end. Because Fiverr is protected by PerimeterX, a residential proxy is
still the reliable path for live data — set it under **New run → Advanced**: Apify proxy
(password + group + country), a custom HTTP(S) proxy URL, or the Jina reader (`fetchVia`).

`Dockerfile` ships the actor; the same image can serve the studio with
`CMD ["npm","run","studio"]` — it honours `APIFY_CONTAINER_PORT` for Apify web-server actors.

## 🎛️ Three modes
| `scrapeMode` | What it does | Speed |
|---|---|---|
| `search` (default) | Search listing only — 48 gigs per page, same fields as the classic actor | ⚡ 1 request / 48 gigs |
| `search_details` | Search, then **opens every gig page** and merges full data | 1 request per gig |
| `details` | Only scrape the `gigUrls` you paste | 1 request per gig |

### Extra fields from the gig page (details modes)
- **All 3 packages**: title, description, price, delivery days, revisions, extra-fast price, every included feature, custom extras
- `price_min` / `price_max`, recurring-subscription discounts
- Full **description** (text + HTML), **FAQ**, gig **tags**, category names, metadata (style, file formats…), Fiverr **AI summary**
- `orders_in_queue`, rating & rating count, full **gallery** (images + videos)
- **Seller profile**: bio, one-liner, level, completed orders, response time, member since, last delivery, languages, skills, education, certifications, hourly rate, Pro/verified flags
- **Reviews**: star breakdown (1–5), communication / quality / value sub-scores, top buyer industries, latest N reviews with comment, country, price range, seller response

## ⚙️ Input
| Field | Type | Default | Description |
|---|---|---|---|
| `scrapeMode` | enum | `search` | `search`, `search_details`, `details` |
| `gigUrls` | array | [] | Gig URLs for `details` mode |
| `maxReviews` | int | 5 | Reviews per gig (details modes) |
| `detailConcurrency` | int | 3 | Parallel gig-page requests |
| `query` | string | `poster design` | Keyword to search |
| `searchUrl` | string | – | Any Fiverr search / category URL (with filters). Overrides `query` |
| `startPage` | int | 1 | First page (48 gigs per page) |
| `maxPages` | int | 1 | Pages to scrape (1–50) |
| `sortBy` | enum | `auto` | `auto`, `rating`, `new`, `price_asc`, `price_desc` |
| `includeSellerDetails` / `includePricing` / `includePerformance` / `includeGallery` | bool | true/true/true/false | Toggle field groups |
| `skipPromoted` | bool | false | Drop paid ads, keep organic ranking |
| `dedupeGigs` | bool | false | Fiverr shows a gig twice (ad + organic). OFF = all 48 slots/page, ON = unique gigs only |
| `maxItems` | int | 0 | Stop after N gigs (cost control) |
| `fetchVia` | enum | `auto` | `auto` (direct → Jina fallback), `direct`, `jina` (all via r.jina.ai — works without proxy) |
| `jinaApiKey` | string | – | Optional free key from jina.ai for higher rate limits |
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
