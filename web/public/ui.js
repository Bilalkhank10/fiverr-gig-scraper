/** Tiny DOM + formatting helpers (no framework, no build step). */

/** Hyperscript: h('div', {class:'x', onclick:fn}, child, 'text') */
export function h(tag, props = null, ...children) {
    const el = document.createElement(tag);
    if (props) {
        for (const [k, v] of Object.entries(props)) {
            if (v == null || v === false) continue;
            if (k === 'class') el.className = v;
            else if (k === 'html') el.innerHTML = v;
            else if (k === 'text') el.textContent = v;
            else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
            else if (k === 'dataset') Object.assign(el.dataset, v);
            else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
            else if (k in el && k !== 'list') el[k] = v;
            else el.setAttribute(k, v);
        }
    }
    append(el, children);
    return el;
}

function append(el, children) {
    for (const c of children.flat(4)) {
        if (c == null || c === false || c === true) continue;
        el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
}

export const frag = (...children) => { const f = document.createDocumentFragment(); append(f, children); return f; };
export const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Inline SVG icon from the sprite. */
export function icon(name, cls = '') {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', `i ${cls}`.trim());
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', `#i-${name}`);
    svg.append(use);
    return svg;
}

/* ------------------------------- formatting ------------------------------- */
export const num = (v, opts) => (v == null || Number.isNaN(v) ? '—' : Number(v).toLocaleString('en-US', opts));
export const compact = (v) => {
    if (v == null || Number.isNaN(v)) return '—';
    const n = Number(v);
    if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`;
    if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}k`;
    return String(Math.round(n * 100) / 100);
};
export const money = (v, { compact: c = false } = {}) => {
    if (v == null || Number.isNaN(v)) return '—';
    const n = Number(v);
    if (c && Math.abs(n) >= 1000) return `$${compact(n)}`;
    return `$${n >= 100 ? Math.round(n).toLocaleString('en-US') : n.toFixed(Number.isInteger(n) ? 0 : 2)}`;
};
export const duration = (ms) => {
    if (ms == null) return '—';
    const s = Math.round(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ${s % 60}s`;
    return `${Math.floor(m / 60)}h ${m % 60}m`;
};
export function timeAgo(ts) {
    if (!ts) return '—';
    const d = Date.now() - Number(ts);
    const s = Math.round(d / 1000);
    if (s < 10) return 'just now';
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    if (s < 604800) return `${Math.floor(s / 86400)}d ago`;
    return new Date(Number(ts)).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
export const truncate = (s, n = 60) => (s && s.length > n ? `${s.slice(0, n - 1)}…` : s ?? '');

const FLAG_OFFSET = 127397;
export const flag = (cc) => {
    if (!cc || cc.length !== 2 || !/^[A-Za-z]{2}$/.test(cc)) return '🌐';
    return String.fromCodePoint(...[...cc.toUpperCase()].map((c) => c.charCodeAt(0) + FLAG_OFFSET));
};

export const LEVELS = {
    top_rated_seller: { label: 'Top Rated', cls: 'gold' },
    level_two_seller: { label: 'Level 2', cls: 'violet' },
    level_one_seller: { label: 'Level 1', cls: 'blue' },
    new_seller: { label: 'New seller', cls: 'gray' },
    no_level: { label: 'New seller', cls: 'gray' },
};
export const levelInfo = (lvl) => LEVELS[lvl] ?? { label: (lvl ?? 'seller').replace(/_/g, ' '), cls: 'gray' };

export function stars(rating, { cls = '' } = {}) {
    const wrap = h('span', { class: `stars ${cls}`.trim() });
    const full = Math.round(Number(rating) || 0);
    for (let i = 1; i <= 5; i++) wrap.append(icon('star', i <= full ? '' : 'off'));
    return wrap;
}

export const slug = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

/* --------------------------------- toast ---------------------------------- */
export function toast(message, type = 'ok', timeout = 3800) {
    const host = document.getElementById('toasts');
    const el = h('div', { class: `toast ${type}` }, icon(type === 'err' ? 'x' : 'check'), h('span', {}, message));
    host.append(el);
    setTimeout(() => {
        el.style.transition = 'opacity .3s, transform .3s';
        el.style.opacity = '0';
        el.style.transform = 'translateX(20px)';
        setTimeout(() => el.remove(), 320);
    }, timeout);
}

export async function copy(text, label = 'Copied to clipboard') {
    try {
        await navigator.clipboard.writeText(text);
        toast(label);
    } catch {
        toast('Clipboard blocked by the browser', 'err');
    }
}

/* --------------------------------- drawer --------------------------------- */
let drawerOpen = false;
export function openDrawer(content, { title, subtitle } = {}) {
    const host = document.getElementById('drawerHost');
    clear(host);
    const close = () => {
        host.classList.remove('open');
        drawerOpen = false;
        setTimeout(() => clear(host), 400);
        document.removeEventListener('keydown', onKey);
    };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    host.append(
        h('div', { class: 'drawer-scrim', onclick: close }),
        h('aside', { class: 'drawer' },
            h('header', { class: 'drawer-head' },
                h('div', { style: { display: 'flex', flexDirection: 'column', gap: '3px', minWidth: 0 } },
                    h('strong', { style: { fontSize: '14.5px' } }, title ?? 'Details'),
                    subtitle ? h('span', { class: 'tiny faint truncate' }, subtitle) : null),
                h('span', { class: 'spacer' }),
                h('button', { class: 'icon-btn', onclick: close, title: 'Close' }, icon('x'))),
            h('div', { class: 'drawer-body' }, content)),
    );
    requestAnimationFrame(() => { host.classList.add('open'); drawerOpen = true; });
    return close;
}
export const isDrawerOpen = () => drawerOpen;

/* ------------------------------ tiny markdown ----------------------------- */
const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Minimal, safe markdown renderer — escapes HTML first, then applies md rules. */
export function markdown(src) {
    const lines = escapeHtml(src ?? '').split('\n');
    const out = [];
    let inCode = false;
    let inList = null;
    let inTable = false;

    const inline = (s) => s
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>')
        .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
        .replace(/(^|\s)(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');

    const closeList = () => { if (inList) { out.push(`</${inList}>`); inList = null; } };
    const closeTable = () => { if (inTable) { out.push('</tbody></table>'); inTable = false; } };

    for (const line of lines) {
        if (line.trim().startsWith('```')) {
            closeList(); closeTable();
            out.push(inCode ? '</code></pre>' : '<pre class="code"><code>');
            inCode = !inCode;
            continue;
        }
        if (inCode) { out.push(`${line}\n`); continue; }

        const tableRow = /^\s*\|(.+)\|\s*$/.exec(line);
        if (tableRow && !/^\s*\|[\s:|-]+\|\s*$/.test(line)) {
            closeList();
            const cells = tableRow[1].split('|').map((c) => inline(c.trim()));
            if (!inTable) { out.push('<table><thead><tr>'); out.push(cells.map((c) => `<th>${c}</th>`).join('')); out.push('</tr></thead><tbody>'); inTable = true; }
            else out.push(`<tr>${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`);
            continue;
        }
        if (/^\s*\|[\s:|-]+\|\s*$/.test(line)) continue;
        closeTable();

        const heading = /^(#{1,4})\s+(.*)$/.exec(line);
        if (heading) { closeList(); out.push(`<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`); continue; }

        const li = /^\s*(?:[-*+]|\d+\.)\s+(.*)$/.exec(line);
        if (li) {
            if (!inList) { inList = 'ul'; out.push('<ul>'); }
            out.push(`<li>${inline(li[1])}</li>`);
            continue;
        }
        closeList();

        if (/^\s*(---|___|\*\*\*)\s*$/.test(line)) { out.push('<hr/>'); continue; }
        if (/^\s*>\s?/.test(line)) { out.push(`<blockquote>${inline(line.replace(/^\s*>\s?/, ''))}</blockquote>`); continue; }
        if (!line.trim()) { out.push(''); continue; }
        out.push(`<p>${inline(line)}</p>`);
    }
    closeList(); closeTable();
    if (inCode) out.push('</code></pre>');
    return out.join('\n');
}

/** Syntax-highlight-ish JSON for <pre class="code">. */
export function prettyJson(value) {
    const json = JSON.stringify(value, null, 2) ?? 'null';
    return json
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/"([^"]+)":/g, '<span class="k">"$1"</span>:')
        .replace(/: "([^"]*)"/g, ': <span class="s">"$1"</span>')
        .replace(/: (-?\d+\.?\d*)/g, ': <span class="n">$1</span>')
        .replace(/: (true|false|null)/g, ': <span class="k">$1</span>');
}

/** Attach a pointer-following spotlight to cards. */
export function spotlight(root = document) {
    root.querySelectorAll('.gig, .kpi').forEach((el) => {
        el.addEventListener('pointermove', (e) => {
            const r = el.getBoundingClientRect();
            el.style.setProperty('--mx', `${e.clientX - r.left}px`);
            el.style.setProperty('--my', `${e.clientY - r.top}px`);
        }, { passive: true });
    });
}
