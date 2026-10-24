/* ─────────────────────────────────────────────────────────────────────────
   Screens. Each renderer reads the prototype state (window.S, owned by
   app.js) and returns markup. Every data screen handles the five states the
   brief asks for — loading, empty (no dataset), error, no results, upload
   failed — through screenState() below.
   ───────────────────────────────────────────────────────────────────────── */
(function () {
  const { fmt, pct, compact } = Charts;
  const D = DATA;
  const esc = UI.esc;

  /** The state a data screen should draw right now. */
  function screenState() {
    if (S.transient) return 'loading';
    if (S.view === 'loading') return 'loading';
    if (S.view === 'error') return 'error';
    if (S.view === 'empty' || !S.dataset) return 'empty';
    if (S.view === 'noresults') return 'noresults';
    return 'ready';
  }

  /** Shown on every data screen when the latest upload failed: the old dataset is still live. */
  function uploadFailedBanner() {
    if (S.view !== 'uploadfailed' && S.upload.phase !== 'failed') return '';
    return UI.banner({
      tone: 'warning',
      title: 'The latest upload failed — you are still viewing the previous dataset',
      body: `<span class="mono">cdr_codr_2026-10-01_to_2026-10-24.parquet</span> was rejected: missing required column <span class="mono">CONFEREE_TYPE</span>. Data below covers Oct 1 – Oct 23, 2026.`,
      actions: `<a class="btn btn-secondary btn-sm" href="#/upload">View upload</a>`,
    });
  }

  function emptyDataset(what) {
    return UI.state({
      icon: 'database',
      tone: 'brand',
      title: 'No data uploaded yet',
      desc: `Upload a CDR/CODR Parquet file to see ${what}. Only one dataset is active at a time, and it stays until the next upload.`,
      actions: `<a class="btn btn-primary" href="#/upload">${icon('cloud-upload')}Upload data</a>${UI.btn({ label: 'What file do I need?', variant: 'ghost', action: 'toast', arg: 'Opens the data format guide' })}`,
    });
  }

  function errorState(endpoint) {
    return UI.state({
      icon: 'cloud-off',
      tone: 'danger',
      title: "Couldn't load this page",
      desc: "The analytics service didn't respond. Nothing is wrong with your data — this is a connection problem, and retrying usually fixes it.",
      code: `${endpoint} · 503 Service Unavailable`,
      actions: `${UI.btn({ label: 'Retry', icon: 'refresh', variant: 'primary', action: 'retry' })}${UI.btn({ label: 'Copy error details', icon: 'copy', variant: 'ghost', action: 'toast', arg: 'Error details copied' })}`,
    });
  }

  function pageHead({ title, sub, actions = '' }) {
    return `<div class="page-head"><div><h1 class="page-title">${title}</h1><p class="page-sub">${sub}</p></div><div class="page-actions">${actions}</div></div>`;
  }
  const dot = '<span class="sep"></span>';

  // ═════════════════════════════════════════════════════════════════════
  // Sign in
  // ═════════════════════════════════════════════════════════════════════
  function login() {
    const L = S.login;
    const failed = L.error || S.view === 'error';
    return `<div class="login">
      <section class="login-hero">
        <div style="display:flex;align-items:center;gap:10px"><span class="brand-mark">${icon('activity')}</span><div><div class="brand-name">DSNL Analytics</div><div style="font-size:11px;color:rgba(255,255,255,.6)">CDR reporting</div></div></div>
        <div>
          <h1>Every call, every campaign — in one place.</h1>
          <p>Attempts, connection rates, peak ports and disconnect reasons for Voicedrop, Conference and MultiCall, from the CDR and CODR data your team uploads.</p>
          <div class="hero-services"><span class="hero-chip">${icon('audio-lines')}Voicedrop</span><span class="hero-chip">${icon('users')}Conference</span><span class="hero-chip">${icon('phone-forwarded')}MultiCall</span></div>
          <div class="hero-preview"><div class="hero-preview-row">
            <div class="hero-stat"><span>Attempts yesterday</span><strong>344,648</strong></div>
            <div class="hero-stat"><span>Connected</span><strong>74.1%</strong></div>
            <div class="hero-stat"><span>Peak ports</span><strong>3,692</strong></div>
          </div></div>
        </div>
        <div class="hero-foot">Internal tool · DSNL operations &amp; analytics</div>
      </section>
      <section class="login-panel">
        <div class="login-theme">${UI.btn({ icon: S.theme === 'dark' ? 'sun' : 'moon', variant: 'ghost', title: 'Switch theme', action: 'theme' })}</div>
        <form class="login-card" data-form="login" novalidate>
          <div><h2>Sign in</h2><p class="muted" style="margin-top:6px">Use your DSNL username and password.</p></div>
          ${failed ? UI.banner({ tone: 'danger', title: L.error ? 'Incorrect username or password' : "Can't reach the sign-in service", body: L.error ? 'Check both fields and try again. After 5 failed attempts the account is locked for 15 minutes.' : 'The server did not respond. Try again in a minute.' }) : ''}
          <div class="field"><label class="field-label" for="login-user">Username</label>
            <div class="input-wrap input-lg">${icon('user')}<input id="login-user" name="username" autocomplete="username" placeholder="e.g. mukesh.mk" value="${esc(L.user)}"></div></div>
          <div class="field"><div style="display:flex;justify-content:space-between"><label class="field-label" for="login-pass">Password</label><a href="#/login" data-action="toast" data-arg="Ask your admin to reset your password" style="font-size:12px">Forgot password?</a></div>
            <div class="input-wrap input-lg">${icon('lock')}<input id="login-pass" name="password" type="${L.showPw ? 'text' : 'password'}" autocomplete="current-password" placeholder="••••••••"><span class="input-suffix">${UI.btn({ icon: L.showPw ? 'eye-off' : 'eye', variant: 'ghost', size: 'sm', title: L.showPw ? 'Hide password' : 'Show password', action: 'toggle-pw' })}</span></div></div>
          <label class="check"><input type="checkbox" checked> Keep me signed in on this device</label>
          ${UI.btn({ label: L.loading || S.view === 'loading' ? 'Signing in…' : 'Sign in', variant: 'primary', size: 'lg', block: true, type: 'submit', loading: L.loading || S.view === 'loading' })}
          <p class="muted" style="font-size:12px;text-align:center">Prototype: any username and password signs in. Type <span class="mono">wrong</span> as the password to see the error.</p>
        </form>
      </section>
    </div>`;
  }

  // ═════════════════════════════════════════════════════════════════════
  // App shell: sidebar + top bar
  // ═════════════════════════════════════════════════════════════════════
  function sidebar(route) {
    const is = (h) => location.hash === h || location.hash.startsWith(h + '?');
    const group = (svc, children) => {
      const meta = D.SERVICES[svc];
      const active = route.service === svc && ['dashboard', 'campaign', 'registry'].includes(route.page);
      const open = S.navOpen[svc] || active;
      return `<div class="nav-group${open ? ' is-open' : ''}${active ? ' has-active' : ''}">
        ${UI.navItem({ label: meta.name, icon: meta.icon, chevron: true, action: 'nav-toggle', arg: svc })}
        <div class="nav-sub">${children.map((c) => UI.navItem(c)).join('')}</div></div>`;
    };
    const subs = (svc) => [
      { label: 'Attempt Metrics', href: `#/analytics/${svc}`, active: is(`#/analytics/${svc}`) },
      { label: 'Campaign Metrics', href: `#/analytics/${svc}/campaign`, active: is(`#/analytics/${svc}/campaign`) },
      ...(svc === 'multicall' ? [{ label: 'Registration Lookup', href: '#/analytics/multicall/registry', active: is('#/analytics/multicall/registry') }] : []),
    ];
    const ds = S.dataset;
    const busy = ['uploading', 'validating', 'indexing'].includes(S.upload.phase);
    return `<aside class="sidebar" aria-label="Main navigation">
      <div class="sidebar-brand"><span class="brand-mark">${icon('activity')}</span><div class="brand-text"><div class="brand-name">DSNL Analytics</div><div class="brand-sub">CDR reporting</div></div>
        ${UI.btn({ icon: 'panel-left', variant: 'ghost', size: 'sm', title: 'Collapse sidebar', action: 'collapse' })}</div>
      <nav class="sidebar-nav">
        <div class="nav-section-title">Analytics</div>
        ${UI.navItem({ label: 'All Services', icon: 'layout-grid', href: '#/analytics/all', active: is('#/analytics/all') })}
        ${group('voicedrop', subs('voicedrop'))}
        ${group('conference', subs('conference'))}
        ${group('multicall', subs('multicall'))}
        <div class="nav-section-gap"></div>
        <div class="nav-section-title">Data</div>
        ${UI.navItem({ label: 'Upload Data', icon: 'cloud-upload', href: '#/upload', active: route.page === 'upload', badge: busy ? `${Math.round(overallProgress(S.upload))}%` : !ds ? 'Start' : '' })}
        ${UI.navItem({ label: 'Reports', icon: 'file-text', href: '#/reports', active: route.page === 'reports', badge: '6' })}
        <div class="nav-section-gap"></div>
        <div class="nav-section-title">Assistant</div>
        ${UI.navItem({ label: 'Ask AI', icon: 'sparkles', href: '#/assistant', active: route.page === 'assistant' })}
      </nav>
      <div class="sidebar-foot">
        <a class="dataset-mini" href="#/upload" title="Active dataset">
          <span class="dataset-mini-row"><span class="status-dot ${busy ? 'is-busy' : ds ? (S.view === 'uploadfailed' || S.upload.phase === 'failed' ? 'is-warning' : '') : 'is-muted'}"></span><span class="dataset-mini-detail">${busy ? 'Processing new upload…' : ds ? 'Active dataset' : 'No dataset'}</span></span>
          <span class="dataset-mini-detail dataset-mini-name">${ds ? esc(S.datasetInfo.file) : 'Upload a Parquet file to begin'}</span>
          ${ds ? `<span class="dataset-mini-detail dataset-mini-row num">${UI.SHORT_NY(S.datasetInfo.from)} – ${UI.SHORT_NY(S.datasetInfo.to)} · ${compact(S.datasetInfo.rows)} rows</span>` : ''}
        </a>
      </div>
    </aside>`;
  }

  const PRESETS = [
    { label: 'Yesterday', from: D.YESTERDAY, to: D.YESTERDAY },
    { label: 'Last 7 days', from: '2026-10-17', to: D.YESTERDAY },
    { label: 'Last 14 days', from: '2026-10-10', to: D.YESTERDAY },
    { label: 'Month to date', from: '2026-10-01', to: D.YESTERDAY },
    { label: 'Custom range', from: null, to: null },
  ];
  const SINGLE_PRESETS = [
    { label: 'Yesterday', from: D.YESTERDAY, to: D.YESTERDAY },
    { label: 'Oct 22, 2026', from: '2026-10-22', to: '2026-10-22' },
    { label: 'Oct 21, 2026', from: '2026-10-21', to: '2026-10-21' },
    { label: 'Pick a day', from: null, to: null },
  ];

  function topbar(route) {
    const crumbs = crumbsFor(route);
    let date = '';
    if (route.page === 'dashboard') {
      date = `<div class="pop-anchor">${UI.dateTrigger({ ...S.range, open: S.pop === 'date' })}${S.pop === 'date' ? UI.datePopover({ ...S.range, min: S.datasetInfo.from, max: S.datasetInfo.to, today: D.TODAY, presets: PRESETS }) : ''}</div>`;
    } else if (route.page === 'campaign') {
      const c = S.campaignDate;
      date = `<div class="pop-anchor">${UI.dateTrigger({ from: c.from, to: c.from, preset: c.preset === 'Yesterday' ? 'Yesterday' : '', single: true, open: S.pop === 'date' })}${S.pop === 'date' ? UI.datePopover({ from: c.from, to: c.from, preset: c.preset, min: S.datasetInfo.from, max: S.datasetInfo.to, today: D.TODAY, single: true, presets: SINGLE_PRESETS }) : ''}</div>`;
    }
    if (date && !S.dataset) date = '';
    return `<header class="topbar">
      ${S.collapsed ? UI.btn({ icon: 'panel-left', variant: 'ghost', size: 'sm', title: 'Expand sidebar', action: 'collapse' }) : ''}
      <nav class="crumbs" aria-label="Breadcrumb">${crumbs}</nav>
      <span class="topbar-spacer"></span>
      <div class="topbar-actions">
        ${date}
        ${route.page !== 'assistant' ? `<a class="btn btn-ghost" href="#/assistant">${icon('sparkles')}<span>Ask AI</span></a>` : ''}
        ${UI.btn({ icon: S.theme === 'dark' ? 'sun' : 'moon', variant: 'ghost', title: S.theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme', action: 'theme' })}
        <div class="pop-anchor">
          <button type="button" class="user-trigger" data-action="toggle-pop" data-arg="user" aria-haspopup="menu" aria-expanded="${S.pop === 'user'}"><span class="avatar">MK</span>${icon('chevron-down', 'icon-sm')}</button>
          ${S.pop === 'user' ? userMenu() : ''}
        </div>
      </div>
    </header>`;
  }

  function userMenu() {
    return `<div class="popover align-right" role="menu" style="width:248px">
      <div class="user-card"><span class="avatar avatar-lg">MK</span><div><strong>Mukesh K.</strong><span>mukesh.mk@dsnl.in · Analyst</span></div></div>
      <div class="menu-sep"></div>
      <div class="menu-label">Theme</div>
      <button class="menu-item${S.theme === 'light' ? ' is-selected' : ''}" data-action="set-theme" data-arg="light">${icon('sun')}Light${S.theme === 'light' ? `<span class="menu-trail">${icon('check', 'icon-sm')}</span>` : ''}</button>
      <button class="menu-item${S.theme === 'dark' ? ' is-selected' : ''}" data-action="set-theme" data-arg="dark">${icon('moon')}Dark${S.theme === 'dark' ? `<span class="menu-trail">${icon('check', 'icon-sm')}</span>` : ''}</button>
      <div class="menu-sep"></div>
      <a class="menu-item" href="#/reports">${icon('file-text')}My scheduled reports</a>
      <button class="menu-item" data-action="toast" data-arg="Keyboard shortcuts: G then D for dashboard, / to search">${icon('zap')}Keyboard shortcuts<span class="menu-trail"><span class="kbd">?</span></span></button>
      <div class="menu-sep"></div>
      <a class="menu-item danger" href="#/login" data-action="sign-out">${icon('log-out')}Sign out</a>
    </div>`;
  }

  function crumbsFor(route) {
    const sep = icon('chevron-right', 'icon-sm');
    const svc = route.service && D.SERVICES[route.service];
    switch (route.page) {
      case 'dashboard':
        return route.service === 'all' ? `<span>Analytics</span>${sep}<strong>All Services</strong>` : `<span>${svc.name}</span>${sep}<strong>Attempt Metrics</strong>`;
      case 'campaign':
        return `<span>${svc.name}</span>${sep}<strong>Campaign Metrics</strong>`;
      case 'registry':
        return `<span>MultiCall</span>${sep}<strong>Registration Lookup</strong>`;
      case 'upload':
        return `<span>Data</span>${sep}<strong>Upload Data</strong>`;
      case 'reports':
        return `<span>Data</span>${sep}<strong>Reports</strong>`;
      case 'assistant':
        return `<span>Assistant</span>${sep}<strong>${S.chat.active ? esc((D.CONVERSATIONS.find((c) => c.id === S.chat.active) || {}).title || 'New chat') : 'New chat'}</strong>`;
      default:
        return '';
    }
  }

  // ═════════════════════════════════════════════════════════════════════
  // Dashboard (All / Voicedrop / Conference / MultiCall)
  // ═════════════════════════════════════════════════════════════════════
  const DASH_TABS = [
    { id: 'overview', label: 'Overview', icon: 'layout-grid' },
    { id: 'connection', label: 'Connection' },
    { id: 'direction', label: 'Dial In / Out' },
    { id: 'peak', label: 'Peak ports' },
    { id: 'providers', label: 'Service providers' },
    { id: 'reblast', label: 'Reblast & DTMF' },
    { id: 'reasons', label: 'Disconnect reasons' },
  ];
  const FILTER_LABELS = { account_id: 'Account ID', crn: 'CRN', conf_num: 'Conf Num', cpin: 'CPIN', time_from: 'From', time_to: 'To', direction: 'Direction', provider: 'Provider' };

  function activeFilters(service) {
    const f = S.dash.filters[service];
    return Object.entries(f).filter(([, v]) => v);
  }

  function dashboard(route) {
    const service = route.service;
    const meta = D.SERVICES[service];
    const tab = S.dash.tab[service] || 'overview';
    const st = screenState();
    const nFilters = activeFilters(service).length;
    const tabItems = [...DASH_TABS, '|', { id: 'custom', label: 'Custom', icon: 'sliders', count: nFilters || undefined }];
    const rangeText = UI.rangeLabel(S.range.from, S.range.to);
    const days = D.daysBetween(S.range.from, S.range.to).length;

    const head = pageHead({
      title: meta.name,
      sub: `Attempt metrics ${dot} <span class="num">${rangeText}</span>${days > 1 ? ` ${dot} ${days} days` : ''}${S.dataset ? ` ${dot} ${icon('database', 'icon-sm')} ${esc(S.datasetInfo.file)}` : ''}`,
      actions: st === 'ready' || st === 'noresults' ? `${UI.btn({ label: 'Schedule report', icon: 'clock', variant: 'ghost', action: 'new-schedule' })}${UI.btn({ label: 'Export', icon: 'download', variant: 'secondary', action: 'toast', arg: `${meta.name} dashboard exported (XLSX, 7 sheets)` })}` : '',
    });

    if (st === 'empty') return `<div class="page">${head}${emptyDataset(`${meta.name} attempts, connection rates and peak ports`)}</div>`;
    if (st === 'error') return `<div class="page">${head}${UI.tabs(tabItems, tab, 'dash-tab')}${errorState('POST /api/cdr/query/dashboard')}</div>`;

    const showFilterBar = tab === 'custom' || st === 'noresults';
    const filters = S.view === 'noresults' ? { ...S.dash.filters[service], account_id: '999999' } : S.dash.filters[service];
    const data = st === 'loading' ? null : D.dashboard(service, S.range.from, S.range.to, filters);

    let body;
    if (st === 'loading') body = dashSkeleton(service);
    else if (!data || st === 'noresults')
      body = UI.state({
        icon: 'search-x',
        title: 'No calls match these filters',
        desc: `Nothing in ${meta.name} for ${rangeText} matches ${filterSentence(filters)}. Check the ID, widen the time period, or pick a longer date range.`,
        actions: `${UI.btn({ label: 'Clear filters', icon: 'rotate-ccw', variant: 'primary', action: 'clear-filters' })}${UI.btn({ label: 'Change date range', icon: 'calendar', variant: 'secondary', action: 'toggle-pop', arg: 'date' })}`,
      });
    else body = dashBody(service, data, tab === 'custom' ? 'overview' : tab);

    return `<div class="page">
      ${head}
      ${uploadFailedBanner()}
      <div class="dash-tabs-row">${UI.tabs(tabItems, showFilterBar ? 'custom' : tab, 'dash-tab')}${showFilterBar ? filterBar(service, filters) : ''}</div>
      ${body}
    </div>`;
  }

  function filterSentence(f) {
    const parts = Object.entries(f).filter(([, v]) => v).map(([k, v]) => `${FILTER_LABELS[k]} <span class="mono">${esc(v)}</span>`);
    return parts.length ? parts.join(', ') : 'the current filters';
  }

  function filterBar(service, f) {
    const hasConf = service === 'conference' || service === 'multicall';
    const more = [f.conf_num, f.cpin, f.direction, f.provider].filter(Boolean).length;
    const chips = Object.entries(f).filter(([, v]) => v);
    return `<form class="filter-bar" data-form="filters">
      <div class="field"><label class="field-label" for="f-account">Account ID</label><div class="input-wrap">${icon('search', 'icon-sm')}<input id="f-account" name="account_id" placeholder="e.g. 118230" value="${esc(f.account_id || '')}" inputmode="numeric"></div></div>
      <div class="field"><label class="field-label" for="f-crn">CRN</label><input class="input" id="f-crn" name="crn" placeholder="e.g. 7720003" value="${esc(f.crn || '')}" inputmode="numeric"></div>
      <div class="field is-time"><span class="field-label">Time period</span><div class="time-range"><input class="input" type="time" name="time_from" aria-label="From" value="${esc(f.time_from || '')}"><span class="muted">to</span><input class="input" type="time" name="time_to" aria-label="To" value="${esc(f.time_to || '')}"></div></div>
      <div class="field" style="width:auto"><span class="field-label">&nbsp;</span>
        <div class="pop-anchor"><button type="button" class="filter-trigger${more ? ' is-set' : ''}" data-action="toggle-pop" data-arg="more-filters" aria-expanded="${S.pop === 'more-filters'}">${icon('sliders', 'icon-sm')}More filters${more ? `<span class="tab-count">${more}</span>` : ''}${icon('chevron-down', 'icon-sm')}</button>
        ${S.pop === 'more-filters' ? moreFilters(service, f, hasConf) : ''}</div></div>
      <div class="filter-bar-actions"><span class="field-label" style="visibility:hidden">.</span>
        ${UI.btn({ label: 'Reset', variant: 'ghost', action: 'clear-filters', disabled: !chips.length })}
        ${UI.btn({ label: 'Apply filters', icon: 'check', variant: 'primary', type: 'submit' })}</div>
      ${chips.length ? `<div class="filter-chips" style="flex-basis:100%">Showing ${chips.map(([k, v]) => `<span class="chip">${FILTER_LABELS[k]}: <strong>${esc(v)}</strong><button type="button" data-action="remove-filter" data-arg="${k}" aria-label="Remove ${FILTER_LABELS[k]} filter">${icon('x', 'icon-sm')}</button></span>`).join('')}</div>` : ''}
    </form>`;
  }

  function moreFilters(service, f, hasConf) {
    return `<div class="popover align-left filter-pop" role="dialog" aria-label="More filters">
      <div class="field"><label class="field-label" for="f-conf">Conf Num ${hasConf ? '' : '<span class="badge" style="height:18px">Conference & MultiCall</span>'}</label><input class="input" id="f-conf" name="conf_num" placeholder="Conference number" value="${esc(f.conf_num || '')}" ${hasConf ? '' : 'disabled'}></div>
      <div class="field"><label class="field-label" for="f-cpin">CPIN</label><input class="input" id="f-cpin" name="cpin" placeholder="Chairperson PIN" value="${esc(f.cpin || '')}" ${hasConf ? '' : 'disabled'}><span class="field-hint">${hasConf ? 'Matches CODR CHAIR_PIN.' : 'Only Conference and MultiCall rooms have a CPIN.'}</span></div>
      <div class="field"><label class="field-label" for="f-dir">Call direction <span class="badge badge-info" style="height:18px">New</span></label><select class="select" id="f-dir" name="direction"><option value="">Any direction</option><option ${f.direction === 'Dial Out' ? 'selected' : ''}>Dial Out</option><option ${f.direction === 'Dial In' ? 'selected' : ''}>Dial In</option></select></div>
      <div class="field"><label class="field-label" for="f-prov">Service provider <span class="badge badge-info" style="height:18px">New</span></label><select class="select" id="f-prov" name="provider"><option value="">Any provider</option>${['Airtel', 'Jio', 'Vodafone Idea', 'BSNL', 'Tata Tele'].map((p) => `<option ${f.provider === p ? 'selected' : ''}>${p}</option>`).join('')}</select></div>
      <div class="filter-pop-foot">${UI.btn({ label: 'Close', variant: 'ghost', size: 'sm', action: 'close-pop' })}${UI.btn({ label: 'Apply', variant: 'primary', size: 'sm', type: 'submit' })}</div>
    </div>`;
  }

  function dashSkeleton(service) {
    const five = service === 'conference' || service === 'multicall';
    return `<div class="kpi-grid${five ? ' has-5' : ''}">${Array.from({ length: five ? 5 : 4 }, UI.kpiSkeleton).join('')}</div>
      <div class="dash-grid">
        ${UI.chartSkeleton({ cls: 'span-6', height: 140 })}${UI.chartSkeleton({ cls: 'span-6', height: 140 })}
        ${UI.chartSkeleton({ cls: 'span-8', height: 240 })}${UI.chartSkeleton({ cls: 'span-4', height: 240 })}
        ${UI.chartSkeleton({ cls: 'span-6 xl-span-4', height: 200 })}${UI.chartSkeleton({ cls: 'span-6 xl-span-4', height: 200 })}${UI.chartSkeleton({ cls: 'span-12 xl-span-4', height: 200 })}
      </div>`;
  }

  function dashBody(service, d, tab) {
    const s = d.summary;
    const connected = d.connection_status[0].value;
    const notConnected = d.connection_status[1].value;
    const dialOut = d.call_direction[0].value;
    const dialIn = d.call_direction[1].value;
    const five = service === 'conference' || service === 'multicall';
    const spark = d.peak_ports.map((p) => p.peak);
    const tip = Charts.tip;

    const kpis = [
      UI.kpi({ label: 'Total calls', icon: 'phone', tone: 'blue', value: fmt(s.total_calls), bar: (connected / s.total_calls) * 100, meta: `<strong>${pct(connected, s.total_calls)}</strong> connected · ${fmt(notConnected)} not connected`,
        tipId: tip('Total calls', [{ label: 'Connected', value: fmt(connected), color: 'var(--chart-positive)' }, { label: 'Not connected', value: fmt(notConnected), color: 'var(--chart-negative)' }], 'Every dial attempt in the range') }),
      UI.kpi({ label: 'Total participants', icon: 'users', tone: 'violet', value: fmt(s.total_participants), meta: `<strong>${fmt(s.total_phone_numbers)}</strong> unique phone numbers`,
        tipId: tip('Total participants', [{ label: 'Distinct participants', value: fmt(s.total_participants) }, { label: 'Unique phone numbers', value: fmt(s.total_phone_numbers) }], 'One per conferee, per room, per day') }),
      ...(five ? [UI.kpi({ label: 'Conferences', icon: 'layers', tone: 'amber', value: fmt(s.total_conferences), meta: `<strong>${(s.total_participants / Math.max(1, s.total_conferences)).toFixed(1)}</strong> participants per conference`,
        tipId: tip('Conferences', [{ label: 'Distinct rooms (CRN + Conf Num)', value: fmt(s.total_conferences) }]) })] : []),
      UI.kpi({ label: 'Minutes usage', icon: 'timer', tone: 'teal', value: compact(s.minutes_usage), unit: 'min', meta: `<strong>${(s.minutes_usage / Math.max(1, connected)).toFixed(2)} min</strong> avg per connected call`, spark: Charts.sparkline(spark, 'var(--chart-3)'),
        tipId: tip('Minutes usage', [{ label: 'Billable minutes', value: fmt(s.minutes_usage) }, { label: 'Avg per connected call', value: `${(s.minutes_usage / Math.max(1, connected)).toFixed(2)} min` }]) }),
      ...(!five ? [UI.kpi({ label: 'Connection rate', icon: 'signal', tone: 'rose', value: pct(connected, s.total_calls), meta: `${fmt(connected)} of ${fmt(s.total_calls)} attempts reached someone`,
        tipId: tip('Connection rate', [{ label: 'Connected', value: fmt(connected) }, { label: 'Attempts', value: fmt(s.total_calls) }]) })] : []),
    ];

    const cards = {};
    // Connected vs not connected
    const tC = tip('Connected', [{ label: 'Calls', value: fmt(connected), color: 'var(--chart-positive)' }, { label: 'Share', value: pct(connected, s.total_calls) }]);
    const tN = tip('Not connected', [{ label: 'Calls', value: fmt(notConnected), color: 'var(--chart-negative)' }, { label: 'Share', value: pct(notConnected, s.total_calls) }]);
    cards.connection = (cls) => UI.chartCard({
      title: 'Connected vs Not Connected', subtitle: 'How many attempts reached a participant', cls,
      body: `<div class="donut-wrap">${Charts.donut({ segments: [{ value: connected, color: 'var(--chart-positive)', tip: tC }, { value: notConnected, color: 'var(--chart-negative)', tip: tN }], center: pct(connected, s.total_calls), sub: 'connected' })}
        <div style="display:flex;flex-direction:column;gap:16px"><div class="stat-pair">
          <div class="stat" data-tip="${tC}"><span class="stat-label"><i class="legend-swatch" style="background:var(--chart-positive)"></i>Connected</span><span class="stat-value">${fmt(connected)}</span><span class="stat-sub">${pct(connected, s.total_calls)} of attempts</span></div>
          <div class="stat" data-tip="${tN}"><span class="stat-label"><i class="legend-swatch" style="background:var(--chart-negative)"></i>Not connected</span><span class="stat-value">${fmt(notConnected)}</span><span class="stat-sub">${pct(notConnected, s.total_calls)} of attempts</span></div></div>
          <div class="split-bar" aria-hidden="true"><span style="flex:${connected};background:var(--chart-positive)"></span><span style="flex:${notConnected};background:var(--chart-negative)"></span></div></div></div>`,
      footer: `${icon('info', 'icon-sm')} Top reason for not connecting: <strong style="color:var(--color-text-primary);font-weight:500">${d.disconnect_reason[0].label}</strong> (${pct(d.disconnect_reason[0].value, notConnected)})`,
    });
    // Dial in vs dial out
    const tO = tip('Dial Out', [{ label: 'Calls', value: fmt(dialOut), color: 'var(--chart-1)' }, { label: 'Share', value: pct(dialOut, s.total_calls) }]);
    const tI = tip('Dial In', [{ label: 'Calls', value: fmt(dialIn), color: 'var(--chart-2)' }, { label: 'Share', value: pct(dialIn, s.total_calls) }]);
    cards.direction = (cls) => UI.chartCard({
      title: 'Dial In vs Dial Out', subtitle: 'The balance between outbound and inbound calls', cls,
      body: `<div class="donut-wrap">${Charts.donut({ segments: [{ value: dialOut, color: 'var(--chart-1)', tip: tO }, { value: dialIn, color: 'var(--chart-2)', tip: tI }], center: pct(dialOut, s.total_calls, 0), sub: 'dial out' })}
        <div style="display:flex;flex-direction:column;gap:16px"><div class="stat-pair">
          <div class="stat" data-tip="${tO}"><span class="stat-label">${icon('phone-outgoing', 'icon-sm')}Dial Out</span><span class="stat-value">${fmt(dialOut)}</span><span class="stat-sub">${pct(dialOut, s.total_calls)} of calls</span></div>
          <div class="stat" data-tip="${tI}"><span class="stat-label">${icon('phone-incoming', 'icon-sm')}Dial In</span><span class="stat-value">${fmt(dialIn)}</span><span class="stat-sub">${pct(dialIn, s.total_calls)} of calls</span></div></div>
          <div class="split-bar" aria-hidden="true"><span style="flex:${dialOut};background:var(--chart-1)"></span><span style="flex:${dialIn};background:var(--chart-2)"></span></div></div></div>`,
      footer: `${icon('info', 'icon-sm')} ${service === 'conference' ? 'Conference rooms are mostly joined by dialling in.' : service === 'voicedrop' ? 'Voicedrop is outbound by design; dial-ins are call-backs.' : 'Direction is taken from each call leg.'}`,
    });
    // Peak ports
    const pk = d.peak_ports;
    const peakMax = pk.reduce((m, p) => (p.peak > m.peak ? p : m), pk[0]);
    const avg = Math.round(pk.reduce((t, p) => t + p.peak, 0) / pk.length);
    const hourly = d.coverage.bucket === 'hour';
    const xf = (x, short) => (hourly ? x : short ? UI.SHORT_NY(x).replace(/^(\w+) /, '$1 ') : UI.SHORT(x));
    cards.peak = (cls) => UI.chartCard({
      title: 'Peak ports over time', subtitle: hourly ? 'Highest concurrent calls in each hour' : 'Highest concurrent calls on each day', cls,
      extraActions: UI.segmented([{ id: 'line', label: 'Line' }, { id: 'table', label: 'Table' }], 'line', 'toast'),
      body: Charts.lineChart({ id: `peak-${service}`, points: pk.map((p) => ({ x: p.bucket, y: p.peak })), xFormat: xf, height: cls.includes('span-12') ? 220 : 250 }),
      footer: `<span>Peak <strong class="num" style="color:var(--color-text-primary)">${fmt(peakMax.peak)}</strong> at ${xf(peakMax.bucket)}</span><span>Average <strong class="num" style="color:var(--color-text-primary)">${fmt(avg)}</strong></span><span>Bucket: ${hourly ? '1 hour' : '1 day'}</span>`,
    });
    // Reblast & DTMF
    cards.reblast = (cls) => UI.chartCard({
      title: 'Reblast & DTMF', subtitle: 'Repeat attempts and key presses', cls,
      body: `<div class="reblast-stats">
          <div class="mini-stat" data-tip="${tip('Reblast count', [{ label: 'Reblasted conferees', value: fmt(d.reblast.total) }], 'Blast 0, the first dial, is excluded')}"><span class="stat-label">${icon('repeat', 'icon-sm')}Reblast count</span><div class="stat-value" style="margin-top:4px">${fmt(d.reblast.total)}</div><span class="stat-sub">${pct(d.reblast.total, s.total_calls)} of calls</span></div>
          <div class="mini-stat" data-tip="${tip('DTMF count', [{ label: 'Key presses captured', value: fmt(d.dtmf) }, { label: 'Of connected calls', value: pct(d.dtmf, connected) }])}"><span class="stat-label">${icon('hash', 'icon-sm')}DTMF count</span><div class="stat-value" style="margin-top:4px">${fmt(d.dtmf)}</div><span class="stat-sub">${pct(d.dtmf, connected)} of connected</span></div></div>
        <div class="card-subtitle" style="margin-bottom:8px">Reblasts by stage</div>
        ${Charts.columns(d.reblast.stages, { color: ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-6)'], height: 92 })}`,
    });
    // Providers
    cards.providers = (cls) => UI.chartCard({
      title: 'Service providers', subtitle: 'Calls per carrier, with connect rate', cls,
      body: Charts.barList(d.service_provider.map((p) => ({ ...p, extra: [{ label: 'Connected', value: fmt(p.connected) }, { label: 'Connect rate', value: pct(p.connected, p.value) }] })), {
        colors: ['var(--chart-1)'], valueSuffix: (r) => `${pct(r.connected, r.value)} conn.`,
      }),
      footer: `${icon('info', 'icon-sm')} Lowest connect rate: <strong style="color:var(--color-text-primary);font-weight:500">${[...d.service_provider].sort((a, b) => a.connected / a.value - b.connected / b.value)[0].label}</strong>`,
    });
    // Disconnect reasons
    cards.reasons = (cls) => UI.chartCard({
      title: 'Disconnect reasons', subtitle: `Why ${fmt(notConnected)} attempts didn't connect`, cls,
      body: Charts.barList(d.disconnect_reason, { colors: ['var(--chart-negative)', 'var(--chart-5)', 'var(--chart-4)', 'var(--chart-2)', 'var(--chart-6)', 'var(--chart-7)', 'var(--chart-7)'] }),
    });
    // Location (existing panel, kept)
    cards.location = (cls) => UI.chartCard({
      title: 'Location', subtitle: 'Where call traffic was routed', cls: `${cls} loc-card`,
      body: Charts.barList(d.location, { colors: ['var(--chart-6)'] }),
    });
    // Voicedrop-only lifecycle panels (existing)
    if (d.call_funnel.length) {
      cards.funnel = (cls) => UI.chartCard({
        title: 'Call activity', subtitle: 'Each stage of the dial-out lifecycle', cls,
        body: `<div class="funnel">${d.call_funnel.map((f, i) => {
          const c = ['var(--chart-1)', 'var(--chart-4)', 'var(--chart-positive)', 'var(--chart-6)'][i];
          return `<div class="funnel-step" data-tip="${tip(f.label, [{ label: 'Calls', value: fmt(f.value), color: c }, { label: 'Of initiated', value: pct(f.value, d.call_funnel[0].value) }])}"><span class="stat-label"><i class="legend-swatch" style="background:${c}"></i>${f.label}</span><span class="stat-value" style="font-size:17px">${fmt(f.value)}</span><div class="funnel-bar"><span style="height:${(f.value / d.call_funnel[0].value) * 100}%;background:${c}"></span></div><span class="stat-sub">${pct(f.value, d.call_funnel[0].value)}</span></div>`;
        }).join('')}</div>`,
      });
      cards.duration = (cls) => UI.chartCard({
        title: 'Call duration', subtitle: 'Connected calls grouped by length', cls,
        body: Charts.columns(d.call_duration, { color: ['var(--chart-1)', 'var(--chart-1)', 'var(--chart-1)', 'var(--chart-1)'], height: 132 }),
      });
    }

    const kpiRow = `<div class="kpi-grid${five ? ' has-5' : ''}">${kpis.join('')}</div>`;
    if (tab !== 'overview') {
      const single = {
        connection: cards.connection('span-12'), direction: cards.direction('span-12'), peak: cards.peak('span-12'),
        providers: cards.providers('span-12'), reblast: cards.reblast('span-12'), reasons: cards.reasons('span-12'),
      }[tab];
      return `${kpiRow}<div class="dash-grid">${single}</div>`;
    }
    const title = (t) => `<h2 class="dash-section-title">${t}</h2>`;
    return `${kpiRow}
      <div class="dash-grid">
        ${title('Call outcomes')}
        ${cards.connection('span-6')}${cards.direction('span-6')}
        ${title('Capacity & follow-up')}
        ${cards.peak('span-8')}${cards.reblast('span-4')}
        ${title('Routing')}
        ${cards.providers('span-6 xl-span-4')}${cards.reasons('span-6 xl-span-4')}${cards.location('span-12 xl-span-4')}
        ${cards.funnel ? `${title('Call lifecycle · Voicedrop only')}${cards.funnel('span-7')}${cards.duration('span-5')}` : ''}
      </div>`;
  }

  // ═════════════════════════════════════════════════════════════════════
  // Campaign metrics
  // ═════════════════════════════════════════════════════════════════════
  function campaign(route) {
    const service = route.service;
    const meta = D.SERVICES[service];
    const C = S.campaign;
    const st = screenState();
    const views = [
      { id: 'account', label: 'Account wise', icon: 'users' },
      { id: 'provider', label: 'Service provider wise', icon: 'radio' },
      { id: 'location', label: 'Location wise', icon: 'map-pin' },
      ...(service === 'voicedrop' ? [{ id: 'campaigns', label: 'Campaigns', icon: 'megaphone' }] : []),
    ];
    const view = views.some((v) => v.id === C.view) ? C.view : 'account';
    const head = pageHead({
      title: `${meta.name} · Campaign metrics`,
      sub: `One day at a time ${dot} <span class="num">${UI.SHORT(S.campaignDate.from)}</span>`,
      actions: st === 'ready' ? UI.btn({ label: 'Export CSV', icon: 'download', variant: 'secondary', action: 'toast', arg: 'Table exported as CSV' }) : '',
    });
    if (st === 'empty') return `<div class="page">${head}${emptyDataset('per-account, carrier and location tables')}</div>`;

    const search = S.view === 'noresults' ? '7799xx' : C.search;
    const placeholder = view === 'account' ? 'Search account, CRN or CPIN…' : view === 'campaigns' ? 'Search by CRN, account, client or name…' : view === 'provider' ? 'Search service provider…' : 'Search location…';
    const toolbar = `<div class="table-toolbar">
      <div class="input-wrap" style="width:320px">${icon('search', 'icon-sm')}<input id="campaign-search" data-input="campaign-search" placeholder="${placeholder}" value="${esc(search)}"></div>
      <span class="topbar-spacer"></span>
      <span class="muted" style="font-size:12px">${st === 'ready' ? 'Click a column to sort' : ''}</span>
    </div>`;

    let table;
    let count = '';
    if (st === 'loading') table = UI.tableSkeleton(8, 7);
    else if (st === 'error') table = errorState('POST /api/campaign/account-wise').replace('class="card"', 'class=""');
    else {
      const res = campaignTable(service, view, search);
      table = res.html;
      count = res.count;
    }
    return `<div class="page">${head}${uploadFailedBanner()}
      ${UI.tabs(views, view, 'campaign-view')}
      <section class="card table-card">${toolbar}${table}
        ${st === 'ready' && count ? `<div class="table-foot"><span>${count}</span><span class="pager">${UI.btn({ icon: 'chevron-left', variant: 'ghost', size: 'sm', title: 'Previous page', disabled: true })}<span class="num">Page 1 of 1</span>${UI.btn({ icon: 'chevron-right', variant: 'ghost', size: 'sm', title: 'Next page', disabled: true })}</span></div>` : ''}
      </section></div>`;
  }

  function sortRows(rows, sort) {
    if (!sort) return rows;
    return [...rows].sort((a, b) => {
      const x = a[sort.key];
      const y = b[sort.key];
      const r = typeof x === 'number' ? x - y : String(x).localeCompare(String(y));
      return sort.dir === 'asc' ? r : -r;
    });
  }

  function noMatch(q, what) {
    return UI.state({ icon: 'search-x', title: `No ${what} match “${esc(q)}”`, desc: 'Check the spelling or number, or clear the search to see every row for this day.', actions: UI.btn({ label: 'Clear search', icon: 'x', variant: 'secondary', action: 'clear-search' }), card: false, compact: true });
  }

  function campaignTable(service, view, q) {
    const sort = S.campaign.sort;
    const needle = q.trim().toLowerCase();
    if (view === 'account') {
      let rows = D.campaignAccounts(service);
      if (needle) rows = rows.filter((r) => r.account.includes(needle) || r.name.toLowerCase().includes(needle) || r.crns.some((c) => c.crn.includes(needle) || (c.cpin || '').includes(needle)));
      if (!rows.length) return { html: noMatch(q, 'accounts') };
      rows = sortRows(rows, sort);
      const cols = [
        { key: 'account', label: 'Account', sortable: true }, { key: 'total_size', label: 'Total size', align: 'right', sortable: true }, { key: 'connected_size', label: 'Connected', align: 'right', sortable: true },
        { key: 'not_connected_size', label: 'Not connected', align: 'right', sortable: true }, { key: 'connected_percentage', label: 'Connected %', sortable: true }, { key: 'total_minutes', label: 'Total minutes', align: 'right', sortable: true }, { key: 'a', label: '', width: '56px' },
      ];
      const body = rows.flatMap((r) => {
        const open = S.campaign.expanded.includes(r.account);
        const main = `<tr><td><button class="expand-btn${open ? ' is-open' : ''}" data-action="expand" data-arg="${r.account}" aria-expanded="${open}" aria-label="Show CRNs for ${r.account}">${icon('chevron-right', 'icon-sm')}</button><span class="cell-strong num">${r.account}</span> <span class="muted">· ${esc(r.name)}</span></td>
          <td class="ta-r">${fmt(r.total_size)}</td><td class="ta-r">${fmt(r.connected_size)}</td><td class="ta-r">${fmt(r.not_connected_size)}</td><td>${UI.meter(r.connected_percentage)}</td><td class="ta-r">${fmt(r.total_minutes)}</td>
          <td class="ta-r">${UI.btn({ icon: 'bar-chart', variant: 'ghost', size: 'sm', title: 'View charts', action: 'insight', arg: r.account })}</td></tr>`;
        const subs = open ? r.crns.map((c) => `<tr class="sub-row"><td>CRN <span class="num cell-strong">${c.crn}</span>${c.cpin ? ` <span class="muted">· CPIN ${c.cpin}</span>` : ''}</td><td class="ta-r">${fmt(c.total_size)}</td><td class="ta-r">${fmt(c.connected_size)}</td><td class="ta-r">${fmt(c.not_connected_size)}</td><td>${UI.meter(c.connected_percentage)}</td><td class="ta-r">${fmt(c.total_minutes)}</td><td></td></tr>`) : [];
        return [main, ...subs];
      });
      return { html: UI.table({ cols, rows: body, sort }), count: `${rows.length} accounts · ${fmt(rows.reduce((t, r) => t + r.total_size, 0))} calls` };
    }
    if (view === 'campaigns') {
      let rows = D.CAMPAIGNS.map((r) => ({ ...r, connected_percentage: (r.connected / r.dialout_count) * 100 }));
      if (needle) rows = rows.filter((r) => [r.crn, r.account_id, r.client_id, r.name.toLowerCase()].some((v) => v.includes(needle)));
      if (!rows.length) return { html: noMatch(q, 'campaigns') };
      rows = sortRows(rows, sort.key in rows[0] ? sort : { key: 'start_time', dir: 'asc' });
      const cols = [
        { key: 'start_time', label: 'Time', sortable: true }, { key: 'name', label: 'Campaign', sortable: true }, { key: 'account_id', label: 'Account', sortable: true },
        { key: 'phone_number_count', label: 'Numbers', align: 'right', sortable: true }, { key: 'dnd_count', label: 'DND', align: 'right', sortable: true }, { key: 'blast_count', label: 'Blast', align: 'right', sortable: true },
        { key: 'unblast_count', label: 'Unblast', align: 'right', sortable: true }, { key: 'connected', label: 'Connected', align: 'right', sortable: true }, { key: 'connected_percentage', label: 'Connected %', sortable: true }, { key: 'a', label: '' },
      ];
      const body = rows.map((r) => `<tr><td class="num">${r.start_time}–${r.end_time}</td><td><span class="cell-strong">${esc(r.name)}</span><span class="cell-sub">CRN ${r.crn} · ${r.booking_reference}</span></td><td class="num">${r.account_id}<span class="cell-sub">Client ${r.client_id}</span></td>
        <td class="ta-r">${fmt(r.phone_number_count)}</td><td class="ta-r">${fmt(r.dnd_count)}</td><td class="ta-r">${fmt(r.blast_count)}</td><td class="ta-r" ${r.unblast_count ? `style="color:var(--color-status-warning)"` : ''}>${fmt(r.unblast_count)}</td><td class="ta-r">${fmt(r.connected)}</td><td>${UI.meter(r.connected_percentage)}</td>
        <td class="ta-r">${UI.btn({ icon: 'download', variant: 'ghost', size: 'sm', title: `Download call records for CRN ${r.crn}`, action: 'toast', arg: `Call records for CRN ${r.crn} downloaded (${fmt(r.phone_number_count)} rows)` })}</td></tr>`);
      return { html: UI.table({ cols, rows: body, sort }), count: `${rows.length} campaigns` };
    }
    let rows = D.campaignBreakdown(view, service);
    if (needle) rows = rows.filter((r) => r.label.toLowerCase().includes(needle));
    if (!rows.length) return { html: noMatch(q, view === 'provider' ? 'providers' : 'locations') };
    rows = sortRows(rows, sort.key in rows[0] ? sort : null);
    const cols = [
      { key: 'label', label: view === 'provider' ? 'Service provider' : 'Location', sortable: true }, { key: 'total_size', label: 'Total size', align: 'right', sortable: true }, { key: 'connected_size', label: 'Connected', align: 'right', sortable: true },
      { key: 'not_connected_size', label: 'Not connected', align: 'right', sortable: true }, { key: 'connected_percentage', label: 'Connected %', sortable: true },
    ];
    const body = rows.map((r) => `<tr><td class="cell-strong">${r.label}</td><td class="ta-r">${fmt(r.total_size)}</td><td class="ta-r">${fmt(r.connected_size)}</td><td class="ta-r">${fmt(r.not_connected_size)}</td><td>${UI.meter(r.connected_percentage)}</td></tr>`);
    return { html: UI.table({ cols, rows: body, sort }), count: `${rows.length} ${view === 'provider' ? 'providers' : 'locations'}` };
  }

  function insightModal(account) {
    const a = D.campaignAccounts(S.route.service).find((r) => r.account === account);
    if (!a) return '';
    const fails = a.not_connected_size;
    return `<div class="overlay" data-action="close-modal-bg"><div class="modal" style="width:720px" role="dialog" aria-modal="true" aria-label="Account ${account} insight">
      <div class="modal-head"><span class="kpi-icon" style="width:40px;height:40px">${icon('bar-chart', 'icon-lg')}</span><div style="flex:1"><h2 class="modal-title">Account ${account} · ${esc(a.name)}</h2><p class="modal-desc">${D.SERVICES[S.route.service].name} · ${UI.SHORT(S.campaignDate.from)}</p></div>${UI.btn({ icon: 'x', variant: 'ghost', title: 'Close', action: 'close-modal' })}</div>
      <div class="modal-body" style="display:flex;flex-direction:column;gap:20px">
        <div class="stat-pair" style="grid-template-columns:repeat(4,1fr)">
          <div class="stat"><span class="stat-label">Dial attempts</span><span class="stat-value">${fmt(a.total_size)}</span></div>
          <div class="stat"><span class="stat-label">Connected</span><span class="stat-value">${fmt(a.connected_size)}</span><span class="stat-sub">${a.connected_percentage.toFixed(1)}%</span></div>
          <div class="stat"><span class="stat-label">Failed</span><span class="stat-value">${fmt(fails)}</span></div>
          <div class="stat"><span class="stat-label">Minutes</span><span class="stat-value">${fmt(a.total_minutes)}</span></div></div>
        <div class="dash-grid" style="gap:16px">
          <div class="span-6"><div class="card-subtitle" style="margin-bottom:10px">Failed attempts</div>${Charts.barList([{ label: 'Never rang', value: Math.round(fails * 0.38) }, { label: 'Rang, unanswered', value: fails - Math.round(fails * 0.38) }], { colors: ['var(--chart-4)', 'var(--chart-negative)'] })}</div>
          <div class="span-6"><div class="card-subtitle" style="margin-bottom:10px">Carrier share of attempts</div>${Charts.barList([['Airtel', 0.37], ['Jio', 0.33], ['Vodafone Idea', 0.2], ['BSNL', 0.1]].map(([l, s]) => ({ label: l, value: Math.round(a.total_size * s) })), { colors: ['var(--chart-1)'] })}</div>
        </div>
      </div>
      <div class="modal-foot">${UI.btn({ label: 'Download CSV', icon: 'download', variant: 'secondary', action: 'toast', arg: 'Account insight exported' })}${UI.btn({ label: 'Done', variant: 'primary', action: 'close-modal' })}</div>
    </div></div>`;
  }

  // ═════════════════════════════════════════════════════════════════════
  // MultiCall registration lookup (existing page)
  // ═════════════════════════════════════════════════════════════════════
  function registry() {
    const st = screenState();
    const head = pageHead({ title: 'MultiCall · Registration lookup', sub: 'Find a registered MultiCall account by number, email or registration ID' });
    const form = `<form class="filter-bar" data-form="registry">
      <div class="field" style="width:200px"><label class="field-label" for="r-reg">Registration ID</label><input class="input" id="r-reg" placeholder="e.g. MC-20419"></div>
      <div class="field" style="width:200px"><label class="field-label" for="r-phone">Phone number</label><input class="input" id="r-phone" placeholder="+91 98201 44821"></div>
      <div class="field" style="width:260px"><label class="field-label" for="r-email">Email</label><input class="input" id="r-email" placeholder="name@company.com"></div>
      <div class="filter-bar-actions">${UI.btn({ label: 'Clear', variant: 'ghost', action: 'toast', arg: 'Search cleared' })}${UI.btn({ label: 'Search', icon: 'search', variant: 'primary', type: 'submit' })}</div></form>`;
    let body;
    if (st === 'loading') body = `<section class="card table-card">${UI.tableSkeleton(5, 6)}</section>`;
    else if (st === 'error') body = errorState('GET /api/multicall/registry');
    else if (st === 'noresults' || st === 'empty')
      body = UI.state({ icon: 'search-x', title: st === 'empty' ? 'Search for an account' : 'No accounts match “+91 90000 00000”', desc: st === 'empty' ? 'Enter a registration ID, phone number or email above. Registry data comes from the MultiCall portal, not the uploaded dataset.' : 'Try the number without the country code, or search by email instead.', actions: '' });
    else
      body = `<section class="card table-card"><div class="table-toolbar"><h3 class="card-title">Accounts</h3><span class="badge">${D.REGISTRY.length}</span><span class="topbar-spacer"></span>${UI.btn({ label: 'Download CSV', icon: 'download', variant: 'ghost', size: 'sm', action: 'toast', arg: 'Accounts exported' })}</div>
        ${UI.table({ cols: [{ label: 'Account' }, { label: 'Phone' }, { label: 'Email' }, { label: 'Profiles', align: 'right' }, { label: 'Source' }, { label: 'Last updated' }, { label: '' }], rows: D.REGISTRY.map((r) => `<tr><td><span class="cell-strong">${esc(r.account)}</span><span class="cell-sub">Reg #${r.reg}</span></td><td class="num">${r.phone}</td><td>${r.email}</td><td class="ta-r">${r.profiles}</td><td>${UI.badge(r.source, 'neutral', false)}</td><td class="num muted">${r.updated}</td><td class="ta-r">${UI.btn({ label: 'Open', iconRight: 'chevron-right', variant: 'ghost', size: 'sm', action: 'toast', arg: 'Opens the account and its profiles' })}</td></tr>`) })}</section>`;
    return `<div class="page">${head}${form}${body}</div>`;
  }

  // ═════════════════════════════════════════════════════════════════════
  // Upload data
  // ═════════════════════════════════════════════════════════════════════
  function upload() {
    const U = S.upload;
    const st = S.transient || S.view === 'loading' ? 'loading' : S.view === 'error' ? 'error' : 'ready';
    // In the "Upload failed" prototype state the page opens on the failed card;
    // "Try another file" sets `retry` so the drop zone comes back and the next
    // upload can be watched failing live.
    const failed = U.phase === 'failed' || (S.view === 'uploadfailed' && U.phase === 'idle' && !U.retry);
    const busy = ['uploading', 'validating', 'indexing'].includes(U.phase);
    const hasDs = S.dataset && S.view !== 'empty';
    const head = pageHead({
      title: 'Upload data',
      sub: `One dataset is active at a time ${dot} uploading a new file replaces it ${dot} data stays until the next upload`,
      actions: hasDs && !busy ? UI.btn({ label: 'Download sample file', icon: 'download', variant: 'ghost', action: 'toast', arg: 'sample_cdr_codr.parquet (2.1 MB) downloaded' }) : '',
    });
    if (st === 'loading') return `<div class="page">${head}<div class="upload-layout"><div style="display:flex;flex-direction:column;gap:20px">${UI.chartSkeleton({ height: 90 })}${UI.chartSkeleton({ height: 160 })}</div>${UI.chartSkeleton({ height: 260 })}</div></div>`;
    if (st === 'error') return `<div class="page">${head}${errorState('GET /api/dataset/status')}</div>`;

    const ds = S.datasetInfo;
    const active = hasDs
      ? `<section class="card" aria-label="Active dataset">
          <div class="dataset-card"><span class="file-icon">${icon('database', 'icon-lg')}</span>
            <div style="min-width:0"><div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><span class="card-title" style="font-size:15px">${esc(ds.file)}</span>${UI.badge('Active', 'success')}${busy ? UI.badge('Stays active until the new file is ready', 'info', false) : ''}</div>
              <p class="card-subtitle" style="font-size:13px;margin-top:4px">Uploaded by ${ds.uploadedBy} on ${ds.uploadedAt} · processed in ${ds.processing}</p></div>
            <a class="btn btn-secondary" href="#/analytics/all">${icon('layout-grid')}Open dashboard</a></div>
          <div class="dataset-meta">
            <div class="stat"><span class="stat-label">Date coverage</span><span class="stat-value num">${UI.SHORT_NY(ds.from)} – ${UI.SHORT(ds.to)}</span></div>
            <div class="stat"><span class="stat-label">Total rows</span><span class="stat-value num">${fmt(ds.rows)}</span></div>
            <div class="stat"><span class="stat-label">CDR / CODR rows</span><span class="stat-value num">${compact(ds.cdrRows)} / ${compact(ds.codrRows)}</span></div>
            <div class="stat"><span class="stat-label">File size</span><span class="stat-value num">${ds.size}</span></div>
          </div></section>`
      : '';

    let main;
    if (busy || U.phase === 'done' || failed) main = processCard(U, failed, hasDs);
    else
      main = `<section aria-label="Upload a file">${hasDs ? '<h2 class="card-title" style="margin:4px 0 10px">Replace with a new file</h2>' : ''}${UI.uploadBox({ compact: hasDs })}
        ${hasDs ? `<p class="field-hint" style="margin-top:8px;display:flex;gap:6px;align-items:center">${icon('info', 'icon-sm')}You'll be asked to confirm before the active dataset is replaced.</p>` : ''}</section>`;

    const intro = !hasDs && !busy && U.phase === 'idle' && !failed
      ? UI.banner({ tone: 'info', icon: 'database', title: 'No dataset uploaded yet', body: 'Every dashboard, campaign table, report and the AI assistant read from the dataset you upload here. Start with one Parquet file that holds the CDR and CODR columns.' })
      : '';

    const history = S.view === 'empty' || !S.dataset ? [] : S.uploads;
    return `<div class="page">${head}${intro}
      <div class="upload-layout">
        <div style="display:flex;flex-direction:column;gap:20px;min-width:0">${active}${main}</div>
        <aside style="display:flex;flex-direction:column;gap:20px">
          <section class="card"><header class="card-header"><h3 class="card-title">Before you upload</h3></header><div class="card-body"><ul class="rule-list">
            <li>${icon('check-circle')}<span><strong>.parquet</strong> file, up to 5 GB</span></li>
            <li>${icon('check-circle')}<span>CDR columns (CALL_DATE, CRN, CONFEREE_SEQ_NO, TEL_DIGIT…) and CODR columns (MODULE_TYPE, CONF_NUM, CHAIR_PIN…)</span></li>
            <li>${icon('check-circle')}<span>Up to 92 days of calls in one file</span></li>
            <li>${icon('check-circle')}<span>Processing takes about 5–8 minutes for 2 GB</span></li>
            <li>${icon('alert-triangle')}<span>Uploading <strong>replaces</strong> the active dataset for everyone, including scheduled reports</span></li>
          </ul></div></section>
          <section class="card"><header class="card-header"><h3 class="card-title">Recent uploads</h3></header>
            <div class="side-list" style="margin-top:8px">${history.length ? history.map((u) => `<div class="side-list-item"><span class="file-icon" style="width:30px;height:30px">${icon('file', 'icon-sm')}</span><div style="flex:1;min-width:0"><div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500" title="${esc(u.file)}">${esc(u.file)}</div><div class="muted" style="font-size:12px">${u.size} · ${u.by} · ${u.at}${u.reason ? ` · <span style="color:var(--color-status-danger)">${u.reason}</span>` : ''}</div></div>${UI.badge(u.status)}</div>`).join('') : `<div class="side-list-item muted">No uploads yet.</div>`}</div>
          </section>
        </aside>
      </div></div>`;
  }

  /** One number for the whole job: the transfer is ~55% of it, checks and indexing the rest. */
  function overallProgress(U) {
    return U.phase === 'done' ? 100 : U.phase === 'uploading' ? U.progress * 0.55 : U.phase === 'validating' ? 62 : 84;
  }

  function processCard(U, failed, hasDs) {
    const f = D.NEW_FILE;
    const stepDefs = [
      ['Uploading file', U.phase === 'uploading' ? `${(1.91 * U.progress / 100).toFixed(2)} of 1.91 GB · about ${Math.max(1, Math.round((100 - U.progress) / 25))} min left` : '1.91 GB transferred'],
      ['Checking columns and types', failed ? 'Missing required column CONFEREE_TYPE (CDR)' : '43 CDR + 18 CODR columns found'],
      ['Building dashboard tables', 'Daily aggregates, peak-port buckets, provider and reason indexes'],
      ['Switching to the new dataset', hasDs ? 'The previous dataset is replaced only after this step' : 'Dashboards open as soon as this finishes'],
    ];
    const at = failed ? 1 : { uploading: 0, validating: 1, indexing: 2, done: 4 }[U.phase];
    const steps = stepDefs.map(([title, desc], i) => {
      const cls = failed && i === 1 ? 'is-failed' : i < at ? 'is-done' : i === at ? 'is-active' : 'is-pending';
      const dotIc = cls === 'is-done' ? icon('check', 'icon-sm') : cls === 'is-failed' ? icon('x', 'icon-sm') : cls === 'is-active' ? '<span class="spinner" style="width:10px;height:10px;border-width:2px"></span>' : '';
      return `<div class="step ${cls}"><span class="step-dot">${dotIc}</span><div><div class="step-title">${title}</div>${cls !== 'is-pending' ? `<div class="step-desc" ${cls === 'is-failed' ? 'style="color:var(--color-status-danger)"' : ''}>${desc}</div>` : ''}</div><span class="step-time num">${cls === 'is-done' ? ['0:52', '0:14', '4:38', '0:03'][i] : ''}</span></div>`;
    }).join('');
    const pctDone = failed ? 38 : overallProgress(U);
    const header = U.phase === 'done'
      ? UI.banner({ tone: 'success', title: 'Dataset ready', body: `${fmt(f.rows)} rows · ${UI.SHORT_NY(f.from)} – ${UI.SHORT(f.to)} · now active for everyone`, actions: `<a class="btn btn-primary btn-sm" href="#/analytics/all">Open dashboard ${icon('arrow-right', 'icon-sm')}</a>` })
      : failed
        ? UI.banner({ tone: 'danger', title: 'Upload failed — nothing was replaced', body: hasDs ? 'The previous dataset is still active, so dashboards and reports are unaffected.' : 'Fix the file and upload it again.', actions: `${UI.btn({ label: 'Error report', icon: 'download', size: 'sm', variant: 'secondary', action: 'toast', arg: 'upload_errors.csv downloaded' })}${UI.btn({ label: 'Try another file', icon: 'refresh', size: 'sm', variant: 'primary', action: 'upload-reset' })}` })
        : '';
    return `<section class="card process-card" aria-live="polite">${header}
      <div class="process-file"><span class="file-icon">${icon('file', 'icon-lg')}</span><div style="flex:1;min-width:0"><div class="process-file-name">${f.file}</div><div class="muted" style="font-size:12px">${f.size} · selected by Mukesh K.</div></div>
        ${U.phase === 'done' ? UI.badge('Ready') : failed ? UI.badge('Failed') : `${UI.badge('Processing', 'info')}${UI.btn({ label: 'Cancel', variant: 'ghost', size: 'sm', action: 'upload-cancel' })}`}</div>
      <div><div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:6px"><span class="muted">${U.phase === 'done' ? 'Complete' : failed ? 'Stopped at column check' : 'Overall progress'}</span><span class="num" style="font-weight:600">${Math.round(pctDone)}%</span></div>
        <div class="progress"><span style="width:${pctDone}%;${failed ? 'background:var(--color-status-danger)' : U.phase === 'done' ? 'background:var(--color-status-success)' : ''}"></span></div></div>
      <div class="steps">${steps}</div>
      ${!failed && U.phase !== 'done' ? `<p class="field-hint">You can leave this page — processing continues and the sidebar shows progress.</p>` : ''}
    </section>`;
  }

  function replaceModal() {
    const ds = S.datasetInfo;
    const f = D.NEW_FILE;
    return `<div class="overlay" data-action="close-modal-bg"><div class="modal" role="alertdialog" aria-modal="true" aria-labelledby="replace-title">
      <div class="modal-head"><span class="state-icon is-warning" style="width:40px;height:40px;margin:0">${icon('alert-triangle', 'icon-lg')}</span><div><h2 class="modal-title" id="replace-title">Replace the active dataset?</h2>
        <p class="modal-desc">Only one dataset can be active. When the new file finishes processing, the current one is removed for everyone — dashboards, campaign tables, scheduled reports and the assistant.</p></div></div>
      <div class="modal-body" style="display:flex;flex-direction:column;gap:12px">
        <div class="mini-stat" style="display:flex;gap:12px;align-items:center"><span class="file-icon" style="width:34px;height:34px">${icon('database', 'icon-sm')}</span><div style="flex:1;min-width:0"><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;font-weight:600">Will be removed</div><div style="font-weight:500;overflow:hidden;text-overflow:ellipsis">${ds.file}</div><div class="muted num" style="font-size:12px">${UI.SHORT_NY(ds.from)} – ${UI.SHORT(ds.to)} · ${fmt(ds.rows)} rows</div></div></div>
        <div class="mini-stat" style="display:flex;gap:12px;align-items:center;border-color:var(--color-border-focus)"><span class="file-icon" style="width:34px;height:34px;background:var(--color-brand-subtle);color:var(--color-brand-text)">${icon('file', 'icon-sm')}</span><div style="flex:1;min-width:0"><div style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;font-weight:600;color:var(--color-brand-text)">New file</div><div style="font-weight:500">${f.file}</div><div class="muted num" style="font-size:12px">${f.size} · dates read after upload</div></div></div>
        ${UI.banner({ tone: 'info', title: 'Nothing changes until processing succeeds', body: 'If the new file fails its checks, the current dataset stays active.' })}
        <label class="check" style="margin-top:4px"><input type="checkbox" id="replace-ack" data-action="ack"> I understand the current dataset will be replaced for all users</label>
      </div>
      <div class="modal-foot">${UI.btn({ label: 'Cancel', variant: 'ghost', action: 'close-modal' })}${UI.btn({ label: 'Replace dataset', icon: 'cloud-upload', variant: 'danger', action: 'upload-start', disabled: !S.upload.ack, id: 'replace-confirm' })}</div>
    </div></div>`;
  }

  // ═════════════════════════════════════════════════════════════════════
  // Reports
  // ═════════════════════════════════════════════════════════════════════
  function reports() {
    const R = S.reports;
    const st = screenState();
    const head = pageHead({ title: 'Reports', sub: `Scheduled exports of the dashboard, delivered by email ${dot} runs against the active dataset`, actions: st !== 'empty' || S.dataset ? UI.btn({ label: 'New schedule', icon: 'plus', variant: 'primary', action: 'new-schedule' }) : '' });
    const tabItems = [{ id: 'scheduled', label: 'Scheduled', icon: 'clock', count: st === 'empty' ? 0 : S.schedules.length }, { id: 'history', label: 'History', icon: 'history', count: st === 'empty' ? 0 : D.HISTORY.length }];
    let body;
    if (st === 'loading') body = `<section class="card table-card">${UI.tableSkeleton(6, 7)}</section>`;
    else if (st === 'error') body = errorState(R.tab === 'scheduled' ? 'GET /api/reports/schedules' : 'GET /api/reports/runs');
    else if (st === 'empty')
      body = R.tab === 'scheduled'
        ? UI.state({ icon: 'clock', tone: 'brand', title: 'No scheduled reports yet', desc: S.dataset ? 'Schedule a daily, weekly or monthly export of any dashboard and it will be emailed as CSV, Excel or PDF.' : 'Reports run against the active dataset. Upload data first, then schedule exports here.', actions: S.dataset ? UI.btn({ label: 'New schedule', icon: 'plus', variant: 'primary', action: 'new-schedule' }) : `<a class="btn btn-primary" href="#/upload">${icon('cloud-upload')}Upload data</a>` })
        : UI.state({ icon: 'history', title: 'No reports have run yet', desc: 'Every run of a schedule appears here with its status and a download link for 30 days.' });
    else if (R.tab === 'scheduled') body = scheduledTable();
    else body = historyTable(st === 'noresults');
    return `<div class="page">${head}${uploadFailedBanner()}${UI.tabs(tabItems, R.tab, 'reports-tab')}${body}</div>`;
  }

  function scheduledTable() {
    const rows = S.schedules.map((r) => `<tr>
      <td><div class="report-name"><span class="report-icon">${icon(D.SERVICES[r.service].icon, 'icon-sm')}</span><div><span class="cell-strong">${esc(r.name)}</span><span class="cell-sub">${D.SERVICES[r.service].name} · ${r.metrics.length} sections · ${r.range}${r.account ? ` · Account ${r.account}` : ''}</span></div></div></td>
      <td>${r.freq}<span class="cell-sub">${r.day ? `${r.day} · ` : ''}${r.time} IST</span></td>
      <td>${UI.badge(r.format, 'neutral', false).replace('class="badge"', 'class="badge badge-outline"')}</td>
      <td><span title="${r.recipients.join(', ')}">${r.recipients[0]}</span>${r.recipients.length > 1 ? ` <span class="badge" style="height:20px">+${r.recipients.length - 1}</span>` : ''}</td>
      <td class="num">${r.active ? r.next : '<span class="muted">Paused</span>'}</td>
      <td>${UI.badge(r.last)}</td>
      <td><button class="switch" role="switch" aria-checked="${r.active}" aria-label="${r.active ? 'Pause' : 'Resume'} ${esc(r.name)}" data-action="toggle-schedule" data-arg="${r.id}"></button></td>
      <td class="ta-r"><span class="row-actions">${UI.btn({ icon: 'play', variant: 'ghost', size: 'sm', title: 'Run now', action: 'toast', arg: `“${r.name}” queued — it will appear in History` })}${UI.btn({ icon: 'pencil', variant: 'ghost', size: 'sm', title: 'Edit schedule', action: 'edit-schedule', arg: r.id })}${UI.btn({ icon: 'trash', variant: 'ghost', size: 'sm', title: 'Delete schedule', action: 'toast', arg: 'Delete asks for confirmation first' })}</span></td></tr>`);
    return `<section class="card table-card">${UI.table({ cols: [{ label: 'Report' }, { label: 'Frequency' }, { label: 'Format' }, { label: 'Recipients' }, { label: 'Next run' }, { label: 'Last run' }, { label: 'Active' }, { label: '', width: '120px' }], rows })}</section>`;
  }

  function historyTable(noResults) {
    const f = noResults ? 'Running' : S.reports.histFilter;
    let rows = D.HISTORY.filter((h) => f === 'all' || h.status === f);
    if (noResults) rows = [];
    const toolbar = `<div class="table-toolbar">${UI.segmented([{ id: 'all', label: 'All' }, { id: 'Delivered', label: 'Delivered' }, { id: 'Failed', label: 'Failed' }, { id: 'Running', label: 'Running' }, { id: 'Queued', label: 'Queued' }], f, 'hist-filter')}<span class="topbar-spacer"></span><div class="input-wrap" style="width:260px">${icon('search', 'icon-sm')}<input placeholder="Search reports…" value="${noResults ? 'Account 999999' : ''}"></div></div>`;
    if (!rows.length) return `<section class="card table-card">${toolbar}${UI.state({ icon: 'search-x', title: 'No runs match these filters', desc: 'Try another status or clear the search.', actions: UI.btn({ label: 'Show all runs', variant: 'secondary', action: 'hist-filter', arg: 'all' }), card: false, compact: true })}</section>`;
    const body = rows.map((h) => `<tr><td><span class="cell-strong">${esc(h.report)}</span>${h.reason ? `<span class="cell-sub" style="color:var(--color-status-danger)">${esc(h.reason)}</span>` : ''}</td><td class="num">${h.at}</td><td class="num">${h.range}</td><td>${h.format}</td><td>${h.status === 'Running' ? `<span class="badge badge-info"><span class="spinner" style="width:10px;height:10px;border-width:1.5px"></span>Running</span>` : UI.badge(h.status)}</td><td class="ta-r muted">${h.size}</td>
      <td class="ta-r">${h.status === 'Delivered' ? UI.btn({ label: 'Download', icon: 'download', variant: 'secondary', size: 'sm', action: 'toast', arg: `${h.report} (${h.format}, ${h.size}) downloaded` }) : h.status === 'Failed' ? UI.btn({ label: 'Retry', icon: 'refresh', variant: 'ghost', size: 'sm', action: 'toast', arg: 'Run queued again' }) : UI.btn({ label: 'Download', icon: 'download', variant: 'secondary', size: 'sm', disabled: true })}</td></tr>`);
    return `<section class="card table-card">${toolbar}${UI.table({ cols: [{ label: 'Report' }, { label: 'Run at' }, { label: 'Data range' }, { label: 'Format' }, { label: 'Status' }, { label: 'Size', align: 'right' }, { label: '', width: '130px' }], rows: body })}
      <div class="table-foot"><span>${rows.length} runs · files are kept for 30 days</span></div></section>`;
  }

  function scheduleDrawer() {
    const id = S.reports.drawer;
    const r = id === 'new' ? { name: '', service: S.route.service && S.route.service !== 'all' ? S.route.service : 'voicedrop', freq: 'Daily', time: '08:00', day: 'Monday', format: 'XLSX', range: 'Previous day', metrics: ['kpi', 'direction', 'connection', 'peak', 'providers', 'reblast', 'reasons'], account: '' } : S.schedules.find((s) => s.id === id);
    const rec = S.reports.recipients;
    const fr = S.reports.freq || r.freq;
    return `<div class="overlay is-drawer" data-action="close-modal-bg"><form class="drawer" data-form="schedule" role="dialog" aria-modal="true" aria-labelledby="drawer-title">
      <div class="drawer-head"><div><h2 class="modal-title" id="drawer-title">${id === 'new' ? 'New scheduled report' : 'Edit schedule'}</h2><p class="modal-desc">Exports the dashboard sections you pick and emails them on a schedule.</p></div>${UI.btn({ icon: 'x', variant: 'ghost', title: 'Close', action: 'close-modal' })}</div>
      <div class="drawer-body">
        <div class="form-section"><span class="form-section-title">Report</span>
          <div class="field"><label class="field-label" for="s-name">Report name</label><input class="input" id="s-name" name="name" placeholder="e.g. Daily Voicedrop summary" value="${esc(r.name)}" required></div>
          <div class="field"><span class="field-label">Service</span>${UI.segmented(Object.values(D.SERVICES).map((s) => ({ id: s.id, label: s.short })), S.reports.service || r.service, 'sched-service')}</div>
        </div>
        <div class="form-section"><span class="form-section-title">Contents</span>
          <div class="check-grid">${D.METRIC_OPTIONS.map(([k, l]) => `<label class="check"><input type="checkbox" name="m-${k}" ${r.metrics.includes(k) ? 'checked' : ''}>${l}</label>`).join('')}</div>
          <div class="form-row"><div class="field"><label class="field-label" for="s-range">Date range</label><select class="select" id="s-range">${['Previous day', 'Previous 7 days', 'Month to date', 'Previous month'].map((o) => `<option ${o === r.range ? 'selected' : ''}>${o}</option>`).join('')}</select></div>
            <div class="field"><label class="field-label" for="s-account">Account ID <span class="muted" style="font-weight:400">(optional)</span></label><input class="input" id="s-account" placeholder="All accounts" value="${esc(r.account || '')}"></div></div>
        </div>
        <div class="form-section"><span class="form-section-title">Schedule</span>
          <div class="field"><span class="field-label">Frequency</span>${UI.segmented([{ id: 'Daily', label: 'Daily' }, { id: 'Weekly', label: 'Weekly' }, { id: 'Monthly', label: 'Monthly' }], fr, 'sched-freq')}</div>
          <div class="form-row">${fr === 'Weekly' ? `<div class="field"><label class="field-label" for="s-day">Day</label><select class="select" id="s-day">${['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map((d) => `<option ${d === r.day ? 'selected' : ''}>${d}</option>`).join('')}</select></div>` : fr === 'Monthly' ? `<div class="field"><label class="field-label" for="s-dom">Day of month</label><select class="select" id="s-dom"><option>1st</option><option>15th</option><option>Last day</option></select></div>` : ''}
            <div class="field"><label class="field-label" for="s-time">Time (IST)</label><input class="input" id="s-time" type="time" value="${r.time}"></div></div>
          <div class="schedule-preview">${icon('calendar')}<span>Next run <strong style="color:var(--color-text-primary)">${fr === 'Daily' ? 'tomorrow, Oct 25' : fr === 'Weekly' ? 'Monday, Oct 26' : 'Sunday, Nov 1'} at ${r.time}</strong>, covering ${r.range.toLowerCase()}. Skipped automatically while a new dataset is processing.</span></div>
        </div>
        <div class="form-section"><span class="form-section-title">Delivery</span>
          <div class="field"><span class="field-label">Format</span>${UI.segmented([{ id: 'CSV', label: 'CSV' }, { id: 'XLSX', label: 'Excel' }, { id: 'PDF', label: 'PDF' }], S.reports.format || r.format, 'sched-format')}</div>
          <div class="field"><label class="field-label" for="s-rec">Recipients</label>
            <div class="recipient-input input-wrap" style="height:auto">${rec.map((e, i) => `<span class="chip"><strong>${esc(e)}</strong><button type="button" data-action="remove-recipient" data-arg="${i}" aria-label="Remove ${esc(e)}">${icon('x', 'icon-sm')}</button></span>`).join('')}<input id="s-rec" data-input="recipient" placeholder="${rec.length ? 'Add another…' : 'name@dsnl.in, press Enter'}"></div>
            <span class="field-hint">Files over 20 MB are sent as a download link instead of an attachment.</span></div>
        </div>
      </div>
      <div class="drawer-foot">${id === 'new' ? `<span></span>` : UI.btn({ label: 'Delete', icon: 'trash', variant: 'ghost', action: 'toast', arg: 'Delete asks for confirmation first' })}<span style="display:flex;gap:8px">${UI.btn({ label: 'Send test now', icon: 'send', variant: 'secondary', action: 'toast', arg: `Test report sent to ${rec[0] || 'you'}` })}${UI.btn({ label: id === 'new' ? 'Create schedule' : 'Save changes', icon: 'check', variant: 'primary', type: 'submit' })}</span></div>
    </form></div>`;
  }

  // ═════════════════════════════════════════════════════════════════════
  // AI assistant
  // ═════════════════════════════════════════════════════════════════════
  function assistant() {
    const C = S.chat;
    const st = S.transient || S.view === 'loading' ? 'loading' : S.view === 'error' ? 'error' : S.view === 'empty' ? 'empty' : S.view === 'noresults' ? 'noresults' : 'ready';
    const convos = st === 'empty' ? [] : D.CONVERSATIONS;
    const search = st === 'noresults' ? 'billing' : C.search;
    const shown = convos.filter((c) => !search || c.title.toLowerCase().includes(search.toLowerCase()));
    let list;
    if (st === 'loading') list = Array.from({ length: 6 }, () => `<div style="padding:10px"><div class="skeleton sk-line" style="width:80%"></div><div class="skeleton sk-line" style="width:40%;margin-top:8px;height:8px"></div></div>`).join('');
    else if (!convos.length) list = `<div class="state" style="padding:40px 16px"><span class="state-icon" style="width:40px;height:40px">${icon('message')}</span><p class="muted" style="font-size:13px">Your conversations will appear here.</p></div>`;
    else if (!shown.length) list = `<div class="state" style="padding:40px 16px"><span class="state-icon" style="width:40px;height:40px">${icon('search-x')}</span><p class="muted" style="font-size:13px">No conversations match “${esc(search)}”.</p>${UI.btn({ label: 'Clear search', size: 'sm', variant: 'secondary', action: 'chat-clear-search' })}</div>`;
    else {
      let g = '';
      list = shown.map((c) => {
        const h = c.group !== g ? `<div class="convo-group">${c.group}</div>` : '';
        g = c.group;
        return `${h}<button class="convo-item${c.id === C.active ? ' is-active' : ''}" data-action="open-convo" data-arg="${c.id}"><span class="convo-title">${esc(c.title)}</span><span class="convo-meta">${c.meta}</span></button>`;
      }).join('');
    }

    let thread;
    const msgs = st === 'empty' ? [] : C.active ? C.messages : [];
    if (st === 'loading') thread = `<div class="msg msg-user"><div class="skeleton" style="width:320px;height:40px;border-radius:14px"></div></div><div class="msg msg-ai"><span class="skeleton" style="width:30px;height:30px;border-radius:50%"></span><div style="flex:1;display:flex;flex-direction:column;gap:8px"><div class="skeleton sk-line" style="width:90%"></div><div class="skeleton sk-line" style="width:75%"></div><div class="skeleton" style="height:150px;border-radius:8px;margin-top:6px"></div></div></div>`;
    else if (st === 'error') thread = `${UI.bubble({ role: 'user', text: 'What was the peak port usage for MultiCall last month?', time: '10:24' })}${UI.bubble({ role: 'ai', error: true })}`;
    else if (!msgs.length)
      thread = `<div class="state" style="flex:1;padding:48px 16px"><span class="state-icon is-brand">${icon('sparkles', 'icon-xl')}</span><h3 class="state-title">Ask about the DSNL call data</h3><p class="state-desc">Questions are answered from the active dataset's CDR and CODR records — call legs, connection outcomes, durations, reblasts and disconnect reasons. The assistant says so when it can't answer rather than guessing.</p>
        <div class="suggestions">${D.SUGGESTIONS.map((s) => `<button class="suggestion" data-action="suggest" data-arg="${esc(s)}">${icon('sparkles', 'icon-sm')}<span>${esc(s)}</span></button>`).join('')}</div></div>`;
    else thread = msgs.map(UI.bubble).join('');

    const title = C.active ? (D.CONVERSATIONS.find((c) => c.id === C.active) || { title: 'New chat' }).title : 'New chat';
    return `<div class="assistant">
      <aside class="convo-panel" aria-label="Conversation history">
        <div class="convo-head">${UI.btn({ label: 'New chat', icon: 'plus', variant: 'primary', block: true, action: 'new-chat' })}
          <div class="input-wrap">${icon('search', 'icon-sm')}<input data-input="chat-search" id="chat-search" placeholder="Search conversations" value="${esc(search)}"></div></div>
        <div class="convo-list">${list}</div>
      </aside>
      <section class="chat">
        <div class="chat-head"><div><div class="card-title">${esc(title)}</div><div class="card-subtitle">${S.dataset ? `Answers from ${esc(S.datasetInfo.file)}` : 'No dataset uploaded — answers will be empty'}</div></div>
          <div style="display:flex;gap:4px">${UI.btn({ icon: 'pencil', variant: 'ghost', size: 'sm', title: 'Rename', action: 'toast', arg: 'Rename inline' })}${UI.btn({ icon: 'trash', variant: 'ghost', size: 'sm', title: 'Delete conversation', action: 'toast', arg: 'Delete asks for confirmation first' })}</div></div>
        <div class="chat-scroll" id="chat-scroll">${uploadFailedBanner()}${thread}</div>
        <div class="composer-wrap"><form class="composer" data-form="chat">
          <textarea id="chat-input" name="q" rows="1" placeholder="Ask about the call data — type / for commands" aria-label="Ask a question" ${C.pending ? 'disabled' : ''}></textarea>
          <div class="composer-row">
            ${UI.btn({ icon: 'slash', variant: 'ghost', size: 'sm', title: 'Commands', action: 'toast', arg: 'Commands: /voicedrop /conference /multicall /excel /csv /chart' })}
            <span class="badge badge-outline" style="height:24px">${icon('audio-lines', 'icon-sm')}All services</span>
            <span class="badge badge-outline" style="height:24px">${icon('file-spreadsheet', 'icon-sm')}Attach Excel</span>
            <span class="topbar-spacer"></span>
            ${UI.btn({ icon: 'mic', variant: 'ghost', size: 'sm', title: 'Voice input', action: 'toast', arg: 'Listening…' })}
            ${C.pending ? UI.btn({ icon: 'square', variant: 'secondary', size: 'sm', title: 'Stop generating', action: 'chat-stop' }) : UI.btn({ icon: 'arrow-up', variant: 'primary', size: 'sm', title: 'Send', type: 'submit' })}
          </div>
        </form><p class="composer-hint">Enter to send · Shift + Enter for a new line · answers can be wrong; check the query behind each one</p></div>
      </section>
    </div>`;
  }

  window.Screens = { login, sidebar, topbar, dashboard, campaign, registry, upload, reports, assistant, replaceModal, scheduleDrawer, insightModal, PRESETS, SINGLE_PRESETS };
})();
