/* ─────────────────────────────────────────────────────────────────────────
   Prototype runtime: state, hash router, render loop and every interaction.
   Nothing here talks to a server — flows (upload, chat, filters) are
   simulated with timers so each state can be reviewed.
   ───────────────────────────────────────────────────────────────────────── */
(function () {
  const D = DATA;
  const store = {
    get(k, d) {
      try {
        const v = localStorage.getItem(`dsnl-proto:${k}`);
        return v === null ? d : JSON.parse(v);
      } catch {
        return d;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem(`dsnl-proto:${k}`, JSON.stringify(v));
      } catch {
        /* storage blocked — the prototype still works, it just forgets */
      }
    },
  };

  const emptyFilters = () => ({ account_id: '', crn: '', time_from: '', time_to: '', conf_num: '', cpin: '', direction: '', provider: '' });

  const S = (window.S = {
    theme: store.get('theme', window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'),
    collapsed: store.get('collapsed', false),
    view: 'ready', // prototype state: ready | loading | empty | error | noresults | uploadfailed
    proto: false,
    signedIn: store.get('signedIn', false),
    dataset: true,
    datasetInfo: { ...D.DATASET },
    uploads: [...D.UPLOADS],
    range: { from: D.YESTERDAY, to: D.YESTERDAY, preset: 'Yesterday' },
    rangePick: 'start',
    campaignDate: { from: D.YESTERDAY, preset: 'Yesterday' },
    pop: null,
    modal: null,
    navOpen: store.get('navOpen', { voicedrop: true, conference: false, multicall: false }),
    dash: {
      tab: { all: 'overview', voicedrop: 'overview', conference: 'overview', multicall: 'overview' },
      filters: { all: emptyFilters(), voicedrop: emptyFilters(), conference: emptyFilters(), multicall: emptyFilters() },
    },
    campaign: { view: 'account', search: '', expanded: ['118230'], sort: { key: 'total_size', dir: 'desc' } },
    upload: { phase: 'idle', progress: 0, ack: false },
    reports: { tab: 'scheduled', drawer: null, histFilter: 'all', recipients: [], freq: null, format: null, service: null },
    schedules: D.SCHEDULES.map((s) => ({ ...s })),
    chat: { active: 'c-1042', messages: D.THREAD.map((m) => ({ ...m })), pending: false, search: '' },
    login: { user: '', error: false, loading: false, showPw: false },
    transient: false,
    route: {},
    toasts: [],
  });

  // ── Routing ─────────────────────────────────────────────────────────
  function parseRoute() {
    const [path] = (location.hash || '#/').slice(1).split('?');
    const p = path.split('/').filter(Boolean);
    if (p[0] === 'login') return { page: 'login' };
    if (p[0] === 'analytics' && D.SERVICES[p[1]]) {
      if (p[2] === 'campaign' && p[1] !== 'all') return { page: 'campaign', service: p[1] };
      if (p[2] === 'registry' && p[1] === 'multicall') return { page: 'registry', service: 'multicall' };
      return { page: 'dashboard', service: p[1] };
    }
    if (p[0] === 'upload') return { page: 'upload' };
    if (p[0] === 'reports') return { page: 'reports' };
    if (p[0] === 'assistant') return { page: 'assistant', convo: p[1] };
    return null;
  }

  function onRoute() {
    const r = parseRoute();
    if (!r) return location.replace(S.signedIn ? '#/analytics/all' : '#/login');
    if (r.page !== 'login' && !S.signedIn) return location.replace('#/login');
    const changed = r.page !== S.route.page || r.service !== S.route.service;
    S.route = r;
    S.pop = null;
    if (r.page === 'assistant' && r.convo) S.chat.active = r.convo;
    if (r.service && r.service !== 'all') S.navOpen[r.service] = true;
    // A short skeleton on navigation, the way the real pages load.
    if (changed && r.page !== 'login') {
      S.transient = true;
      clearTimeout(onRoute.t);
      onRoute.t = setTimeout(() => {
        S.transient = false;
        render();
      }, 550);
    }
    render(true);
  }

  // ── Render ──────────────────────────────────────────────────────────
  const root = document.getElementById('app');
  function render(resetScroll) {
    document.documentElement.dataset.theme = S.theme;
    const focus = document.activeElement && document.activeElement.id ? { id: document.activeElement.id, s: document.activeElement.selectionStart, e: document.activeElement.selectionEnd } : null;
    const scroller = root.querySelector('.content');
    const scrollTop = scroller ? scroller.scrollTop : 0;
    Charts.resetTips();

    const r = S.route;
    let html;
    if (r.page === 'login') {
      html = Screens.login();
    } else {
      const page = { dashboard: Screens.dashboard, campaign: Screens.campaign, registry: Screens.registry, upload: Screens.upload, reports: Screens.reports, assistant: Screens.assistant }[r.page](r);
      html = `<div class="app${S.collapsed ? ' is-collapsed' : ''}">${Screens.sidebar(r)}<div class="main">${Screens.topbar(r)}<main class="content" id="main" ${r.page === 'assistant' ? 'style="overflow:hidden"' : ''}>${page}</main></div></div>`;
      if (S.modal === 'replace') html += Screens.replaceModal();
      if (S.modal && S.modal.startsWith('insight:')) html += Screens.insightModal(S.modal.slice(8));
      if (S.reports.drawer) html += Screens.scheduleDrawer();
    }
    html += protoUI();
    html += S.toasts.length ? `<div class="toast-stack" role="status">${S.toasts.map((t) => `<div class="toast">${icon('check-circle')}${UI.esc(t.text)}</div>`).join('')}</div>` : '';
    root.innerHTML = html;

    const sc = root.querySelector('.content');
    if (sc && !resetScroll) sc.scrollTop = scrollTop;
    if (focus) {
      const el = document.getElementById(focus.id);
      if (el) {
        el.focus();
        try {
          el.setSelectionRange(focus.s, focus.e);
        } catch {
          /* not a text field */
        }
      }
    }
    const chat = document.getElementById('chat-scroll');
    if (chat) chat.scrollTop = chat.scrollHeight;
  }

  // ── Prototype control panel (not part of the product) ───────────────
  const STATES = [
    ['ready', 'Default'], ['loading', 'Loading'], ['empty', 'Empty'], ['error', 'Error'], ['noresults', 'No results'], ['uploadfailed', 'Upload failed'],
  ];
  const LINKS = [
    ['#/login', 'Sign in'], ['#/analytics/all', 'All Services'], ['#/analytics/voicedrop', 'Voicedrop'], ['#/analytics/conference', 'Conference'],
    ['#/analytics/multicall', 'MultiCall'], ['#/analytics/voicedrop?tab=custom', 'Custom tab'], ['#/analytics/voicedrop/campaign', 'Campaign metrics'],
    ['#/analytics/multicall/registry', 'Registration'], ['#/upload', 'Upload data'], ['#/reports', 'Reports'], ['#/assistant/c-1042', 'AI assistant'], ['styleguide.html', 'Style guide ↗'],
  ];
  function protoUI() {
    const fab = `<button class="proto-fab" data-action="proto" aria-expanded="${S.proto}"><span class="dot"></span>Prototype · ${STATES.find((s) => s[0] === S.view)[1]}</button>`;
    if (!S.proto) return fab;
    return `${fab}<div class="proto-panel" role="dialog" aria-label="Prototype controls">
      <h4>Screen state</h4><div class="proto-opts">${STATES.map(([id, l]) => `<button class="${S.view === id ? 'is-active' : ''}" data-action="proto-state" data-arg="${id}">${l}</button>`).join('')}</div>
      <h4>Theme</h4><div class="proto-opts">${['light', 'dark'].map((t) => `<button class="${S.theme === t ? 'is-active' : ''}" data-action="set-theme" data-arg="${t}">${t === 'light' ? 'Light' : 'Dark'}</button>`).join('')}</div>
      <h4>Sidebar</h4><div class="proto-opts"><button class="${!S.collapsed ? 'is-active' : ''}" data-action="collapse" data-arg="open">Expanded</button><button class="${S.collapsed ? 'is-active' : ''}" data-action="collapse" data-arg="closed">Collapsed</button></div>
      <h4>Jump to</h4><div class="proto-links">${LINKS.map(([h, l]) => `<a href="${h}" ${h.endsWith('.html') ? 'target="_blank"' : ''}>${l}</a>`).join('')}</div>
      <p class="proto-note">States apply to whichever screen is open. "Empty" means no dataset has been uploaded. Resize the window to 1440 or 1920 wide to see both layouts.</p>
    </div>`;
  }

  // ── Toasts ──────────────────────────────────────────────────────────
  function toast(text) {
    const t = { text, id: Math.random() };
    S.toasts = [...S.toasts.slice(-2), t];
    render();
    setTimeout(() => {
      S.toasts = S.toasts.filter((x) => x !== t);
      render();
    }, 2800);
  }

  // ── Upload simulation ───────────────────────────────────────────────
  let timer;
  function startUpload() {
    S.modal = null;
    S.upload = { phase: 'uploading', progress: 0, ack: false };
    const willFail = S.view === 'uploadfailed';
    clearInterval(timer);
    timer = setInterval(() => {
      const U = S.upload;
      if (U.phase === 'uploading') {
        U.progress = Math.min(100, U.progress + 6 + Math.random() * 6);
        if (U.progress >= 100) U.phase = 'validating';
      } else if (U.phase === 'validating') {
        U.ticks = (U.ticks || 0) + 1;
        if (U.ticks > 4) {
          if (willFail) {
            U.phase = 'failed';
            clearInterval(timer);
            S.uploads = [{ file: D.NEW_FILE.file, size: D.NEW_FILE.size, by: 'Mukesh K.', at: '2026-10-24 10:52', status: 'Failed', reason: 'Missing column CONFEREE_TYPE' }, ...S.uploads];
          } else {
            U.phase = 'indexing';
            U.ticks = 0;
          }
        }
      } else if (U.phase === 'indexing') {
        U.ticks = (U.ticks || 0) + 1;
        if (U.ticks > 6) {
          U.phase = 'done';
          clearInterval(timer);
          S.dataset = true;
          S.datasetInfo = { ...S.datasetInfo, file: D.NEW_FILE.file, size: D.NEW_FILE.size, rows: D.NEW_FILE.rows, cdrRows: 10228410, codrRows: 2750144, to: D.NEW_FILE.to, uploadedAt: '2026-10-24 10:58', processing: '5 min 47 s' };
          S.uploads = [{ file: D.NEW_FILE.file, size: D.NEW_FILE.size, by: 'Mukesh K.', at: '2026-10-24 10:52', status: 'Active' }, ...S.uploads.map((u) => (u.status === 'Active' ? { ...u, status: 'Replaced' } : u))];
          if (S.view === 'empty') S.view = 'ready';
        }
      }
      if (['upload', 'dashboard', 'campaign', 'reports', 'registry', 'assistant'].includes(S.route.page)) render();
    }, 350);
    render();
  }

  // ── Chat simulation ─────────────────────────────────────────────────
  function answerFor(q) {
    const t = q.toLowerCase();
    if (t.includes('minute'))
      return { html: '<p>MultiCall used <strong>286,330 minutes</strong> yesterday (Oct 23, 2026), averaging <strong>10.97 min</strong> per connected call. Mumbai and Delhi carried 45% of those minutes.</p>', table: { cols: ['Location', 'Minutes', 'Dial In', 'Dial Out'], rows: [['Mumbai', '67,345', '11,204', '56,141'], ['Delhi', '60,988', '9,870', '51,118'], ['Chennai', '47,502', '7,113', '40,389'], ['Bengaluru', '45,727', '6,502', '39,225']] }, query: 'cdr ⨝ codr · multicall · 2026-10-23 · sum(duration) by LOCATION' };
    if (t.includes('disconnect') || t.includes('reason'))
      return { html: '<p>Across all services yesterday, <strong>No answer</strong> was the top disconnect reason (40.5% of 89,164 failed attempts), then <strong>User busy</strong> at 24.1%.</p>', table: { cols: ['Reason', 'Calls', 'Share'], rows: [['No answer', '36,093', '40.5%'], ['User busy', '21,481', '24.1%'], ['Call rejected', '13,856', '15.5%'], ['Subscriber absent', '8,578', '9.6%'], ['Unallocated number', '5,073', '5.7%']] }, query: 'cdr · all services · 2026-10-23 · group by DISCONNECT_REASON · top 5' };
    if (t.includes('dial-in') || t.includes('dial in') || t.includes('conference'))
      return { html: '<p>For Conference yesterday, dial-in legs connected at <strong>93.1%</strong> and dial-out legs at <strong>85.9%</strong>. Dial-in made up 61.5% of the 64,882 attempts.</p>', table: { cols: ['Direction', 'Attempts', 'Connected', 'Rate'], rows: [['Dial In', '39,880', '37,128', '93.1%'], ['Dial Out', '25,002', '21,477', '85.9%']] }, query: 'cdr ⨝ codr · conference · 2026-10-23 · group by CALL_DIRECTION' };
    return { html: '<p>Yesterday (Oct 23, 2026) <strong>171,240</strong> Voicedrop calls connected out of 248,316 attempts — a <strong>69.0%</strong> connection rate, up 1.4 points on the previous weekday.</p>', query: 'cdr · voicedrop · 2026-10-23 · count where CONNECTED = 1' };
  }
  function ask(q) {
    if (!q.trim() || S.chat.pending) return;
    if (!S.chat.active) S.chat.active = 'c-new';
    const steps = [{ label: 'Reading the question', done: false }];
    const ai = { role: 'ai', steps, time: '10:31' };
    S.chat.messages = [...(S.chat.active === 'c-new' && S.chat.messages === D.THREAD ? [] : S.chat.messages), { role: 'user', text: q, time: '10:31' }, ai];
    S.chat.pending = true;
    render();
    const plan = ['Choosing the tables — CDR, joined to CODR where rooms matter', 'Running the query on the active dataset', 'Writing the answer'];
    let i = 0;
    const step = () => {
      steps[steps.length - 1].done = true;
      if (i < plan.length) {
        steps.push({ label: plan[i++], done: false });
        render();
        S.chat.t = setTimeout(step, 750);
        return;
      }
      if (S.view === 'error') {
        Object.assign(ai, { steps: undefined, error: true });
      } else {
        Object.assign(ai, answerFor(q), { steps: undefined, took: '3.1 s' });
      }
      S.chat.pending = false;
      render();
    };
    S.chat.t = setTimeout(step, 600);
  }

  // ── Date picking ────────────────────────────────────────────────────
  function pickDay(iso) {
    if (S.route.page === 'campaign') {
      S.campaignDate = { from: iso, preset: 'Pick a day' };
      S.pop = null;
      return;
    }
    if (S.rangePick === 'start' || iso < S.range.from) {
      S.range = { from: iso, to: iso, preset: 'Custom range' };
      S.rangePick = 'end';
    } else {
      const span = D.daysBetween(S.range.from, iso).length;
      if (span > 31) return toast('Ranges can span at most 31 days');
      S.range = { ...S.range, to: iso };
      S.rangePick = 'start';
    }
  }

  // ── Event delegation ────────────────────────────────────────────────
  const actions = {
    proto: () => (S.proto = !S.proto),
    'proto-state': (a) => {
      S.view = a;
      S.dataset = a !== 'empty';
      if (a !== 'uploadfailed' && S.upload.phase === 'failed') S.upload.phase = 'idle';
      if (a === 'ready') S.upload = { phase: 'idle', progress: 0, ack: false };
    },
    theme: () => {
      S.theme = S.theme === 'dark' ? 'light' : 'dark';
      store.set('theme', S.theme);
    },
    'set-theme': (a) => {
      S.theme = a;
      store.set('theme', a);
    },
    collapse: (a) => {
      S.collapsed = a ? a === 'closed' : !S.collapsed;
      store.set('collapsed', S.collapsed);
    },
    'nav-toggle': (svc) => {
      S.navOpen[svc] = !S.navOpen[svc];
      store.set('navOpen', S.navOpen);
      if (S.collapsed) location.hash = `#/analytics/${svc}`;
    },
    'toggle-pop': (id) => (S.pop = S.pop === id ? null : id),
    'close-pop': () => (S.pop = null),
    preset: (label) => {
      const list = S.route.page === 'campaign' ? Screens.SINGLE_PRESETS : Screens.PRESETS;
      const p = list.find((x) => x.label === label);
      if (!p.from) {
        if (S.route.page === 'campaign') S.campaignDate.preset = label;
        else S.range = { ...S.range, preset: label };
        S.rangePick = 'start';
        return;
      }
      if (S.route.page === 'campaign') S.campaignDate = { from: p.from, preset: label };
      else S.range = { from: p.from, to: p.to, preset: label };
      S.pop = null;
      flashLoading();
    },
    'pick-day': (iso) => pickDay(iso),
    'dash-tab': (id) => {
      S.dash.tab[S.route.service] = id;
      S.pop = null;
    },
    'clear-filters': () => {
      S.dash.filters[S.route.service] = emptyFilters();
      if (S.view === 'noresults') S.view = 'ready';
      S.pop = null;
    },
    'remove-filter': (k) => {
      S.dash.filters[S.route.service][k] = '';
      flashLoading();
    },
    'campaign-view': (v) => {
      S.campaign.view = v;
      S.campaign.sort = v === 'campaigns' ? { key: 'start_time', dir: 'asc' } : { key: 'total_size', dir: 'desc' };
    },
    sort: (key) => {
      const s = S.campaign.sort;
      S.campaign.sort = { key, dir: s.key === key && s.dir === 'desc' ? 'asc' : 'desc' };
    },
    expand: (acc) => {
      const e = S.campaign.expanded;
      S.campaign.expanded = e.includes(acc) ? e.filter((x) => x !== acc) : [...e, acc];
    },
    'clear-search': () => {
      S.campaign.search = '';
      if (S.view === 'noresults') S.view = 'ready';
    },
    insight: (acc) => (S.modal = `insight:${acc}`),
    'close-modal': () => {
      S.modal = null;
      S.reports.drawer = null;
    },
    'close-modal-bg': (_, e) => {
      if (e.target.classList.contains('overlay')) actions['close-modal']();
      else return false;
    },
    retry: () => flashLoading(() => (S.view = 'ready')),
    toast: (msg) => {
      toast(msg);
      return false;
    },
    browse: (_, e) => {
      e.preventDefault();
      fileChosen();
      return false;
    },
    'upload-start': () => startUpload(),
    'upload-reset': () => {
      S.upload = { phase: 'idle', progress: 0, ack: false, retry: true };
    },
    'upload-cancel': () => {
      clearInterval(timer);
      S.upload = { phase: 'idle', progress: 0, ack: false };
      toast('Upload cancelled — the active dataset was not changed');
      return false;
    },
    ack: (_, e) => {
      S.upload.ack = e.target.checked;
      const b = document.getElementById('replace-confirm');
      if (b) b.disabled = !S.upload.ack;
      return false;
    },
    'reports-tab': (t) => (S.reports.tab = t),
    'hist-filter': (f) => {
      S.reports.histFilter = f;
      if (S.view === 'noresults') S.view = 'ready';
    },
    'toggle-schedule': (id) => {
      const s = S.schedules.find((x) => x.id === id);
      s.active = !s.active;
      toast(`${s.name} ${s.active ? 'resumed' : 'paused'}`);
      return false;
    },
    'new-schedule': () => {
      if (S.route.page !== 'reports') location.hash = '#/reports';
      Object.assign(S.reports, { drawer: 'new', recipients: ['mukesh.mk@dsnl.in'], freq: null, format: null, service: null });
    },
    'edit-schedule': (id) => {
      const s = S.schedules.find((x) => x.id === id);
      Object.assign(S.reports, { drawer: id, recipients: [...s.recipients], freq: null, format: null, service: null });
    },
    'sched-freq': (f) => (S.reports.freq = f),
    'sched-format': (f) => (S.reports.format = f),
    'sched-service': (f) => (S.reports.service = f),
    'remove-recipient': (i) => S.reports.recipients.splice(Number(i), 1),
    'open-convo': (id) => {
      location.hash = `#/assistant/${id}`;
      S.chat.messages = id === 'c-1042' ? D.THREAD.map((m) => ({ ...m })) : [{ role: 'user', text: D.CONVERSATIONS.find((c) => c.id === id).title + '?', time: 'Earlier' }, { role: 'ai', time: 'Earlier', took: '4.2 s', ...answerFor(D.CONVERSATIONS.find((c) => c.id === id).title) }];
      return false;
    },
    'new-chat': () => {
      clearTimeout(S.chat.t);
      S.chat = { ...S.chat, active: null, messages: [], pending: false };
      if (location.hash !== '#/assistant') location.hash = '#/assistant';
    },
    suggest: (q) => ask(q),
    'chat-stop': () => {
      clearTimeout(S.chat.t);
      const last = S.chat.messages[S.chat.messages.length - 1];
      Object.assign(last, { steps: undefined, html: '<p class="muted">Stopped. Ask again or rephrase the question.</p>' });
      S.chat.pending = false;
    },
    'chat-retry': () => {
      S.view = 'ready';
      const lastUser = [...S.chat.messages].reverse().find((m) => m.role === 'user');
      S.chat.messages = S.chat.messages.slice(0, -2);
      ask(lastUser ? lastUser.text : D.SUGGESTIONS[0]);
      return false;
    },
    'chat-clear-search': () => {
      S.chat.search = '';
      if (S.view === 'noresults') S.view = 'ready';
    },
    'toggle-pw': () => (S.login.showPw = !S.login.showPw),
    'sign-out': () => {
      S.signedIn = false;
      store.set('signedIn', false);
      S.pop = null;
    },
  };

  function fileChosen() {
    if (S.dataset && S.view !== 'empty') {
      S.modal = 'replace';
      S.upload.ack = false;
      render();
    } else startUpload();
  }

  function flashLoading(after) {
    S.transient = true;
    render();
    setTimeout(() => {
      S.transient = false;
      if (after) after();
      render();
    }, 500);
  }

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) {
      if (S.pop && !e.target.closest('.popover')) {
        S.pop = null;
        render();
      }
      if (S.proto && !e.target.closest('.proto-panel')) {
        S.proto = false;
        render();
      }
      return;
    }
    const fn = actions[el.dataset.action];
    if (!fn) return;
    if (el.tagName === 'A' && el.dataset.action !== 'sign-out') e.preventDefault();
    if (el.type === 'checkbox' && el.dataset.action !== 'ack') return;
    const res = fn(el.dataset.arg, e);
    if (res !== false) render();
  });

  document.addEventListener('submit', (e) => {
    const form = e.target.closest('[data-form]');
    if (!form) return;
    e.preventDefault();
    const kind = form.dataset.form;
    if (kind === 'login') {
      const user = form.username.value.trim();
      const pass = form.password.value;
      S.login.user = user;
      if (!user || !pass) {
        S.login.error = true;
        return render();
      }
      S.login = { ...S.login, loading: true, error: false };
      render();
      setTimeout(() => {
        S.login.loading = false;
        if (pass === 'wrong') {
          S.login.error = true;
          return render();
        }
        S.signedIn = true;
        store.set('signedIn', true);
        location.hash = '#/analytics/all';
      }, 900);
    } else if (kind === 'filters') {
      const svc = S.route.service;
      const next = { ...S.dash.filters[svc] };
      for (const el of form.querySelectorAll('input[name], select[name]')) next[el.name] = el.value.trim();
      S.dash.filters[svc] = next;
      S.pop = null;
      if (S.view === 'noresults') S.view = 'ready';
      flashLoading();
    } else if (kind === 'chat') {
      const q = form.q.value;
      form.q.value = '';
      ask(q);
    } else if (kind === 'schedule') {
      const name = form.querySelector('#s-name').value.trim() || 'Untitled report';
      const id = S.reports.drawer;
      if (id === 'new') {
        S.schedules = [{ id: `r${Date.now()}`, name, service: S.reports.service || 'voicedrop', freq: S.reports.freq || 'Daily', time: form.querySelector('#s-time').value, day: '', format: S.reports.format || 'XLSX', recipients: S.reports.recipients.length ? S.reports.recipients : ['mukesh.mk@dsnl.in'], range: form.querySelector('#s-range').value, next: 'Oct 25, 08:00', last: 'Queued', active: true, metrics: ['kpi', 'connection'] }, ...S.schedules];
        toast(`“${name}” scheduled`);
      } else {
        Object.assign(S.schedules.find((s) => s.id === id), { name, recipients: S.reports.recipients, freq: S.reports.freq || S.schedules.find((s) => s.id === id).freq });
        toast('Schedule saved');
      }
      S.reports.drawer = null;
      S.reports.tab = 'scheduled';
      render();
    } else if (kind === 'registry') {
      flashLoading();
    }
  });

  document.addEventListener('input', (e) => {
    const k = e.target.dataset.input;
    if (k === 'campaign-search') {
      S.campaign.search = e.target.value;
      if (S.view === 'noresults') S.view = 'ready';
      render();
    } else if (k === 'chat-search') {
      S.chat.search = e.target.value;
      render();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (S.modal || S.reports.drawer || S.pop || S.proto) {
        S.modal = null;
        S.reports.drawer = null;
        S.pop = null;
        S.proto = false;
        render();
      }
    }
    if (e.target.id === 'chat-input' && e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      e.target.form.requestSubmit();
    }
    if (e.target.dataset && e.target.dataset.input === 'recipient' && (e.key === 'Enter' || e.key === ',')) {
      e.preventDefault();
      const v = e.target.value.trim().replace(/,$/, '');
      if (v) {
        S.reports.recipients.push(v);
        render();
        document.getElementById('s-rec')?.focus();
      }
    }
  });

  // Drag & drop onto the upload box
  document.addEventListener('dragover', (e) => {
    const box = e.target.closest && e.target.closest('[data-drop]');
    if (box) {
      e.preventDefault();
      box.classList.add('is-dragover');
    }
  });
  document.addEventListener('dragleave', (e) => {
    const box = e.target.closest && e.target.closest('[data-drop]');
    if (box) box.classList.remove('is-dragover');
  });
  document.addEventListener('drop', (e) => {
    const box = e.target.closest && e.target.closest('[data-drop]');
    if (box) {
      e.preventDefault();
      fileChosen();
    }
  });
  document.addEventListener('change', (e) => {
    if (e.target.matches('input[type=file]')) fileChosen();
  });

  // Deep link: #/analytics/voicedrop?tab=custom opens the Custom tab.
  window.addEventListener('hashchange', () => {
    const q = new URLSearchParams(location.hash.split('?')[1] || '');
    const r = parseRoute();
    if (r && r.page === 'dashboard' && q.get('tab')) S.dash.tab[r.service] = q.get('tab');
    onRoute();
  });
  const q0 = new URLSearchParams(location.hash.split('?')[1] || '');
  const r0 = parseRoute();
  if (r0 && r0.page === 'dashboard' && q0.get('tab')) S.dash.tab[r0.service] = q0.get('tab');
  onRoute();
})();
