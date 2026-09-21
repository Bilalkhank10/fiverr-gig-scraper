/**
 * Tiny HTTP client for the web studio — zero dependencies.
 *
 * Why not global fetch?  Fiverr is protected by PerimeterX and realistically needs a
 * residential proxy. The studio must be able to talk through an HTTP(S) CONNECT proxy,
 * which Node's fetch has no built-in support for. So we speak HTTP/1.1 directly with
 * node:http(s) and tunnel through the proxy ourselves.
 *
 * Features: redirects, gzip/deflate/br decompression, timeouts, abort signals,
 * per-request cookies, and optional HTTP(S) proxy tunneling (Apify / generic).
 */
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import zlib from 'node:zlib';
import { Buffer } from 'node:buffer';

const DEFAULT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

export const BROWSER_HEADERS = {
    'user-agent': DEFAULT_UA,
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'accept-language': 'en-US,en;q=0.9',
    'cache-control': 'no-cache',
    pragma: 'no-cache',
    'upgrade-insecure-requests': '1',
    'sec-ch-ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'sec-fetch-dest': 'document',
    'sec-fetch-mode': 'navigate',
    'sec-fetch-site': 'none',
    'sec-fetch-user': '?1',
    cookie: 'currency=USD; u_currency=USD; locale=en-US',
};

/** Parse http://user:pass@host:port and normalize defaults. */
export function parseProxy(url) {
    if (!url) return null;
    try {
        const u = new URL(url.includes('://') ? url : `http://${url}`);
        return {
            protocol: u.protocol.replace(':', ''),
            host: u.hostname,
            port: Number(u.port) || (u.protocol === 'https:' ? 443 : 80),
            auth: u.username ? `${decodeURIComponent(u.username)}:${decodeURIComponent(u.password)}` : null,
            tls: u.protocol === 'https:',
            raw: url,
        };
    } catch {
        return null;
    }
}

/**
 * Build an Apify proxy URL from console-style settings:
 *   http://groups-RESIDENTIAL,country-US:APIFY_PROXY_PASSWORD@proxy.apify.com:8000
 */
export function buildApifyProxyUrl({ password, groups = ['RESIDENTIAL'], country = '', session = '' }) {
    if (!password) return null;
    const userParts = [];
    if (groups?.length) userParts.push(`groups-${groups.join('+')}`);
    if (country) userParts.push(`country-${country.toUpperCase()}`);
    if (session) userParts.push(`session-${session}`);
    userParts.push('session-duration-10');
    return `http://${userParts.join(',')}:${encodeURIComponent(password)}@proxy.apify.com:8000`;
}

/** Open a TCP/TLS socket, tunnelling through an HTTP proxy when configured. */
function connect(target, proxy, timeout) {
    return new Promise((resolve, reject) => {
        const onSocket = (sock) => {
            sock.setTimeout(timeout);
            sock.setNoDelay(true);
            resolve(sock);
        };
        const fail = (err) => reject(Object.assign(err, { phase: 'connect' }));

        if (!proxy) {
            const sock = tls.connect({ host: target.host, port: target.port, servername: target.host, ALPNProtocols: ['http/1.1'] });
            sock.once('secureConnect', () => onSocket(sock));
            sock.once('error', fail);
            sock.setTimeout(timeout, () => fail(new Error('connection timeout')));
            return;
        }

        const proxySock = proxy.tls ? tls.connect({ host: proxy.host, port: proxy.port, servername: proxy.host }) : net.connect({ host: proxy.host, port: proxy.port });
        proxySock.setTimeout(timeout, () => fail(new Error('proxy timeout')));
        proxySock.once('error', fail);
        const start = proxy.tls ? 'secureConnect' : 'connect';

        proxySock.once(start, () => {
            const auth = proxy.auth ? `proxy-authorization: Basic ${Buffer.from(proxy.auth).toString('base64')}\r\n` : '';
            if (target.port === 443) {
                proxySock.write(`CONNECT ${target.host}:${target.port} HTTP/1.1\r\nhost: ${target.host}:${target.port}\r\n${auth}connection: keep-alive\r\n\r\n`);
            } else {
                // plain HTTP target: speak the absolute-form request straight to the proxy
                return resolve({ plainProxy: proxySock, plainTarget: target });
            }
            let buf = '';
            const onData = (chunk) => {
                buf += chunk.toString('latin1');
                if (!buf.includes('\r\n\r\n')) return;
                proxySock.off('data', onData);
                const status = Number(buf.split(' ')[1]);
                if (status !== 200) return fail(new Error(`proxy CONNECT failed (HTTP ${status})`));
                const secure = tls.connect({ socket: proxySock, servername: target.host, ALPNProtocols: ['http/1.1'] });
                secure.once('secureConnect', () => onSocket(secure));
                secure.once('error', fail);
            };
            proxySock.on('data', onData);
        });
    });
}

/** One HTTP request (no redirects). Resolves to { status, headers, body }. */
export function requestOnce(url, { headers = {}, proxy = null, timeout = 45_000, signal, method = 'GET', body } = {}) {
    return new Promise((resolve, reject) => {
        let target;
        try {
            const u = new URL(url);
            target = { host: u.hostname, port: Number(u.port) || (u.protocol === 'https:' ? 443 : 80), secure: u.protocol === 'https:', path: `${u.pathname}${u.search}`, abs: u.toString() };
        } catch (err) { return reject(new Error(`invalid URL: ${url}`)); }

        if (signal?.aborted) return reject(Object.assign(new Error('aborted'), { aborted: true }));

        connect(target, proxy, timeout).then((conn) => {
            const abort = () => { try { conn.destroy?.(); } catch {} reject(Object.assign(new Error('aborted'), { aborted: true })); };
            signal?.addEventListener('abort', abort, { once: true });

            const usingPlainProxy = Boolean(conn.plainProxy);
            const sock = usingPlainProxy ? conn.plainProxy : conn;
            const reqHeaders = {
                ...headers,
                host: target.host,
                connection: 'close',
                'accept-encoding': 'gzip, deflate, br',
            };
            if (body) reqHeaders['content-length'] = Buffer.byteLength(body);

            const path = usingPlainProxy ? target.abs : target.path;
            const head = Object.entries(reqHeaders).map(([k, v]) => `${k}: ${v}`).join('\r\n');
            sock.write(`${method} ${path} HTTP/1.1\r\n${head}\r\n\r\n${body ?? ''}`);

            const chunks = [];
            let raw = Buffer.alloc(0);
            let headDone = false;
            let resHeaders = {};
            let status = 0;

            const finish = () => {
                signal?.removeEventListener('abort', abort);
                const enc = String(resHeaders['content-encoding'] ?? '').toLowerCase();
                let payload = Buffer.concat(chunks);
                try {
                    if (enc.includes('br')) payload = zlib.brotliDecompressSync(payload);
                    else if (enc.includes('gzip')) payload = zlib.gunzipSync(payload);
                    else if (enc.includes('deflate')) payload = zlib.inflateSync(payload);
                } catch { /* keep raw bytes if decompression fails */ }
                resolve({ status, headers: resHeaders, body: payload.toString('utf8'), url: target.abs });
            };

            let finishChunked = false;
            const parseChunked = (buf) => {
                const out = [];
                let i = 0;
                while (i < buf.length) {
                    const nl = buf.indexOf('\r\n', i, 'latin1');
                    if (nl === -1) break;
                    const size = parseInt(buf.toString('latin1', i, nl), 16);
                    if (!Number.isFinite(size)) break;
                    if (size === 0) { finishChunked = true; break; }
                    out.push(buf.subarray(nl + 2, nl + 2 + size));
                    i = nl + 2 + size + 2;
                }
                return Buffer.concat(out);
            };

            const onData = (chunk) => {
                if (!headDone) {
                    raw = Buffer.concat([raw, chunk]);
                    const idx = raw.indexOf('\r\n\r\n', 0, 'latin1');
                    if (idx === -1) return;
                    const headText = raw.toString('latin1', 0, idx);
                    const rest = raw.subarray(idx + 4);
                    raw = Buffer.alloc(0);
                    headDone = true;
                    status = Number(headText.split(' ')[1]);
                    for (const line of headText.split('\r\n').slice(1)) {
                        const c = line.indexOf(':');
                        if (c > 0) resHeaders[line.slice(0, c).trim().toLowerCase()] = line.slice(c + 1).trim();
                    }
                    if (status < 200) return; // 1xx — keep waiting
                    if (String(resHeaders['transfer-encoding'] ?? '').includes('chunked')) {
                        const decoded = parseChunked(rest);
                        if (decoded.length) chunks.push(decoded);
                        if (finishChunked) { sock.end(); finish(); }
                    } else if (rest.length) {
                        chunks.push(rest);
                    }
                    return;
                }
                if (String(resHeaders['transfer-encoding'] ?? '').includes('chunked')) {
                    const decoded = parseChunked(chunk);
                    if (decoded.length) chunks.push(decoded);
                    if (finishChunked) { sock.end(); finish(); }
                } else {
                    chunks.push(chunk);
                }
            };

            sock.on('data', onData);
            sock.on('end', () => { if (headDone) finish(); else reject(new Error('empty response')); });
            sock.on('error', (err) => { signal?.removeEventListener('abort', abort); reject(err); });
            sock.on('timeout', () => { sock.destroy(); reject(new Error('socket timeout')); });
        }).catch(reject);
    });
}

/** GET with redirect following. Returns { status, headers, body, finalUrl }. */
export async function get(url, { headers = BROWSER_HEADERS, proxy = null, timeout = 45_000, signal, maxRedirects = 5 } = {}) {
    let current = url;
    for (let hop = 0; hop <= maxRedirects; hop++) {
        const res = await requestOnce(current, { headers, proxy, timeout, signal });
        const loc = res.headers.location;
        if ([301, 302, 303, 307, 308].includes(res.status) && loc && hop < maxRedirects) {
            current = new URL(loc, current).toString();
            continue;
        }
        return { ...res, finalUrl: current };
    }
    throw new Error('too many redirects');
}

/** POST an URL-encoded/JSON body (used by the Jina reader + studio API helper). */
export async function post(url, { headers = {}, proxy = null, timeout = 45_000, signal, json } = {}) {
    const body = json == null ? '' : JSON.stringify(json);
    const h = { ...headers, ...(json == null ? {} : { 'content-type': 'application/json' }) };
    return requestOnce(url, { headers: h, proxy, timeout, signal, method: 'POST', body });
}
