/**
 * Fiverr Gig Studio — API + static server for the scraper frontend.
 *   npm run studio        →  http://localhost:4321
 *
 * Endpoints
 *   GET    /api/state                 actor meta, defaults, presets, recent runs
 *   GET    /api/actor                 .actor/actor.json + input/dataset schemas
 *   POST   /api/runs                  start a scrape run  { input }
 *   GET    /api/runs                  run history
 *   GET    /api/runs/:id              one run (with items)
 *   GET    /api/runs/:id/stream       Server-Sent Events: log / item / progress
 *   POST   /api/runs/:id/cancel       abort a running job
 *   DELETE /api/runs/:id              delete a run + its dataset
 *   GET    /api/runs/:id/dataset      Apify-shaped dataset JSON
 *   GET    /api/runs/:id/export       ?format=csv|json|xlsx|md
 *   GET    /api/connectivity          probe fiverr.com + r.jina.ai (5s)
 */
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runScrape } from './lib/scraper.js';
import {
    createRun, finishRun, getRun, listRuns, deleteRun, subscribe, emit, saveDataset, toCsv, statsOf, redactInput,
} from './lib/store.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
// Apify web-server actors expose their port via APIFY_CONTAINER_PORT
const PORT = Number(process.env.APIFY_CONTAINER_PORT || process.env.PORT || process.env.STUDIO_PORT || 4321);
const HOST = process.env.HOST || '0.0.0.0';

const MIME = {
    '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
    '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.map': 'application/json',
};

const json = (res, code, body) => {
    const payload = JSON.stringify(body);
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(payload) });
    res.end(payload);
};

const readJson = (file) => readFile(file, 'utf8').then(JSON.parse);

async function body(req) {
    const chunks = [];
    for await (const c of req) { chunks.push(c); if (chunks.reduce((a, b) => a + b.length, 0) > 2e6) throw new Error('body too large'); }
    if (!chunks.length) return {};
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function serveStatic(req, res, url) {
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/' || rel === '') rel = '/index.html';
    const file = path.join(PUBLIC_DIR, path.normalize(rel).replace(/^([/\\])+/, ''));
    if (!file.startsWith(PUBLIC_DIR) || !existsSync(file)) {
        res.writeHead(404, { 'content-type': 'text/plain' }); res.end('Not found'); return;
    }
    const data = await readFile(file);
    res.writeHead(200, {
        'content-type': MIME[path.extname(file)] ?? 'application/octet-stream',
        'content-length': data.length,
        'cache-control': 'no-cache',
    });
    res.end(data);
}

/* --------------------------- run execution glue --------------------------- */
function startRun(run) {
    const controller = new AbortController();
    run.abort = controller;
    runScrape(run.input, { signal: controller.signal, onEvent: (ev) => emit(run, ev) })
        .then((result) => {
            run.meta = result.meta;
            run.source = result.meta.source;
            run.items = result.items;
            saveDataset(run);
            finishRun(run, { status: controller.signal.aborted ? 'cancelled' : 'succeeded', meta: result.meta });
        })
        .catch((err) => {
            emit(run, { type: 'log', message: `❌ ${err.message}` });
            finishRun(run, { status: controller.signal.aborted ? 'cancelled' : 'failed', error: err.message });
        });
}

/* ------------------------------- routes -------------------------------- */
const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
    const p = url.pathname;

    if (!p.startsWith('/api/')) return serveStatic(req, res, url).catch(() => { res.writeHead(500).end(); });

    try {
        if (p === '/api/state' && req.method === 'GET') {
            const [actor, schema] = await Promise.all([readJson(path.join(ROOT, '.actor', 'actor.json')), readJson(path.join(ROOT, '.actor', 'input_schema.json'))]);
            return json(res, 200, { actor, inputSchema: schema, runs: listRuns() });
        }

        if (p === '/api/actor' && req.method === 'GET') {
            const [actor, inputSchema, datasetSchema] = await Promise.all([
                readJson(path.join(ROOT, '.actor', 'actor.json')),
                readJson(path.join(ROOT, '.actor', 'input_schema.json')),
                readJson(path.join(ROOT, '.actor', 'dataset_schema.json')),
            ]);
            return json(res, 200, { actor, inputSchema, datasetSchema });
        }

        if (p === '/api/docs' && req.method === 'GET') {
            const read = async (file) => { try { return await readFile(path.join(ROOT, file), 'utf8'); } catch { return `_${file} not found_`; } };
            const [readme, deploy] = await Promise.all([read('README.md'), read('DEPLOY_GUIDE_UR.md')]);
            return json(res, 200, { readme, deploy });
        }

        if (p === '/api/runs' && req.method === 'POST') {
            const payload = await body(req);
            const input = payload.input ?? {};
            const run = createRun(input, 'web-studio');
            startRun(run);
            return json(res, 201, { id: run.id, status: run.status });
        }

        if (p === '/api/runs' && req.method === 'GET') return json(res, 200, { runs: listRuns() });

        if (p === '/api/connectivity' && req.method === 'GET') {
            const probe = async (target) => {
                const started = Date.now();
                try {
                    const ac = new AbortController();
                    const timer = setTimeout(() => ac.abort(), 5000);
                    const { get } = await import('./lib/http.js');
                    const r = await get(target, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; fiverr-gig-studio check)' }, timeout: 4500, signal: ac.signal });
                    clearTimeout(timer);
                    return { target, ok: r.status < 500, status: r.status, ms: Date.now() - started };
                } catch (err) {
                    return { target, ok: false, error: err.message, ms: Date.now() - started };
                }
            };
            const [fiverr, jina] = await Promise.all([probe('https://www.fiverr.com/'), probe('https://r.jina.ai/https://example.com')]);
            return json(res, 200, { fiverr, jina, checkedAt: Date.now() });
        }

        const runMatch = p.match(/^\/api\/runs\/([\w-]+)(\/(stream|dataset|export|cancel))?$/);
        if (runMatch) {
            const id = runMatch[1];
            const sub = runMatch[3];
            const run = getRun(id);
            if (!run) return json(res, 404, { error: 'run not found' });

            if (!sub && req.method === 'GET') {
                return json(res, 200, {
                    ...run, input: redactInput(run.input), abort: undefined, items: run.items.slice(0, 1500),
                    events: run.events.slice(-150), stats: statsOf(run.items),
                });
            }
            if (!sub && req.method === 'DELETE') { deleteRun(id); return json(res, 200, { ok: true }); }

            if (sub === 'cancel' && req.method === 'POST') {
                run.abort?.abort();
                emit(run, { type: 'log', message: '⏹ cancel requested' });
                return json(res, 200, { ok: true });
            }

            if (sub === 'stream' && req.method === 'GET') {
                res.writeHead(200, {
                    'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform',
                    connection: 'keep-alive', 'x-accel-buffering': 'no',
                });
                res.write(`retry: 2000\n\n`);
                res.write(`data: ${JSON.stringify({ type: 'hello', status: run.status, meta: run.meta, stats: statsOf(run.items), count: run.items.length })}\n\n`);
                for (const ev of run.events.slice(-150)) res.write(`data: ${JSON.stringify(ev)}\n\n`);
                if (run.status !== 'running') {
                    res.write(`data: ${JSON.stringify({ type: 'end', status: run.status, meta: run.meta, error: run.error })}\n\n`);
                    return res.end();
                }
                const unsubscribe = subscribe(id, res);
                const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* ignore */ } }, 15_000);
                req.on('close', () => { clearInterval(ping); unsubscribe(); });
                return undefined;
            }

            if (sub === 'dataset') {
                return json(res, 200, {
                    actor: 'fiverr-gig-scraper', runId: run.id, meta: run.meta, input: redactInput(run.input),
                    itemCount: run.items.length, items: run.items,
                });
            }

            if (sub === 'export') {
                const format = (url.searchParams.get('format') ?? 'json').toLowerCase();
                const stamp = new Date(run.startedAt).toISOString().replace(/[:.]/g, '-').slice(0, 19);
                const name = `fiverr-gigs-${stamp}-${run.id.slice(0, 6)}`;
                const send = (mime, ext, content) => {
                    res.writeHead(200, {
                        'content-type': mime, 'content-disposition': `attachment; filename="${name}.${ext}"`,
                        'content-length': Buffer.byteLength(content),
                    });
                    res.end(content);
                };
                if (format === 'csv') return send('text/csv; charset=utf-8', 'csv', toCsv(run.items));
                if (format === 'ndjson') return send('application/x-ndjson', 'ndjson', run.items.map((i) => JSON.stringify(i)).join('\n'));
                if (format === 'xlsx') {
                    const { toXlsx } = await import('./lib/xlsx.js');
                    const buf = toXlsx(run.items, 'Fiverr Gigs');
                    res.writeHead(200, {
                        'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                        'content-disposition': `attachment; filename="${name}.xlsx"`,
                        'content-length': buf.length,
                    });
                    return res.end(buf);
                }
                if (format === 'md') {
                    const md = [
                        `# Fiverr gigs — ${run.input.searchUrl || run.input.query}`,
                        '', `*Run ${run.id} · ${run.items.length} gigs · source: ${run.meta?.source ?? 'n/a'}*`, '',
                        '| # | Gig | Seller | Price | Rating | Reviews | Delivery |',
                        '|---|-----|--------|-------|--------|---------|----------|',
                        ...run.items.map((i, n) => `| ${i.position ?? n + 1} | [${(i.title ?? '').replace(/\|/g, '/')}](${i.url}) | ${i.seller_username ?? ''} | $${i.starting_price ?? ''} | ${i.seller_rating_score ?? ''} | ${i.seller_rating_count ?? ''} | ${i.delivery_days ?? ''}d |`),
                    ].join('\n');
                    return send('text/markdown; charset=utf-8', 'md', md);
                }
                return json(res, 200, {
                    actor: 'fiverr-gig-scraper', runId: run.id, meta: run.meta, input: redactInput(run.input),
                    itemCount: run.items.length, items: run.items,
                });
            }
        }

        return json(res, 404, { error: `no route ${req.method} ${p}` });
    } catch (err) {
        return json(res, 500, { error: err.message });
    }
});

server.listen(PORT, HOST, () => {
    console.log(`\n  ◆ Fiverr Gig Studio ready →  http://localhost:${PORT}\n`);
});
