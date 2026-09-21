/** Hand-rolled SVG charts — crisp, dependency-free, themed by CSS variables. */
import { h } from './ui.js';

const NS = 'http://www.w3.org/2000/svg';
const svgEl = (tag, attrs = {}) => {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
    return el;
};

/**
 * Vertical bar chart. data: [{ label, value }]
 * Bars + gridlines live in a stretched SVG; labels are real HTML underneath so the
 * type stays crisp instead of being scaled by the viewBox.
 */
export function barChart(data, { height = 150, color = 'var(--accent)', alt = 'var(--violet)', format = (v) => v, showGrid = true } = {}) {
    const w = 100, padT = 12;
    const max = Math.max(1, ...data.map((d) => d.value));
    const step = w / Math.max(data.length, 1);
    const bw = Math.min(step * 0.62, 16);
    const plotH = height - padT - 4;
    const svg = svgEl('svg', { class: 'chart', viewBox: `0 0 100 ${height}`, preserveAspectRatio: 'none', style: `height:${height}px;width:100%` });

    if (showGrid) {
        for (const frac of [0, 0.5, 1]) {
            const y = padT + plotH * (1 - frac);
            svg.append(svgEl('line', { class: 'grid-line', x1: 0, x2: 100, y1: y, y2: y, 'vector-effect': 'non-scaling-stroke' }));
        }
    }
    data.forEach((d, i) => {
        const bh = Math.max(1.5, (d.value / max) * plotH);
        const x = i * step + (step - bw) / 2;
        const y = padT + plotH - bh;
        const rect = svgEl('rect', { x, y, width: bw, height: bh, rx: Math.min(3, bw / 2), fill: i % 2 ? alt : color });
        const title = svgEl('title');
        title.textContent = `${d.label}: ${format(d.value)}`;
        rect.append(title);
        svg.append(rect);
    });

    const labels = h('div', { class: 'chart-x' });
    data.forEach((d) => labels.append(h('span', { title: `${d.label}: ${format(d.value)}` }, d.label)));
    return h('div', { class: 'chart-wrap' }, svg, labels);
}

/** Smooth sparkline for run history. */
export function sparkline(values, { height = 44, color = 'var(--accent)', fill = true } = {}) {
    const svg = svgEl('svg', { class: 'chart', viewBox: `0 0 100 ${height}`, preserveAspectRatio: 'none', style: `height:${height}px;width:100%` });
    if (!values.length) return svg;
    const max = Math.max(1, ...values);
    const step = 100 / Math.max(values.length - 1, 1);
    const pts = values.map((v, i) => [i * step, height - 6 - (v / max) * (height - 14)]);
    const path = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
    if (fill && pts.length > 1) {
        const uid = `sp${Math.random().toString(36).slice(2, 7)}`;
        const grad = svgEl('linearGradient', { id: uid, x1: 0, y1: 0, x2: 0, y2: 1 });
        grad.append(svgEl('stop', { offset: '0%', 'stop-color': 'rgba(25,195,125,0.35)' }));
        grad.append(svgEl('stop', { offset: '100%', 'stop-color': 'rgba(25,195,125,0)' }));
        const defs = svgEl('defs'); defs.append(grad); svg.append(defs);
        svg.append(svgEl('path', { d: `${path} L100,${height} L0,${height} Z`, fill: `url(#${uid})`, stroke: 'none' }));
    }
    svg.append(svgEl('path', { class: 'spark', d: path, stroke: color, 'vector-effect': 'non-scaling-stroke' }));
    return svg;
}

/** Progress / KPI ring. */
export function ring(percent, { size = 132, thickness = 10, label = 'progress' } = {}) {
    const r = (size - thickness) / 2;
    const c = 2 * Math.PI * r;
    const pct = Math.max(0, Math.min(100, percent));
    const svg = svgEl('svg', { width: size, height: size, viewBox: `0 0 ${size} ${size}` });
    const uid = `rg${Math.random().toString(36).slice(2, 7)}`;
    const defs = svgEl('defs');
    const grad = svgEl('linearGradient', { id: uid, x1: '0', y1: '0', x2: '1', y2: '1' });
    grad.append(svgEl('stop', { offset: '0%', 'stop-color': '#4ceaa5' }));
    grad.append(svgEl('stop', { offset: '60%', 'stop-color': '#19c37d' }));
    grad.append(svgEl('stop', { offset: '100%', 'stop-color': '#0f9d63' }));
    defs.append(grad); svg.append(defs);
    svg.append(svgEl('circle', { class: 'track', cx: size / 2, cy: size / 2, r, fill: 'none', 'stroke-width': thickness }));
    const fillCircle = svgEl('circle', {
        class: 'fill', cx: size / 2, cy: size / 2, r, fill: 'none', 'stroke-width': thickness,
        'stroke-dasharray': c, 'stroke-dashoffset': c * (1 - pct / 100), 'stroke-linecap': 'round',
    });
    fillCircle.style.stroke = `url(#${uid})`;
    svg.append(fillCircle);

    const wrap = h('div', { class: 'ring' });
    wrap.append(svg, h('div', { class: 'center' }, h('b', { id: 'ringVal' }, `${Math.round(pct)}%`), h('span', {}, label)));
    wrap.update = (next, text) => {
        const p = Math.max(0, Math.min(100, next));
        fillCircle.setAttribute('stroke-dashoffset', c * (1 - p / 100));
        const val = wrap.querySelector('#ringVal');
        val.textContent = text ?? `${Math.round(p)}%`;
    };
    wrap.spin = (on) => wrap.classList.toggle('spin', Boolean(on));
    return wrap;
}

/** Donut chart with centre total. data: [{ label, value, color }] */
export function donut(data, { size = 168, thickness = 18, centerLabel = 'total' } = {}) {
    const total = data.reduce((a, d) => a + d.value, 0) || 1;
    const r = (size - thickness) / 2;
    const c = 2 * Math.PI * r;
    const svg = svgEl('svg', { width: size, height: size, viewBox: `0 0 ${size} ${size}` });
    svg.append(svgEl('circle', { cx: size / 2, cy: size / 2, r, fill: 'none', 'stroke-width': thickness, stroke: 'var(--surface-2)' }));
    let offset = 0;
    data.forEach((d) => {
        const len = (d.value / total) * c;
        const arc = svgEl('circle', {
            cx: size / 2, cy: size / 2, r, fill: 'none', 'stroke-width': thickness, stroke: d.color,
            'stroke-dasharray': `${len} ${c - len}`, 'stroke-dashoffset': -offset, 'stroke-linecap': 'butt',
            transform: `rotate(-90 ${size / 2} ${size / 2})`,
        });
        const title = svgEl('title');
        title.textContent = `${d.label}: ${d.value} (${Math.round((d.value / total) * 100)}%)`;
        arc.append(title);
        svg.append(arc);
        offset += len;
    });
    const wrap = h('div', { class: 'ring', style: { width: `${size}px`, height: `${size}px` } });
    wrap.append(svg, h('div', { class: 'center' }, h('b', {}, String(total)), h('span', {}, centerLabel)));
    return wrap;
}
