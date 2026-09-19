# Apify par deploy karne ka tareeqa (Urdu/Roman)

## Option A — Apify CLI (recommended)
```bash
npm install -g apify-cli
apify login                 # browser khulega, token do
cd fiverr-gig-scraper-actor
apify run -p                # local test (input: storage/key_value_stores/default/INPUT.json)
apify push                  # Apify Console par actor ban jayega + build start
```
Push ke baad Console → Actors → fiverr-gig-scraper → **Start** karo.

## Option B — Console se manual (bina CLI)
1. https://console.apify.com/actors → **Develop new** → **Empty JavaScript** template.
2. Source tab "Web IDE" mein ye files paste karo (same paths):
   `.actor/actor.json`, `.actor/input_schema.json`, `.actor/dataset_schema.json`,
   `src/main.js`, `src/parser.js`, `package.json`, `Dockerfile`, `README.md`
3. **Build** → **Start**.

## Option C — GitHub
Folder ko GitHub repo mein push karo → Console → Develop new → "Link Git repository".

## Settings jo set karni hain
- **Memory**: 256 MB kaafi hai (original actor bhi 256 use karta hai). Timeout 360s+.
- **Proxy**: Input mein default RESIDENTIAL hai. Free plan par residential na ho to `{"useApifyProxy": true}` (datacenter) try karo — retry/rotation built-in hai.
- **Publish karna ho** (Store par bechna): Actor → Publication tab → title, icon, categories (Automation / Lead generation), pricing = Pay-per-event
  (`apify-default-dataset-item` ≈ $0.005, `apify-actor-start` ≈ $0.003 — original ke barabar) → Publish.

## Local test (Apify ke bagair)
```bash
npm install
npm test                                        # offline parser test (sample HTML)
APIFY_LOCAL_STORAGE_DIR=./storage node src/main.js
# output: storage/datasets/default/*.json
```
