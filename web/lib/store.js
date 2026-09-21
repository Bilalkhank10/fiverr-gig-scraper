/**
 * Run store — keeps scrape jobs, streamed log events and dataset exports.
 * Persisted to <repo>/storage/web/*.json (gitignored, same convention as the actor).
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const STORAGE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'storage', 'web');
const RUNS_FILE = path.join(STORAGE, 'runs.json');
const KEEP = 40;
const EVENTS_KEEP = 500;
const ITEMS_KEEP = 1500;

mkdirSync(STORAGE, { recursive: true });

/** Credentials are used for the live run but never persisted or served back. */
const SECRET_KEYS = ['apifyProxyPassword', 'jinaApiKey', 'customProxyUrl'];
export function redactInput(input = {}) {
    const copy = { ...input };
    for (const key of SECRET_KEYS) {
        if (copy[key]) copy[key] = key === 'customProxyUrl' ? 'http://•••:•••@…' : '••••••••';
    }
    return copy;
}

export const runs = new Map(); // runId -> run
const subscribers = new Map(); // runId -> Set<res>
let persistTimer = null;

/* ------------------------------ persistence ------------------------------ */
function load() {
    try {
        if (!existsSync(RUNS_FILE)) return;
        for (const run of JSON.parse(readFileSync(RUNS_FILE, 'utf8'))) {
            run.events = run.events ?? [];
            run.items = run.items ?? [];
            if (run.status === 'running') { run.status = 'interrupted'; run.error = run.error ?? 'studio restarted'; }
            runs.set(run.id, run);
        }
    } catch { /* corrupt cache — start fresh */ }
}

function persist() {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
        try {
            const list = [...runs.values()].slice(0, KEEP).map((r) => ({
                ...r,
                input: redactInput(r.input),
                items: r.items.slice(0, ITEMS_KEEP),
                events: r.events.slice(-120),
                file: undefined,
            }));
            writeFileSync(RUNS_FILE, JSON.stringify(list));
        } catch { /* ignore */ }
    }, 500);
}

/* -------------------------------- events -------------------------------- */
export function subscribe(id, res) {
    if (!subscribers.has(id)) subscribers.set(id, new Set());
    subscribers.get(id).add(res);
    return () => { subscribers.get(id)?.delete(res); };
}

export function emit(run, event) {
    const ev = { ...event, at: Date.now() };
    if (event.type === 'item') run.items.push(event.item);
    else run.events.push(ev);
    if (run.events.length > EVENTS_KEEP) run.events.splice(0, run.events.length - EVENTS_KEEP);
    const dead = [];
    for (const res of subscribers.get(run.id) ?? []) {
        try { res.write(`data: ${JSON.stringify(ev)}\n\n`); } catch { dead.push(res); }
    }
    for (const res of dead) subscribers.get(run.id)?.delete(res);
    persist();
}

/* --------------------------------- runs --------------------------------- */
export function createRun(input, actorCode) {
    const id = crypto.randomUUID();
    const run = {
        id,
        actorCode,
        input,
        status: 'running',
        startedAt: Date.now(),
        finishedAt: null,
        error: null,
        events: [],
        items: [],
        meta: null,
        abort: null,
    };
    runs.set(id, run);
    // keep the store bounded
    const ordered = [...runs.values()].sort((a, b) => b.startedAt - a.startedAt);
    for (const r of ordered.slice(KEEP)) { runs.delete(r.id); deleteRunFile(r.id); }
    persist();
    return run;
}

export function finishRun(run, { status, meta, error }) {
    run.status = status;
    run.finishedAt = Date.now();
    run.meta = meta ?? run.meta;
    run.error = error ?? null;
    run.abort = null;
    emit(run, { type: 'end', status, meta: run.meta, error: run.error });
    persist();
}

export function getRun(id) { return runs.get(id) ?? null; }

export function listRuns() {
    return [...runs.values()]
        .sort((a, b) => b.startedAt - a.startedAt)
        .map((r) => ({
            id: r.id, actorCode: r.actorCode, status: r.status, startedAt: r.startedAt,
            finishedAt: r.finishedAt, gigs: r.items.length, error: r.error,
            query: r.input?.searchUrl || r.input?.query || (r.input?.gigUrls?.[0] ?? ''),
            mode: r.input?.scrapeMode ?? 'search',
            source: r.meta?.source ?? null,
            durationMs: r.meta?.durationMs ?? (r.finishedAt ? r.finishedAt - r.startedAt : null),
        }));
}

export function deleteRun(id) {
    runs.delete(id);
    deleteRunFile(id);
    persist();
}

/* ------------------------------ dataset file ----------------------------- */
export function datasetPath(id) { return path.join(STORAGE, `dataset-${id}.json`); }

export function saveDataset(run) {
    const payload = {
        actor: 'fiverr-gig-scraper',
        runId: run.id,
        meta: run.meta,
        input: redactInput(run.input),
        itemCount: run.items.length,
        items: run.items,
    };
    writeFileSync(datasetPath(run.id), JSON.stringify(payload));
    return payload;
}

function deleteRunFile(id) {
    try { if (existsSync(datasetPath(id))) writeFileSync(datasetPath(id), ''); } catch { /* ignore */ }
}

/* ------------------------------- CSV export ------------------------------ */
const csvCell = (v) => {
    if (v == null) return '';
    if (Array.isArray(v) || typeof v === 'object') return `"${JSON.stringify(v).replace(/"/g, '""')}"`;
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(items) {
    if (!items.length) return '';
    const keys = [...new Set(items.flatMap((it) => Object.keys(it)))];
    const rows = [keys.join(',')];
    for (const item of items) rows.push(keys.map((k) => csvCell(item[k])).join(','));
    return rows.join('\n');
}

export function statsOf(items) {
    const prices = items.map((i) => i.starting_price).filter((v) => typeof v === 'number');
    const ratings = items.map((i) => i.seller_rating_score).filter((v) => typeof v === 'number');
    const reviews = items.map((i) => i.seller_rating_count).filter((v) => typeof v === 'number');
    const sellers = new Set(items.map((i) => i.seller_username).filter(Boolean));
    const countries = {};
    for (const it of items) if (it.seller_country) countries[it.seller_country] = (countries[it.seller_country] ?? 0) + 1;
    const levels = {};
    for (const it of items) if (it.seller_level) levels[it.seller_level] = (levels[it.seller_level] ?? 0) + 1;
    const delivery = items.map((i) => i.delivery_days).filter((v) => typeof v === 'number');
    const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
    const r2 = (v) => (v == null ? null : Math.round(v * 100) / 100);
    return {
        items: items.length,
        uniqueSellers: sellers.size,
        promoted: items.filter((i) => i.is_promoted).length,
        fiverrChoice: items.filter((i) => i.isFiverrChoice).length,
        online: items.filter((i) => i.seller_isOnline).length,
        pro: items.filter((i) => i.seller_isPro).length,
        avgPrice: r2(avg(prices)),
        minPrice: prices.length ? Math.min(...prices) : null,
        maxPrice: prices.length ? Math.max(...prices) : null,
        medianPrice: prices.length ? prices.slice().sort((a, b) => a - b)[Math.floor(prices.length / 2)] : null,
        avgRating: r2(avg(ratings)),
        avgReviews: Math.round(avg(reviews) ?? 0),
        totalReviews: reviews.reduce((a, b) => a + b, 0),
        avgDelivery: r2(avg(delivery)),
        countries: Object.entries(countries).sort((a, b) => b[1] - a[1]).slice(0, 8),
        levels: Object.entries(levels).sort((a, b) => b[1] - a[1]),
        priceBuckets: (() => {
            const edges = [0, 25, 50, 100, 250, 500, 1000, Infinity];
            const labels = ['<$25', '$25–50', '$50–100', '$100–250', '$250–500', '$500–1k', '$1k+'];
            const counts = new Array(labels.length).fill(0);
            for (const p of prices) {
                for (let i = 0; i < labels.length; i++) if (p >= edges[i] && p < edges[i + 1]) { counts[i]++; break; }
            }
            return labels.map((label, i) => ({ label, count: counts[i] }));
        })(),
    };
}

load();
