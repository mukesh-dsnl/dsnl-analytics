/* ─────────────────────────────────────────────────────────────────────────
   Component builders — each returns markup for one component in the style
   guide. Screens (screens.js) and the style guide (styleguide.js) both
   build from these, so a component changes in one place.

   Interaction is declarative: an element with data-action="name" (and an
   optional data-arg) is handled by the delegate in app.js.
   ───────────────────────────────────────────────────────────────────────── */
(function () {
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const attrs = (o = {}) =>
    Object.entries(o)
      .filter(([, v]) => v !== undefined && v !== null && v !== false)
      .map(([k, v]) => (v === true ? k : `${k}="${esc(v)}"`))
      .join(' ');

  // ── Button ──────────────────────────────────────────────────────────
  function btn({ label = '', icon: ic, iconRight, variant = 'secondary', size, action, arg, block, disabled, title, type = 'button', id, loading, extra = {} } = {}) {
    const cls = ['btn', `btn-${variant}`, size && `btn-${size}`, !label && 'btn-icon', block && 'btn-block'].filter(Boolean).join(' ');
    return `<button ${attrs({ type, class: cls, 'data-action': action, 'data-arg': arg, disabled, title: title || (!label ? undefined : undefined), 'aria-label': !label ? title : undefined, id, ...extra })}>${loading ? '<span class="spinner"></span>' : ic ? icon(ic) : ''}${label ? `<span>${label}</span>` : ''}${iconRight ? icon(iconRight, 'icon-sm') : ''}</button>`;
  }

  // ── Badge ───────────────────────────────────────────────────────────
  const STATUS_TONE = { Delivered: 'success', Active: 'success', Ready: 'success', Running: 'info', Queued: 'neutral', Failed: 'danger', Paused: 'warning', Replaced: 'neutral', Processing: 'info' };
  function badge(text, tone = STATUS_TONE[text] || 'neutral', dot = true) {
    const cls = tone === 'neutral' ? 'badge' : `badge badge-${tone}`;
    return `<span class="${cls}">${dot ? '<span class="dot"></span>' : ''}${esc(text)}</span>`;
  }

  // ── Sidebar navigation item ─────────────────────────────────────────
  function navItem({ label, icon: ic, href, active, badge: b, chevron, action, arg, title }) {
    const tag = href ? 'a' : 'button';
    const a = href ? { href } : { type: 'button', 'data-action': action, 'data-arg': arg };
    return `<${tag} ${attrs({ class: `nav-item${active ? ' is-active' : ''}`, 'aria-current': active ? 'page' : undefined, title: title || label, ...a })}>
      ${ic ? icon(ic) : ''}<span class="nav-label">${esc(label)}</span>
      ${b ? `<span class="nav-badge">${b}</span>` : ''}
      ${chevron ? icon('chevron-right', 'icon-sm nav-chevron') : ''}
    </${tag}>`;
  }

  // ── KPI card ────────────────────────────────────────────────────────
  const TONES = {
    blue: ['var(--chart-1)', 'color-mix(in srgb, var(--chart-1) 14%, transparent)'],
    violet: ['var(--chart-2)', 'color-mix(in srgb, var(--chart-2) 14%, transparent)'],
    teal: ['var(--chart-3)', 'color-mix(in srgb, var(--chart-3) 14%, transparent)'],
    amber: ['var(--chart-4)', 'color-mix(in srgb, var(--chart-4) 16%, transparent)'],
    rose: ['var(--chart-5)', 'color-mix(in srgb, var(--chart-5) 14%, transparent)'],
  };
  function kpi({ label, icon: ic, value, unit, meta, bar, tone = 'blue', spark, tipId }) {
    const [ink, tint] = TONES[tone];
    return `<div class="card kpi" style="--kpi-ink:${ink};--kpi-tint:${tint};--kpi-bar:${ink}" ${tipId ? `data-tip="${tipId}"` : ''}>
      <div class="kpi-head"><span class="kpi-label"><span class="kpi-icon">${icon(ic)}</span>${esc(label)}</span>${btn({ icon: 'info', variant: 'ghost', size: 'sm', title: `About ${label}` })}</div>
      <div class="kpi-value">${value}${unit ? `<span class="kpi-unit">${unit}</span>` : ''}</div>
      ${bar !== undefined ? `<div class="kpi-bar"><span style="width:${Math.max(0, Math.min(100, bar))}%"></span></div>` : ''}
      <div class="kpi-meta">${meta}</div>
      ${spark || ''}
    </div>`;
  }
  function kpiSkeleton() {
    return `<div class="card kpi" aria-busy="true"><div class="kpi-head"><span class="kpi-label"><span class="skeleton" style="width:28px;height:28px;border-radius:8px"></span><span class="skeleton sk-line" style="width:96px"></span></span></div>
      <div class="skeleton sk-kpi"></div><div class="skeleton" style="height:4px"></div><div class="skeleton sk-line" style="width:70%"></div></div>`;
  }

  // ── Chart card ──────────────────────────────────────────────────────
  function chartCard({ title, subtitle, body, footer, cls = '', actions = true, extraActions = '', id }) {
    return `<section class="card chart-card ${cls}" ${id ? `id="${id}"` : ''} aria-label="${esc(title)}">
      <header class="card-header"><div><h3 class="card-title">${esc(title)}</h3>${subtitle ? `<p class="card-subtitle">${subtitle}</p>` : ''}</div>
        ${actions ? `<div class="card-actions">${extraActions}${btn({ icon: 'download', variant: 'ghost', size: 'sm', title: 'Download CSV', action: 'toast', arg: `${title} exported as CSV` })}${btn({ icon: 'maximize', variant: 'ghost', size: 'sm', title: 'Expand', action: 'toast', arg: 'Expanded view opens as a full-screen panel' })}</div>` : ''}
      </header>
      <div class="card-body">${body}</div>
      ${footer ? `<footer class="card-footer">${footer}</footer>` : ''}
    </section>`;
  }
  function chartSkeleton({ title = true, height = 180, cls = '' } = {}) {
    return `<section class="card chart-card ${cls}" aria-busy="true"><header class="card-header"><div style="flex:1">${title ? '<div class="skeleton sk-title"></div><div class="skeleton sk-line" style="width:60%;margin-top:8px"></div>' : ''}</div></header>
      <div class="card-body"><div class="skeleton" style="height:${height}px;border-radius:8px"></div></div></section>`;
  }
  function legend(items) {
    return `<div class="chart-legend">${items.map((i) => `<span class="legend-item"><i class="legend-swatch" style="background:${i.color}"></i>${esc(i.label)}${i.value ? ` <strong class="num" style="color:var(--color-text-primary);font-weight:500">${i.value}</strong>` : ''}</span>`).join('')}</div>`;
  }

  // ── Tab bar ─────────────────────────────────────────────────────────
  function tabs(items, active, action = 'tab') {
    return `<nav class="tabs" role="tablist">${items
      .map((t) =>
        t === '|'
          ? '<span class="tab-sep" aria-hidden="true"></span>'
          : `<button type="button" role="tab" aria-selected="${t.id === active}" class="tab${t.id === active ? ' is-active' : ''}" data-action="${action}" data-arg="${t.id}">${t.icon ? icon(t.icon, 'icon-sm') : ''}${esc(t.label)}${t.count !== undefined ? `<span class="tab-count">${t.count}</span>` : ''}</button>`,
      )
      .join('')}</nav>`;
  }
  function segmented(items, active, action) {
    return `<div class="segmented" role="radiogroup">${items.map((i) => `<button type="button" role="radio" aria-checked="${i.id === active}" class="${i.id === active ? 'is-active' : ''}" data-action="${action}" data-arg="${i.id}">${esc(i.label)}</button>`).join('')}</div>`;
  }

  // ── Date picker ─────────────────────────────────────────────────────
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const SHORT = (iso) => new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const SHORT_NY = (iso) => new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  function rangeLabel(from, to) {
    if (from === to) return SHORT(from);
    return `${SHORT_NY(from)} – ${SHORT(to)}`;
  }
  function dateTrigger({ from, to, preset, open, single }) {
    return `<button type="button" class="date-trigger" data-action="toggle-pop" data-arg="date" aria-haspopup="dialog" aria-expanded="${!!open}">
      ${icon('calendar')}${preset ? `<span class="date-preset">${esc(preset)}</span>` : ''}<span class="num">${single ? SHORT(from) : rangeLabel(from, to)}</span>${icon('chevron-down', 'icon-sm')}</button>`;
  }
  function calendarMonth(year, month, { from, to, min, max, today }) {
    const first = new Date(year, month, 1);
    const startDow = (first.getDay() + 6) % 7; // Monday first
    const days = new Date(year, month + 1, 0).getDate();
    const cells = [];
    for (let i = 0; i < startDow; i++) cells.push('<span class="cal-day is-out"></span>');
    for (let d = 1; d <= days; d++) {
      const iso = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const cls = ['cal-day'];
      if (iso < min || iso > max) cls.push('is-unavailable');
      if (iso >= from && iso <= to) cls.push('in-range');
      if (iso === from) cls.push('range-start');
      if (iso === to) cls.push('range-end');
      if (iso === today) cls.push('is-today');
      cells.push(`<button type="button" class="${cls.join(' ')}" data-action="pick-day" data-arg="${iso}"><span>${d}</span></button>`);
    }
    return `<div><div class="cal-head"><span>${MONTHS[month]} ${year}</span></div>
      <div class="cal-grid">${['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((d) => `<span class="cal-dow">${d}</span>`).join('')}${cells.join('')}</div></div>`;
  }
  function datePopover({ from, to, preset, min, max, today, single, presets }) {
    return `<div class="popover align-right date-pop" role="dialog" aria-label="Choose dates">
      <div class="date-presets">
        <div class="menu-label">${single ? 'Day' : 'Quick ranges'}</div>
        ${presets.map((p) => `<button type="button" class="menu-item${p.label === preset ? ' is-selected' : ''}" data-action="preset" data-arg="${p.label}">${p.label === preset ? icon('check', 'icon-sm') : '<span style="width:14px"></span>'}${p.label}</button>`).join('')}
      </div>
      <div class="date-cal">
        <div style="display:flex;justify-content:space-between;align-items:center;margin:-4px 0 4px">${btn({ icon: 'chevron-left', variant: 'ghost', size: 'sm', title: 'Previous month' })}${btn({ icon: 'chevron-right', variant: 'ghost', size: 'sm', title: 'Next month' })}</div>
        <div class="cal-months">${calendarMonth(2026, 8, { from, to, min, max, today })}${calendarMonth(2026, 9, { from, to, min, max, today })}</div>
      </div>
      <div class="date-foot"><span>${icon('database', 'icon-sm')} Data available ${SHORT_NY(min)} – ${SHORT(max)}${single ? '' : ' · max 31 days'}</span>
        <span style="display:flex;gap:8px">${btn({ label: 'Cancel', variant: 'ghost', size: 'sm', action: 'close-pop' })}${btn({ label: 'Apply', variant: 'primary', size: 'sm', action: 'close-pop' })}</span></div>
    </div>`;
  }

  // ── Filter dropdown ─────────────────────────────────────────────────
  function filterTrigger({ label, value, id, open }) {
    return `<button type="button" class="filter-trigger${value ? ' is-set' : ''}" data-action="toggle-pop" data-arg="${id}" aria-expanded="${!!open}">
      ${icon(value ? 'filter' : 'plus', 'icon-sm')}${esc(label)}${value ? `<span class="muted">is</span><span class="filter-value">${esc(value)}</span>` : ''}${icon('chevron-down', 'icon-sm')}</button>`;
  }

  // ── Table ───────────────────────────────────────────────────────────
  function table({ cols, rows, sort }) {
    return `<div class="table-wrap"><table class="table"><thead><tr>${cols
      .map((c) => {
        const sorted = sort && sort.key === c.key;
        return `<th class="${[c.align === 'right' && 'ta-r', c.sortable && 'sortable', sorted && 'is-sorted'].filter(Boolean).join(' ')}" ${c.sortable ? `data-action="sort" data-arg="${c.key}"` : ''} ${c.width ? `style="width:${c.width}"` : ''}>${esc(c.label)}${c.sortable ? `<span class="sort">${icon(sorted ? (sort.dir === 'asc' ? 'chevron-up' : 'chevron-down') : 'chevrons-up-down', 'icon-sm')}</span>` : ''}</th>`;
      })
      .join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
  }
  function tableSkeleton(rows = 6, cols = 6) {
    const r = Array.from({ length: rows }, () => `<tr>${Array.from({ length: cols }, (_, i) => `<td><div class="skeleton sk-line" style="width:${i === 0 ? 70 : 40 + ((i * 13) % 40)}%"></div></td>`).join('')}</tr>`);
    return `<div class="table-wrap"><table class="table" aria-busy="true"><thead><tr>${Array.from({ length: cols }, () => '<th><div class="skeleton sk-line" style="width:60px;height:8px"></div></th>').join('')}</tr></thead><tbody>${r.join('')}</tbody></table></div>`;
  }
  function meter(pctValue) {
    const tone = pctValue >= 70 ? 'var(--chart-positive)' : pctValue >= 62 ? 'var(--chart-4)' : 'var(--chart-negative)';
    return `<span class="meter"><span class="meter-track"><span style="width:${pctValue}%;background:${tone}"></span></span><span class="num">${pctValue.toFixed(1)}%</span></span>`;
  }

  // ── Upload box ──────────────────────────────────────────────────────
  function uploadBox({ error, compact } = {}) {
    return `<label class="upload-box${error ? ' is-error' : ''}" data-drop="upload" ${compact ? 'style="padding:28px 24px"' : ''}>
      <input type="file" accept=".parquet" data-action="file-picked">
      <span class="upload-icon">${icon('cloud-upload', 'icon-xl')}</span>
      <span class="upload-title">Drop a Parquet file here, or <span style="color:var(--color-text-link)">browse</span></span>
      <span class="upload-hint">.parquet only · up to 5 GB · CDR and CODR columns in one file</span>
      ${btn({ label: 'Choose file', icon: 'file', variant: 'secondary', action: 'browse' })}
    </label>`;
  }

  // ── Chat bubble ─────────────────────────────────────────────────────
  function bubble(m, i = 0) {
    if (m.role === 'user') {
      return `<div class="msg msg-user"><div><div class="bubble">${esc(m.text)}</div><div class="msg-meta" style="justify-content:flex-end">${m.time || ''}</div></div></div>`;
    }
    const steps = m.steps;
    return `<div class="msg msg-ai"><span class="avatar avatar-ai">${icon('sparkles', 'icon-sm')}</span><div class="bubble">
      ${steps ? `<div class="thinking">${steps.map((s) => `<div class="thinking-row${s.done ? '' : ' is-active'}">${s.done ? icon('check', 'icon-sm') : '<span class="spinner"></span>'}<span>${s.label}</span></div>`).join('')}</div>` : ''}
      ${m.error ? `<div class="banner banner-danger">${icon('alert-triangle')}<div class="banner-body"><div class="banner-title">The assistant couldn't answer that</div><p>The CDR query timed out after 60 s. Try a shorter date range.</p></div><div class="banner-actions">${btn({ label: 'Retry', icon: 'refresh', size: 'sm', action: 'chat-retry' })}</div></div>` : ''}
      ${m.html || ''}
      ${m.table ? `<div class="answer-table">${table({ cols: m.table.cols.map((c, j) => ({ label: c, align: j ? 'right' : 'left' })), rows: m.table.rows.map((r) => `<tr>${r.map((c, j) => `<td class="${j ? 'ta-r' : 'cell-strong'}">${c}</td>`).join('')}</tr>`) })}</div>` : ''}
      ${m.query ? `<span class="query-pill">${icon('database', 'icon-sm')}${esc(m.query)}</span>` : ''}
      ${m.html ? `<div class="msg-meta">${m.time || ''}${m.took ? ` · answered in ${m.took}` : ''}${btn({ icon: 'copy', variant: 'ghost', size: 'sm', title: 'Copy answer', action: 'toast', arg: 'Answer copied' })}${btn({ icon: 'file-spreadsheet', variant: 'ghost', size: 'sm', title: 'Export table as Excel', action: 'toast', arg: 'Table exported as .xlsx' })}</div>` : ''}
    </div></div>`;
  }

  // ── State panels ────────────────────────────────────────────────────
  function state({ icon: ic = 'inbox', tone = '', title, desc, actions = '', code = '', card = true, compact }) {
    const inner = `<div class="state" ${compact ? 'style="padding:40px 24px"' : ''}><span class="state-icon ${tone ? `is-${tone}` : ''}">${icon(ic, 'icon-xl')}</span><h3 class="state-title">${title}</h3><p class="state-desc">${desc}</p>${code ? `<code class="state-code">${code}</code>` : ''}${actions ? `<div class="state-actions">${actions}</div>` : ''}</div>`;
    return card ? `<div class="card">${inner}</div>` : inner;
  }
  function banner({ tone = 'info', icon: ic, title, body = '', actions = '' }) {
    const defaults = { info: 'info', warning: 'alert-triangle', danger: 'alert-circle', success: 'check-circle' };
    return `<div class="banner banner-${tone}" role="${tone === 'danger' ? 'alert' : 'status'}">${icon(ic || defaults[tone], 'icon-lg')}<div class="banner-body"><div class="banner-title">${title}</div>${body ? `<p>${body}</p>` : ''}</div>${actions ? `<div class="banner-actions">${actions}</div>` : ''}</div>`;
  }

  window.UI = {
    esc, attrs, btn, badge, navItem, kpi, kpiSkeleton, chartCard, chartSkeleton, legend, tabs, segmented,
    dateTrigger, datePopover, rangeLabel, SHORT, SHORT_NY, filterTrigger, table, tableSkeleton, meter, uploadBox, bubble, state, banner,
  };
})();
