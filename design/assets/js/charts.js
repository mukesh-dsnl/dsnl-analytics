/* ─────────────────────────────────────────────────────────────────────────
   Chart kit — plain SVG/HTML, no library. Every chart reads its colours from
   CSS variables (var(--chart-n)), so the theme switch recolours them with no
   re-render. Hover readouts go through one tooltip: an element carries
   data-tip="<id>", and the id points at markup registered at render time.
   ───────────────────────────────────────────────────────────────────────── */
(function () {
  const nf = new Intl.NumberFormat('en-US');
  const fmt = (n) => nf.format(Math.round(n || 0));
  function pct(n, d, digits = 1) {
    if (!d) return '0%';
    const p = (n / d) * 100;
    if (p > 0 && p < 0.1) return '<0.1%';
    return `${p.toFixed(digits)}%`;
  }
  function compact(n) {
    if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 1 : 2)}M`;
    if (n >= 1e4) return `${(n / 1e3).toFixed(1)}k`;
    return fmt(n);
  }
  function niceMax(n) {
    if (n <= 0) return 1;
    const base = 10 ** Math.floor(Math.log10(n));
    // Every candidate splits into four round gridline steps (axes draw quarters).
    return ([1, 1.2, 1.6, 2, 2.4, 3.2, 4, 4.8, 6, 8, 10].find((v) => v * base >= n * 1.08) ?? 10) * base;
  }

  // ── Tooltip registry ────────────────────────────────────────────────
  let TIPS = {};
  let seq = 0;
  const CHARTS = {};
  function resetTips() {
    TIPS = {};
    seq = 0;
  }
  function tip(title, rows = [], foot = '') {
    const id = `t${++seq}`;
    TIPS[id] =
      `<div class="chart-tip-title">${title}</div>` +
      rows
        .map(
          (r) =>
            `<div class="chart-tip-row"><span>${r.color ? `<i class="legend-swatch" style="background:${r.color}"></i>` : ''}${r.label}</span><strong>${r.value}</strong></div>`,
        )
        .join('') +
      (foot ? `<div class="chart-tip-row" style="margin-top:4px"><span>${foot}</span></div>` : '');
    return id;
  }

  // ── Line / area chart ───────────────────────────────────────────────
  function lineChart({ id, points, height = 240, color = 'var(--chart-1)', label = 'Peak ports', xFormat = (x) => x }) {
    const W = 760;
    const H = height;
    const pad = { t: 12, r: 12, b: 26, l: 44 };
    const max = niceMax(Math.max(...points.map((p) => p.y), 1));
    const iw = W - pad.l - pad.r;
    const ih = H - pad.t - pad.b;
    const x = (i) => pad.l + (points.length === 1 ? iw / 2 : (i / (points.length - 1)) * iw);
    const y = (v) => pad.t + ih - (v / max) * ih;
    const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * max);
    const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.y).toFixed(1)}`).join('');
    const area = `${line}L${x(points.length - 1).toFixed(1)},${pad.t + ih}L${x(0).toFixed(1)},${pad.t + ih}Z`;
    const every = Math.ceil(points.length / 8);
    const peakIdx = points.reduce((m, p, i) => (p.y > points[m].y ? i : m), 0);
    CHARTS[id] = { points, label, xFormat, color, pad, W, iw };
    return `
      <svg class="chart-svg" viewBox="0 0 ${W} ${H}" style="height:auto" role="img" aria-label="${label} over time, peak ${fmt(points[peakIdx].y)} at ${xFormat(points[peakIdx].x)}">
        ${ticks.map((t) => `<line class="grid" x1="${pad.l}" x2="${W - pad.r}" y1="${y(t)}" y2="${y(t)}"/><text x="${pad.l - 8}" y="${y(t) + 4}" text-anchor="end">${compact(t)}</text>`).join('')}
        ${points.map((p, i) => (i % every === 0 || i === points.length - 1 ? `<text x="${x(i)}" y="${H - 6}" text-anchor="middle">${xFormat(p.x, true)}</text>` : '')).join('')}
        <path d="${area}" fill="var(--chart-area)"/>
        <path d="${line}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
        <g class="peak-marker"><circle cx="${x(peakIdx)}" cy="${y(points[peakIdx].y)}" r="4" fill="var(--color-bg-surface)" stroke="${color}" stroke-width="2" vector-effect="non-scaling-stroke"/></g>
        <g class="hover-layer" style="display:none"><line class="hover-line" x1="0" x2="0" y1="${pad.t}" y2="${pad.t + ih}" vector-effect="non-scaling-stroke"/><circle r="4" fill="${color}" stroke="var(--color-bg-surface)" stroke-width="2" vector-effect="non-scaling-stroke"/></g>
        <rect data-chart="${id}" x="${pad.l}" y="${pad.t}" width="${iw}" height="${ih}" fill="transparent"/>
      </svg>`;
  }

  // ── Donut ───────────────────────────────────────────────────────────
  function donut({ segments, size = 132, thickness = 16, center = '', sub = '' }) {
    const r = (size - thickness) / 2;
    const c = 2 * Math.PI * r;
    const total = segments.reduce((t, s) => t + s.value, 0) || 1;
    let offset = 0;
    const gap = segments.length > 1 ? 2 : 0;
    const arcs = segments
      .map((s) => {
        const len = Math.max(0, (s.value / total) * c - gap);
        const el = `<circle data-tip="${s.tip || ''}" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${s.color}" stroke-width="${thickness}" stroke-dasharray="${len} ${c - len}" stroke-dashoffset="${-offset}" transform="rotate(-90 ${size / 2} ${size / 2})" style="cursor:default"/>`;
        offset += (s.value / total) * c;
        return el;
      })
      .join('');
    return `
      <div style="position:relative;width:${size}px;height:${size}px">
        <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img">
          <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--chart-track)" stroke-width="${thickness}"/>
          ${arcs}
        </svg>
        <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;pointer-events:none">
          <span class="donut-center num">${center}</span>
          <span class="muted" style="font-size:11px">${sub}</span>
        </div>
      </div>`;
  }

  // ── Sparkline ───────────────────────────────────────────────────────
  function sparkline(values, color = 'var(--chart-1)', w = 84, h = 28) {
    const max = Math.max(...values);
    const min = Math.min(...values);
    const pts = values.map((v, i) => `${((i / (values.length - 1)) * w).toFixed(1)},${(h - 2 - ((v - min) / (max - min || 1)) * (h - 4)).toFixed(1)}`);
    return `<svg class="kpi-spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><polyline points="${pts.join(' ')}" fill="none" stroke="${color}" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }

  // ── Horizontal bar list ─────────────────────────────────────────────
  function barList(rows, { colors, total, valueSuffix } = {}) {
    const max = Math.max(...rows.map((r) => r.value), 1);
    const sum = total ?? rows.reduce((t, r) => t + r.value, 0);
    return `<div class="bar-list">${rows
      .map((r, i) => {
        const color = Array.isArray(colors) ? colors[Math.min(i, colors.length - 1)] : colors || 'var(--chart-1)';
        const t = tip(r.label, [{ label: 'Calls', value: fmt(r.value), color }, { label: 'Share', value: pct(r.value, sum) }, ...(r.extra || [])]);
        return `<div class="bar-row" data-tip="${t}">
          <span class="bar-row-label" title="${r.label}">${r.label}</span>
          <span class="bar-row-track"><span style="width:${((r.value / max) * 100).toFixed(1)}%;background:${color}"></span></span>
          <span class="bar-row-value">${fmt(r.value)}<small>${valueSuffix ? valueSuffix(r) : pct(r.value, sum)}</small></span>
        </div>`;
      })
      .join('')}</div>`;
  }

  // ── Vertical bars (reblast stages, duration buckets) ────────────────
  function columns(rows, { color = 'var(--chart-1)', height = 140 } = {}) {
    const max = niceMax(Math.max(...rows.map((r) => r.value), 1));
    return `<div style="display:grid;grid-template-columns:repeat(${rows.length},1fr);gap:12px;align-items:end;height:${height + 36}px">
      ${rows
        .map((r, i) => {
          const c = Array.isArray(color) ? color[i % color.length] : color;
          const t = tip(r.label, [{ label: 'Calls', value: fmt(r.value), color: c }]);
          return `<div data-tip="${t}" style="display:flex;flex-direction:column;align-items:center;gap:6px;height:100%;justify-content:flex-end">
            <span class="num" style="font-size:12px;font-weight:500">${compact(r.value)}</span>
            <span style="width:100%;max-width:56px;height:${Math.max(3, (r.value / max) * height)}px;background:${c};border-radius:6px 6px 2px 2px"></span>
            <span class="muted" style="font-size:11px;white-space:nowrap">${r.label}</span>
          </div>`;
        })
        .join('')}
    </div>`;
  }

  // ── Global tooltip behaviour ────────────────────────────────────────
  let tipEl;
  function ensureTip() {
    if (!tipEl) {
      tipEl = document.createElement('div');
      tipEl.className = 'chart-tip';
      tipEl.style.display = 'none';
      tipEl.setAttribute('role', 'tooltip');
      document.body.appendChild(tipEl);
    }
    return tipEl;
  }
  function place(e) {
    const el = ensureTip();
    const pad = 14;
    let left = e.clientX + pad;
    let top = e.clientY + pad;
    const r = el.getBoundingClientRect();
    if (left + r.width > window.innerWidth - 8) left = e.clientX - r.width - pad;
    if (top + r.height > window.innerHeight - 8) top = e.clientY - r.height - pad;
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }
  document.addEventListener('mousemove', (e) => {
    const el = ensureTip();
    const chartRect = e.target.closest && e.target.closest('[data-chart]');
    if (chartRect) {
      const cfg = CHARTS[chartRect.dataset.chart];
      const svg = chartRect.ownerSVGElement;
      const box = svg.getBoundingClientRect();
      const sx = ((e.clientX - box.left) / box.width) * cfg.W;
      const n = cfg.points.length;
      const i = Math.max(0, Math.min(n - 1, Math.round(((sx - cfg.pad.l) / cfg.iw) * (n - 1))));
      const p = cfg.points[i];
      const layer = svg.querySelector('.hover-layer');
      const line = layer.querySelector('line');
      const dot = layer.querySelector('circle');
      const px = cfg.pad.l + (n === 1 ? cfg.iw / 2 : (i / (n - 1)) * cfg.iw);
      const peakPath = svg.querySelectorAll('path')[1];
      line.setAttribute('x1', px);
      line.setAttribute('x2', px);
      const ys = peakPath.getAttribute('d').split(/[ML]/).filter(Boolean)[i].split(',')[1];
      dot.setAttribute('cx', px);
      dot.setAttribute('cy', ys);
      layer.style.display = '';
      el.innerHTML = `<div class="chart-tip-title">${cfg.xFormat(p.x)}</div><div class="chart-tip-row"><span><i class="legend-swatch" style="background:${cfg.color}"></i>${cfg.label}</span><strong>${fmt(p.y)}</strong></div>`;
      el.style.display = 'block';
      place(e);
      return;
    }
    document.querySelectorAll('.hover-layer').forEach((l) => (l.style.display = 'none'));
    const t = e.target.closest && e.target.closest('[data-tip]');
    if (t && TIPS[t.dataset.tip]) {
      el.innerHTML = TIPS[t.dataset.tip];
      el.style.display = 'block';
      place(e);
    } else {
      el.style.display = 'none';
    }
  });
  document.addEventListener('scroll', () => tipEl && (tipEl.style.display = 'none'), true);

  window.Charts = { fmt, pct, compact, niceMax, tip, resetTips, lineChart, donut, sparkline, barList, columns };
})();
