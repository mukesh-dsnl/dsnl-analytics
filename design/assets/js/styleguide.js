/* Style guide — foundations and every reusable component, rendered from the
   same builders the prototype uses (ui.js, charts.js). */
(function () {
  const { btn, badge } = UI;
  const theme = (() => {
    try {
      return JSON.parse(localStorage.getItem('dsnl-proto:theme')) || 'light';
    } catch {
      return 'light';
    }
  })();
  document.documentElement.dataset.theme = theme;

  const SEMANTIC = [
    ['Backgrounds', ['bg-canvas', 'bg-sidebar', 'bg-surface', 'bg-surface-raised', 'bg-subtle', 'bg-hover', 'bg-selected', 'bg-inverse', 'bg-skeleton']],
    ['Borders', ['border-default', 'border-subtle', 'border-strong', 'border-focus']],
    ['Text & icons', ['text-primary', 'text-secondary', 'text-muted', 'text-disabled', 'text-link', 'text-on-brand', 'icon-default', 'icon-strong']],
    ['Brand', ['brand-primary', 'brand-primary-hover', 'brand-subtle', 'brand-text']],
    ['Status', ['status-success', 'status-success-subtle', 'status-warning', 'status-warning-subtle', 'status-danger', 'status-danger-subtle', 'status-info', 'status-info-subtle']],
  ];
  const CHART = [['chart-1', 'Series 1 · blue'], ['chart-2', 'Series 2 · violet'], ['chart-3', 'Series 3 · teal'], ['chart-4', 'Series 4 · amber'], ['chart-5', 'Series 5 · rose'], ['chart-6', 'Series 6 · navy'], ['chart-7', 'Series 7 · slate'], ['chart-positive', 'Positive / connected'], ['chart-negative', 'Negative / not connected'], ['chart-grid', 'Gridlines'], ['chart-axis', 'Axis labels'], ['chart-track', 'Bar track']];

  const swatch = (name, varName) => `<div class="swatch"><div class="swatch-chip" style="background:var(--${varName})"></div><div class="swatch-meta"><strong>${name}</strong><code data-var="--${varName}">var(--${varName})</code></div></div>`;
  const colorPane = (mode) => `<div class="theme-pane theme-${mode}"><div style="display:flex;justify-content:space-between;margin-bottom:8px"><strong>${mode === 'light' ? 'Light' : 'Dark'}</strong><span class="muted" style="font-size:12px">${mode === 'light' ? 'Default' : 'Navy, not black'}</span></div>
    ${SEMANTIC.map(([g, list]) => `<div class="sg-label">${g}</div><div class="swatches">${list.map((v) => swatch(v.replace('-', '/'), `color-${v}`)).join('')}</div>`).join('')}</div>`;
  const chartPane = (mode) => `<div class="theme-pane theme-${mode}"><strong>${mode === 'light' ? 'Light' : 'Dark'}</strong>
    <div class="swatches" style="margin-top:12px">${CHART.map(([v, l]) => swatch(l, v)).join('')}</div>
    <div class="card" style="margin-top:16px"><div class="card-body">${Charts.barList([{ label: 'Airtel', value: 92140 }, { label: 'Jio', value: 81775 }, { label: 'Vodafone Idea', value: 49306 }, { label: 'BSNL', value: 18904 }], { colors: ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)'] })}</div></div></div>`;

  const TYPE = [
    ['Display', '--text-display', '30 / 38 · Semibold', 'Every call, every campaign'],
    ['Heading 1 · page title', '--text-h1', '22 / 30 · Semibold', 'Voicedrop'],
    ['Heading 2 · section, modal', '--text-h2', '17 / 24 · Semibold', 'Replace the active dataset?'],
    ['Heading 3 · card title', '--text-h3', '14 / 20 · Semibold', 'Peak ports over time'],
    ['Body', '--text-body', '14 / 20 · Regular', 'Attempts, connection rates and disconnect reasons.'],
    ['Body strong', '--text-body-strong', '14 / 20 · Medium', 'Apply filters'],
    ['Small · tables, inputs', '--text-small', '13 / 18 · Regular', '248,316 calls · 69.0% connected'],
    ['Caption', '--text-caption', '12 / 16 · Regular', 'Highest concurrent calls in each hour'],
    ['Overline', '--text-overline', '11 / 16 · Semibold · caps', 'CALL OUTCOMES'],
    ['KPI value', '--text-kpi', '28 / 34 · Semibold · tabular', '248,316'],
    ['Metric', '--text-metric', '20 / 26 · Semibold · tabular', '171,240'],
  ];
  const SPACE = [2, 4, 6, 8, 10, 12, 14, 16, 20, 24, 32, 40, 48, 64];
  const d = DATA.dashboard('voicedrop', DATA.YESTERDAY, DATA.YESTERDAY);

  const sections = [
    ['principles', 'Principles', `<div class="sg-grid">
      ${[
        ['Numbers first', 'Figures are the content. Tabular numerals, large KPI values, muted labels and no decorative chrome compete with them.'],
        ['One accent', 'Brand cyan (#00a3e0) marks the selected, focused and primary — nothing else. Charts use their own palette.'],
        ['Same layout, every service', 'All, Voicedrop, Conference and MultiCall share one dashboard grid so the eye learns it once.'],
        ['Every state designed', 'Loading, empty, error, no results and upload failed are first-class screens, not afterthoughts.'],
        ['Dense, not cramped', '4px grid, 13–14px UI text, 16–20px gaps. Built for 1440 and 1920 desktop screens.'],
        ['Navy, not black', 'Dark mode is the brand indigo pushed deep, so panels and charts keep their hue.'],
      ].map(([t, x]) => `<div class="card"><div class="card-body"><h3 class="card-title">${t}</h3><p class="secondary" style="margin-top:6px;font-size:13px">${x}</p></div></div>`).join('')}</div>`],
    ['color', 'Color', `<p class="secondary" style="margin-bottom:16px">Semantic tokens, shown in both themes. Components only ever use these; the primitive ramps (neutral, navy, brand) live in tokens.css.</p><div class="theme-pair">${colorPane('light')}${colorPane('dark')}</div>`],
    ['chart-colors', 'Chart colors', `<p class="secondary" style="margin-bottom:16px">Categorical series in fixed order, plus fixed meanings: teal = connected / positive, coral = not connected / negative. Each clears 3:1 against the card surface in its theme.</p><div class="theme-pair">${chartPane('light')}${chartPane('dark')}</div>`],
    ['type', 'Typography', `<p class="secondary">Inter, with tabular numerals for every figure. JetBrains Mono for IDs, file names and queries.</p>${TYPE.map(([n, v, spec, s]) => `<div class="type-row"><div><div style="font-size:13px;font-weight:500">${n}</div><code>${v}</code></div><div style="font:var(${v});${v === '--text-overline' ? 'text-transform:uppercase;letter-spacing:.06em' : ''}" class="num">${s}</div><code>${spec}</code></div>`).join('')}
      <div class="type-row"><div><div style="font-size:13px;font-weight:500">Mono</div><code>--font-mono</code></div><div class="mono" style="font-size:13px">cdr_codr_2026-10-01_to_2026-10-23.parquet</div><code>12–13 · Regular</code></div>`],
    ['spacing', 'Spacing, radius & elevation', `<div class="theme-pair" style="grid-template-columns:1.2fr 1fr"><div>${SPACE.map((s) => `<div class="space-row"><code class="mono">--space-${s}</code><span class="muted">${s}px</span><span class="space-bar" style="width:${s * 4}px"></span></div>`).join('')}</div>
      <div><div class="sg-label" style="margin-top:0">Radius</div><div class="sg-row">${[['sm', 6], ['md', 8], ['lg', 12], ['xl', 16], ['full', 999]].map(([n, v]) => `<div style="text-align:center;font-size:11px"><div style="width:64px;height:48px;border:1.5px solid var(--color-brand-primary);border-radius:${Math.min(v, 24)}px;background:var(--color-brand-subtle)"></div><code class="mono" style="font-size:10.5px">radius-${n}</code></div>`).join('')}</div>
      <div class="sg-label">Elevation</div><div class="sg-row">${[1, 2, 3].map((n) => `<div style="width:120px;height:72px;border-radius:12px;background:var(--color-bg-surface);box-shadow:var(--shadow-${n});display:flex;align-items:center;justify-content:center;font-size:12px" class="secondary">shadow-${n}<br>${['cards', 'popovers', 'modals'][n - 1]}</div>`).join('')}</div>
      <div class="sg-label">Layout</div><p class="secondary" style="font-size:13px">Sidebar 248px (264 at ≥1800) · collapsed rail 64px · top bar 60px · content max 1680px · 12-column dashboard grid · 1440: 4 KPIs, 2-up cards · 1920: 5 KPIs where available, 3-up routing row.</p></div></div>`],
    ['icons', 'Icons', `<p class="secondary">Lucide outline set, 1.75 stroke, 16px default (14 / 20 / 24 available).</p><div class="sg-row" style="gap:6px">${ICON_NAMES.map((n) => `<span title="${n}" style="display:inline-flex;flex-direction:column;align-items:center;gap:4px;width:84px;padding:10px 4px;border-radius:8px;border:1px solid var(--color-border-subtle);font-size:10px;color:var(--color-text-muted)">${icon(n, 'icon-lg')}<span style="overflow:hidden;text-overflow:ellipsis;max-width:76px;white-space:nowrap">${n}</span></span>`).join('')}</div>`],
    ['buttons', 'Buttons', `<div class="sg-label">Variants</div><div class="sg-row">${btn({ label: 'Primary', variant: 'primary', icon: 'check' })}${btn({ label: 'Secondary', icon: 'download' })}${btn({ label: 'Ghost', variant: 'ghost', icon: 'clock' })}${btn({ label: 'Replace dataset', variant: 'danger', icon: 'cloud-upload' })}${btn({ icon: 'more', title: 'More' })}${btn({ icon: 'download', variant: 'ghost', title: 'Download' })}</div>
      <div class="sg-label">Sizes</div><div class="sg-row">${btn({ label: 'Small', size: 'sm', variant: 'primary' })}${btn({ label: 'Default', variant: 'primary' })}${btn({ label: 'Large', size: 'lg', variant: 'primary' })}</div>
      <div class="sg-label">States</div><div class="sg-row">${btn({ label: 'Disabled', variant: 'primary', disabled: true })}${btn({ label: 'Signing in…', variant: 'primary', loading: true })}${btn({ label: 'Disabled', disabled: true })}</div>`],
    ['inputs', 'Inputs & filters', `<div class="sg-grid">
      <div class="field"><label class="field-label">Account ID</label><div class="input-wrap">${icon('search', 'icon-sm')}<input placeholder="e.g. 118230"></div><span class="field-hint">Six digits</span></div>
      <div class="field"><label class="field-label">CRN</label><input class="input" value="7720003"></div>
      <div class="field"><label class="field-label">Invalid</label><input class="input is-invalid" value="77x"><span class="field-error">${icon('alert-circle', 'icon-sm')}CRN is numbers only</span></div>
      <div class="field"><label class="field-label">Disabled</label><input class="input" disabled placeholder="Conference & MultiCall only"></div>
      <div class="field"><label class="field-label">Select</label><select class="select"><option>Any provider</option><option>Airtel</option></select></div>
      <div class="field"><label class="field-label">Time period</label><div class="time-range"><input class="input" type="time" value="09:00"><span class="muted">to</span><input class="input" type="time" value="18:00"></div></div>
      </div>
      <div class="sg-label">Filter dropdown</div><div class="sg-row">${UI.filterTrigger({ label: 'Provider' })}${UI.filterTrigger({ label: 'Provider', value: 'BSNL' })}<button class="filter-trigger is-set">${icon('sliders', 'icon-sm')}More filters<span class="tab-count">2</span>${icon('chevron-down', 'icon-sm')}</button></div>
      <div class="demo demo-static" style="margin-top:12px;display:inline-block"><div class="popover filter-pop"><div class="field"><label class="field-label">Conf Num</label><input class="input" placeholder="Conference number"></div><div class="field"><label class="field-label">CPIN</label><input class="input" value="4410237"><span class="field-hint">Matches CODR CHAIR_PIN.</span></div><div class="filter-pop-foot">${btn({ label: 'Close', variant: 'ghost', size: 'sm' })}${btn({ label: 'Apply', variant: 'primary', size: 'sm' })}</div></div></div>
      <div class="sg-label">Chips, badges, switch</div><div class="sg-row"><span class="chip">Account ID: <strong>118230</strong><button>${icon('x', 'icon-sm')}</button></span>${badge('Delivered')}${badge('Running')}${badge('Queued')}${badge('Failed')}${badge('Paused')}${badge('XLSX', 'neutral', false).replace('class="badge"', 'class="badge badge-outline"')}<button class="switch" role="switch" aria-checked="true"></button><button class="switch" role="switch" aria-checked="false"></button><span class="kbd">⌘</span><span class="kbd">K</span><span class="avatar">MK</span><span class="avatar avatar-ai">${icon('sparkles', 'icon-sm')}</span></div>`],
    ['date-picker', 'Date picker', `<div class="sg-row">${UI.dateTrigger({ from: '2026-10-23', to: '2026-10-23', preset: 'Yesterday' })}${UI.dateTrigger({ from: '2026-10-17', to: '2026-10-23', preset: 'Last 7 days', open: true })}${UI.dateTrigger({ from: '2026-10-23', to: '2026-10-23', single: true })}</div>
      <div class="demo demo-static" style="margin-top:16px;display:inline-block">${UI.datePopover({ from: '2026-10-17', to: '2026-10-23', preset: 'Last 7 days', min: '2026-10-01', max: '2026-10-23', today: '2026-10-24', presets: [{ label: 'Yesterday' }, { label: 'Last 7 days' }, { label: 'Last 14 days' }, { label: 'Month to date' }, { label: 'Custom range' }] })}</div>`],
    ['navigation', 'Sidebar & tabs', `<div class="theme-pair" style="grid-template-columns:280px 1fr"><div class="card" style="padding:4px 12px 12px;background:var(--color-bg-sidebar)">
        <div class="nav-section-title">Analytics</div>${UI.navItem({ label: 'All Services', icon: 'layout-grid' })}
        <div class="nav-group is-open has-active">${UI.navItem({ label: 'Voicedrop', icon: 'audio-lines', chevron: true })}<div class="nav-sub">${UI.navItem({ label: 'Attempt Metrics', active: true })}${UI.navItem({ label: 'Campaign Metrics' })}</div></div>
        <div class="nav-group">${UI.navItem({ label: 'Conference', icon: 'users', chevron: true })}</div>
        <div class="nav-section-title">Data</div>${UI.navItem({ label: 'Upload Data', icon: 'cloud-upload', badge: '62%' })}${UI.navItem({ label: 'Reports', icon: 'file-text', badge: '6' })}</div>
      <div><div class="sg-label" style="margin-top:0">Metric tab bar</div>${UI.tabs([{ id: 'overview', label: 'Overview', icon: 'layout-grid' }, { id: 'connection', label: 'Connection' }, { id: 'direction', label: 'Dial In / Out' }, { id: 'peak', label: 'Peak ports' }, '|', { id: 'custom', label: 'Custom', icon: 'sliders', count: 2 }], 'overview')}
        <div class="sg-label">Page tabs with counts</div>${UI.tabs([{ id: 's', label: 'Scheduled', icon: 'clock', count: 6 }, { id: 'h', label: 'History', icon: 'history', count: 10 }], 's')}
        <div class="sg-label">Segmented control</div>${UI.segmented([{ id: 'a', label: 'Daily' }, { id: 'b', label: 'Weekly' }, { id: 'c', label: 'Monthly' }], 'a')}</div></div>`],
    ['kpi', 'KPI card', `<div class="kpi-grid">${UI.kpi({ label: 'Total calls', icon: 'phone', tone: 'blue', value: '248,316', bar: 69, meta: '<strong>69.0%</strong> connected · 77,076 not connected' })}${UI.kpi({ label: 'Total participants', icon: 'users', tone: 'violet', value: '182,904', meta: '<strong>176,412</strong> unique phone numbers' })}${UI.kpi({ label: 'Minutes usage', icon: 'timer', tone: 'teal', value: '391.5k', unit: 'min', meta: '<strong>2.29 min</strong> avg per connected call', spark: Charts.sparkline(d.peak_ports.map((p) => p.peak), 'var(--chart-3)') })}${UI.kpiSkeleton()}</div>`],
    ['chart-card', 'Chart cards', `<div class="dash-grid">${UI.chartCard({ title: 'Peak ports over time', subtitle: 'Highest concurrent calls in each hour', cls: 'span-8', body: Charts.lineChart({ id: 'sg-peak', points: d.peak_ports.map((p) => ({ x: p.bucket, y: p.peak })) }), footer: '<span>Peak <strong>1,842</strong> at 11:00</span><span>Bucket: 1 hour</span>' })}${UI.chartCard({ title: 'Reblasts by stage', cls: 'span-4', body: Charts.columns(d.reblast.stages, { color: ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-6)'], height: 150 }) })}
      ${UI.chartCard({ title: 'Disconnect reasons', subtitle: 'Bar list — ranked categories', cls: 'span-6', body: Charts.barList(d.disconnect_reason.slice(0, 5), { colors: ['var(--chart-negative)', 'var(--chart-5)', 'var(--chart-4)', 'var(--chart-2)', 'var(--chart-6)'] }) })}${UI.chartCard({ title: 'Connected vs Not Connected', subtitle: 'Donut — two-part split', cls: 'span-6', body: `<div class="donut-wrap">${Charts.donut({ segments: [{ value: 171240, color: 'var(--chart-positive)' }, { value: 77076, color: 'var(--chart-negative)' }], center: '69.0%', sub: 'connected' })}${UI.legend([{ label: 'Connected', color: 'var(--chart-positive)', value: '171,240' }, { label: 'Not connected', color: 'var(--chart-negative)', value: '77,076' }])}</div>` })}
      ${UI.chartSkeleton({ cls: 'span-6' })}</div>`],
    ['table', 'Table', `<div class="card table-card">${UI.table({ cols: [{ label: 'Account', sortable: true, key: 'a' }, { label: 'Total size', align: 'right', sortable: true, key: 'b' }, { label: 'Connected', align: 'right' }, { label: 'Connected %' }, { label: 'Status' }], sort: { key: 'b', dir: 'desc' }, rows: [['118230', 'Bharat Insurance Co.', 31870, 22723, 71.3, 'Delivered'], ['104582', 'Kotak Retail Collections', 38412, 28502, 74.2, 'Running'], ['170295', 'NorthStar Telecom Resale', 11206, 6858, 61.2, 'Failed']].map((r) => `<tr><td><span class="cell-strong num">${r[0]}</span> <span class="muted">· ${r[1]}</span></td><td class="ta-r">${Charts.fmt(r[2])}</td><td class="ta-r">${Charts.fmt(r[3])}</td><td>${UI.meter(r[4])}</td><td>${badge(r[5])}</td></tr>`) })}<div class="table-foot"><span>3 accounts</span><span class="pager">${btn({ icon: 'chevron-left', variant: 'ghost', size: 'sm', disabled: true })}<span>Page 1 of 1</span>${btn({ icon: 'chevron-right', variant: 'ghost', size: 'sm', disabled: true })}</span></div></div>
      <div class="sg-label">Loading</div><div class="card table-card">${UI.tableSkeleton(3, 5)}</div>`],
    ['upload', 'Upload box & progress', `<div class="sg-grid" style="grid-template-columns:1fr 1fr">${UI.uploadBox()}${UI.uploadBox({ error: true })}</div>
      <div class="card process-card" style="margin-top:16px;max-width:620px"><div><div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:6px"><span class="muted">Overall progress</span><span class="num" style="font-weight:600">62%</span></div><div class="progress"><span style="width:62%"></span></div></div>
      <div class="steps"><div class="step is-done"><span class="step-dot">${icon('check', 'icon-sm')}</span><div><div class="step-title">Uploading file</div><div class="step-desc">1.91 GB transferred</div></div><span class="step-time">0:52</span></div><div class="step is-active"><span class="step-dot"><span class="spinner" style="width:10px;height:10px"></span></span><div><div class="step-title">Checking columns and types</div><div class="step-desc">43 CDR + 18 CODR columns found</div></div><span></span></div><div class="step is-failed"><span class="step-dot">${icon('x', 'icon-sm')}</span><div><div class="step-title">Failed step</div><div class="step-desc" style="color:var(--color-status-danger)">Missing required column CONFEREE_TYPE</div></div><span></span></div><div class="step is-pending"><span class="step-dot"></span><div><div class="step-title">Switching to the new dataset</div></div><span></span></div></div>
      <div class="progress is-indeterminate"><span></span></div></div>`],
    ['chat', 'Chat bubbles', `<div class="card" style="padding:24px;display:flex;flex-direction:column;gap:20px">${UI.bubble({ role: 'user', text: 'Which carrier had the worst connect rate for voicedrop yesterday?', time: '10:18' })}${UI.bubble({ role: 'ai', steps: [{ label: 'Reading the question', done: true }, { label: 'Running the query on the active dataset', done: false }] })}${UI.bubble(DATA.THREAD[1])}${UI.bubble({ role: 'ai', error: true })}</div>`],
    ['states', 'States & feedback', `<div class="sg-grid" style="grid-template-columns:1fr 1fr">${UI.state({ icon: 'database', tone: 'brand', title: 'No data uploaded yet', desc: 'Upload a CDR/CODR Parquet file to see attempts and connection rates.', actions: btn({ label: 'Upload data', icon: 'cloud-upload', variant: 'primary' }) })}${UI.state({ icon: 'cloud-off', tone: 'danger', title: "Couldn't load this page", desc: "The analytics service didn't respond.", code: 'POST /api/cdr/query/dashboard · 503', actions: btn({ label: 'Retry', icon: 'refresh', variant: 'primary' }) })}${UI.state({ icon: 'search-x', title: 'No calls match these filters', desc: 'Nothing matches Account ID 999999.', actions: btn({ label: 'Clear filters', variant: 'primary' }) })}${UI.state({ icon: 'alert-triangle', tone: 'warning', title: 'Upload failed', desc: 'Missing required column CONFEREE_TYPE. The previous dataset is still active.', actions: btn({ label: 'Try another file', variant: 'primary' }) })}</div>
      <div style="display:flex;flex-direction:column;gap:10px;margin-top:16px">${UI.banner({ tone: 'info', title: 'Nothing changes until processing succeeds', body: 'If the new file fails its checks, the current dataset stays active.' })}${UI.banner({ tone: 'success', title: 'Dataset ready', body: '12,978,554 rows · Oct 1 – Oct 24, 2026', actions: btn({ label: 'Open dashboard', size: 'sm', variant: 'primary' }) })}${UI.banner({ tone: 'warning', title: 'The latest upload failed — you are still viewing the previous dataset', actions: btn({ label: 'View upload', size: 'sm' }) })}${UI.banner({ tone: 'danger', title: 'Incorrect username or password' })}</div>
      <div class="sg-label">Toast</div><div class="toast" style="display:inline-flex;animation:none">${icon('check-circle')}Schedule saved</div>
      <div class="sg-label">Modal</div><div class="modal" style="animation:none"><div class="modal-head"><span class="state-icon is-warning" style="width:40px;height:40px;margin:0">${icon('alert-triangle', 'icon-lg')}</span><div><h2 class="modal-title">Replace the active dataset?</h2><p class="modal-desc">When the new file finishes processing, the current one is removed for everyone.</p></div></div><div class="modal-foot">${btn({ label: 'Cancel', variant: 'ghost' })}${btn({ label: 'Replace dataset', variant: 'danger' })}</div></div>`],
  ];

  document.getElementById('sg').innerHTML = `<div class="sg">
    <nav class="sg-nav"><div style="display:flex;align-items:center;gap:10px;margin:0 6px 20px"><span class="brand-mark">${icon('palette')}</span><div><div class="brand-name">Style guide</div><div class="brand-sub">DSNL Analytics</div></div></div>
      ${sections.map(([id, t]) => `<a href="#${id}">${t}</a>`).join('')}
      <div style="margin:20px 6px 0;display:flex;flex-direction:column;gap:8px">${btn({ label: theme === 'dark' ? 'Light theme' : 'Dark theme', icon: theme === 'dark' ? 'sun' : 'moon', size: 'sm', action: 'theme' })}<a class="btn btn-ghost btn-sm" href="index.html">${icon('arrow-right', 'icon-sm')}Open prototype</a></div></nav>
    <main class="sg-main"><h1 style="font:var(--text-display)">DSNL Analytics — design system</h1><p class="secondary" style="margin-top:8px;max-width:720px">Foundations and reusable components for the redesign. Built for wide desktop screens (1440 and 1920), light and dark. Every screen in the prototype is assembled from what's on this page.</p>
      ${sections.map(([id, t, body]) => `<section class="sg-section" id="${id}"><h2>${t}</h2>${body}</section>`).join('')}</main></div>`;

  // Show the resolved hex next to each token, per pane.
  document.querySelectorAll('[data-var]').forEach((el) => {
    const v = getComputedStyle(el).getPropertyValue(el.dataset.var).trim();
    el.textContent = `${el.dataset.var.replace('--color-', '').replace('--', '')} · ${v}`;
  });
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-action="theme"]');
    if (!t) return;
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    try {
      localStorage.setItem('dsnl-proto:theme', JSON.stringify(next));
    } catch {
      /* storage blocked */
    }
    location.reload();
  });
})();
