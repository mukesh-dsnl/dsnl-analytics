/* ─────────────────────────────────────────────────────────────────────────
   Sample data. Shapes mirror the real API (frontend/src/features/{cdr-dashboard,campaign-metrics,ai-chat}/api.ts)
   so the design can be wired to it field-for-field:
     CdrDashboard  → summary, dtmf, call_direction, connection_status,
                     peak_ports, service_provider, reblast, disconnect_reason,
                     location, call_funnel, call_duration
   Figures are invented but internally consistent: every breakdown sums to
   its headline, connect rates line up across panels.
   ───────────────────────────────────────────────────────────────────────── */
(function () {
  const TODAY = '2026-10-24';
  const YESTERDAY = '2026-10-23';

  const SERVICES = {
    all: { id: 'all', name: 'All Services', short: 'All', icon: 'layout-grid', fields: [] },
    voicedrop: { id: 'voicedrop', name: 'Voicedrop', short: 'Voicedrop', icon: 'audio-lines', fields: ['account_id', 'crn', 'time'] },
    conference: { id: 'conference', name: 'Conference', short: 'Conference', icon: 'users', fields: ['account_id', 'crn', 'time', 'conf_num', 'cpin'] },
    multicall: { id: 'multicall', name: 'MultiCall', short: 'MultiCall', icon: 'phone-forwarded', fields: ['account_id', 'crn', 'time', 'conf_num', 'cpin'] },
  };

  /* One day of each service — the base every range and filter scales from. */
  const BASE = {
    voicedrop: {
      total_calls: 248316, total_participants: 182904, total_phone_numbers: 176412, minutes_usage: 391527, total_conferences: 0,
      connected: 171240, dial_out: 236410, dial_in: 11906, dtmf: 38512,
      reblast: [['Blast 1', 41872], ['Blast 2', 16954], ['Blast 3', 5382]],
      peak: 1842, peakShape: 'campaign',
      funnel: [236410, 198733, 171240, 171102],
      duration: [48212, 61905, 47330, 13793],
    },
    conference: {
      total_calls: 64882, total_participants: 41236, total_phone_numbers: 38904, minutes_usage: 1284610, total_conferences: 3918,
      connected: 58140, dial_out: 25002, dial_in: 39880, dtmf: 12407,
      reblast: [['Blast 1', 2210], ['Blast 2', 704]],
      peak: 1210, peakShape: 'office',
    },
    multicall: {
      total_calls: 31450, total_participants: 22918, total_phone_numbers: 21877, minutes_usage: 286330, total_conferences: 2146,
      connected: 26104, dial_out: 25238, dial_in: 6212, dtmf: 4880,
      reblast: [['Blast 1', 2981], ['Blast 2', 987]],
      peak: 640, peakShape: 'office',
    },
  };

  const PROVIDERS = [
    ['Airtel', 0.3711, 0.712], ['Jio', 0.3293, 0.704], ['Vodafone Idea', 0.1986, 0.661], ['BSNL', 0.0761, 0.618], ['Tata Tele', 0.0249, 0.649],
  ];
  const REASONS = [
    ['No answer', 0.4048], ['User busy', 0.2409], ['Call rejected', 0.1554], ['Subscriber absent', 0.0962],
    ['Unallocated number', 0.0569], ['Network out of order', 0.0278], ['Other', 0.018],
  ];
  const LOCATIONS = [
    ['Mumbai', 0.2352], ['Delhi', 0.213], ['Chennai', 0.1659], ['Bengaluru', 0.1597], ['Kolkata', 0.1213], ['Hyderabad', 0.1049],
  ];
  const DURATION_LABELS = ['0–30 s', '31–60 s', '1–3 min', '3 min +'];
  const FUNNEL_LABELS = ['Initiated', 'Rang', 'Connected', 'Ended'];

  /** Split `total` by `shares`, putting the rounding remainder on the largest. */
  function split(total, shares) {
    const raw = shares.map((s) => Math.round(total * s));
    const diff = total - raw.reduce((a, b) => a + b, 0);
    raw[0] += diff;
    return raw;
  }

  const SHAPES = {
    // Voicedrop campaigns fire in two waves: late morning and after lunch.
    campaign: [0.03, 0.02, 0.02, 0.02, 0.03, 0.05, 0.12, 0.34, 0.62, 0.86, 0.97, 1.0, 0.78, 0.61, 0.74, 0.92, 0.95, 0.81, 0.58, 0.42, 0.27, 0.15, 0.08, 0.05],
    // Conference rooms follow office hours with a lunch dip.
    office: [0.02, 0.01, 0.01, 0.01, 0.02, 0.04, 0.09, 0.22, 0.48, 0.81, 0.98, 1.0, 0.86, 0.63, 0.79, 0.94, 0.88, 0.71, 0.44, 0.24, 0.12, 0.07, 0.04, 0.03],
  };

  /* Day-to-day variation: weekdays near 1, weekends quieter. Normalised so
     yesterday is exactly the BASE figures quoted elsewhere (chat answers,
     sign-in page). */
  const wobble = (date) => 1 + 0.06 * Math.sin(date * 1.7);
  function dayFactor(iso) {
    const d = new Date(iso + 'T00:00:00');
    const dow = d.getDay();
    return ((dow === 0 ? 0.46 : dow === 6 ? 0.68 : 1) * wobble(d.getDate())) / wobble(23);
  }

  function daysBetween(from, to) {
    const out = [];
    const d = new Date(from + 'T00:00:00');
    const end = new Date(to + 'T00:00:00');
    // Local parts, not toISOString(): that converts to UTC and lands on the
    // previous day anywhere east of Greenwich (IST included).
    const iso = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
    while (d <= end) {
      out.push(iso(d));
      d.setDate(d.getDate() + 1);
    }
    return out;
  }

  function buildService(id, from, to, scale = 1) {
    const b = BASE[id];
    const days = daysBetween(from, to);
    const f = days.reduce((t, d) => t + dayFactor(d), 0) * scale;
    const n = (v) => Math.round(v * f);
    const calls = n(b.total_calls);
    const connected = Math.min(calls, n(b.connected));
    const notConnected = calls - connected;
    const dialOut = Math.round(calls * (b.dial_out / b.total_calls));
    const provCounts = split(calls, PROVIDERS.map((p) => p[1]));
    const shape = SHAPES[b.peakShape];
    const peak_ports =
      days.length === 1
        ? shape.map((s, h) => ({ bucket: `${String(h).padStart(2, '0')}:00`, peak: Math.round(b.peak * s * Math.max(scale, 0.02) * dayFactor(days[0])) }))
        : days.map((d) => ({ bucket: d, peak: Math.round(b.peak * dayFactor(d) * Math.max(scale, 0.02)) }));
    const reblastStages = b.reblast.map(([label, v]) => ({ label, value: n(v) }));
    return {
      summary: {
        total_calls: calls,
        total_participants: n(b.total_participants),
        total_phone_numbers: n(b.total_phone_numbers),
        minutes_usage: n(b.minutes_usage),
        total_conferences: n(b.total_conferences),
      },
      dtmf: n(b.dtmf),
      call_direction: [{ label: 'Dial Out', value: dialOut }, { label: 'Dial In', value: calls - dialOut }],
      connection_status: [{ label: 'Connected', value: connected }, { label: 'Not Connected', value: notConnected }],
      peak_ports,
      service_provider: PROVIDERS.map((p, i) => ({ label: p[0], value: provCounts[i], connected: Math.round(provCounts[i] * p[2]) })),
      reblast: { total: reblastStages.reduce((t, s) => t + s.value, 0), stages: reblastStages },
      disconnect_reason: split(notConnected, REASONS.map((r) => r[1])).map((v, i) => ({ label: REASONS[i][0], value: v })),
      location: split(calls, LOCATIONS.map((l) => l[1])).map((v, i) => ({ label: LOCATIONS[i][0], value: v })),
      call_funnel: b.funnel ? b.funnel.map((v, i) => ({ label: FUNNEL_LABELS[i], value: n(v) })) : [],
      call_duration: b.duration ? split(connected, b.duration.map((v) => v / 171240)).map((v, i) => ({ label: DURATION_LABELS[i], value: v })) : [],
      coverage: { days_requested: days.length, days_matched: days.length, first_day: from, last_day: to, bucket: days.length === 1 ? 'hour' : 'day' },
    };
  }

  /* "All" is the three services added together, panel by panel. */
  function merge(parts) {
    const [a, ...rest] = parts;
    const out = JSON.parse(JSON.stringify(a));
    for (const p of rest) {
      for (const k of Object.keys(out.summary)) out.summary[k] += p.summary[k];
      out.dtmf += p.dtmf;
      for (const key of ['call_direction', 'connection_status', 'disconnect_reason', 'location']) {
        out[key].forEach((r, i) => (r.value += p[key][i].value));
      }
      out.service_provider.forEach((r, i) => {
        r.value += p.service_provider[i].value;
        r.connected += p.service_provider[i].connected;
      });
      out.peak_ports.forEach((r, i) => (r.peak += p.peak_ports[i].peak));
      out.reblast.total += p.reblast.total;
      p.reblast.stages.forEach((s, i) => {
        if (out.reblast.stages[i]) out.reblast.stages[i].value += s.value;
      });
    }
    out.call_funnel = [];
    out.call_duration = [];
    return out;
  }

  const ACCOUNTS = ['104582', '118230', '120417', '131906', '140022', '152871', '163340', '170295', '181764', '196018', '203551', '214809'];

  /**
   * The dashboard for one service, range and filter set. Filters narrow by a
   * plausible share; an account id the lake doesn't hold returns null (the
   * "no results" state).
   */
  function dashboard(service, from, to, filters = {}) {
    let scale = 1;
    if (filters.account_id) {
      if (!ACCOUNTS.includes(filters.account_id.trim())) return null;
      scale *= 0.031 + (ACCOUNTS.indexOf(filters.account_id.trim()) % 4) * 0.009;
    }
    if (filters.crn) scale *= 0.18;
    if (filters.conf_num) scale *= 0.12;
    if (filters.cpin) scale *= 0.4;
    if (filters.time_from || filters.time_to) {
      const h = (t, d) => (t ? Number(t.slice(0, 2)) + Number(t.slice(3, 5)) / 60 : d);
      const span = Math.max(0, h(filters.time_to, 24) - h(filters.time_from, 0));
      scale *= Math.min(1, span / 13);
      if (span === 0) return null;
    }
    if (service === 'all') return merge(['voicedrop', 'conference', 'multicall'].map((s) => buildService(s, from, to, scale)));
    return buildService(service, from, to, scale);
  }

  /* ── Campaign metrics (single day) ─────────────────────────────────── */
  const ACCOUNT_NAMES = {
    '104582': 'Kotak Retail Collections', '118230': 'Bharat Insurance Co.', '120417': 'Metro Civic Services', '131906': 'Apex Lending',
    '140022': 'Sunrise Schools Group', '152871': 'GreenGrid Power', '163340': 'CityCare Hospitals', '170295': 'NorthStar Telecom Resale',
    '181764': 'Udaan Logistics', '196018': 'Prime Housing Society Network', '203551': 'Vidya Exam Board', '214809': 'Shakti Microfinance',
  };
  function campaignAccounts(service) {
    const f = service === 'voicedrop' ? 1 : service === 'conference' ? 0.26 : 0.13;
    const sizes = [38412, 31870, 27604, 22118, 19560, 16244, 13980, 11206, 9874, 7012, 5480, 3196];
    const rates = [0.742, 0.713, 0.688, 0.701, 0.659, 0.684, 0.721, 0.612, 0.676, 0.693, 0.587, 0.648];
    return ACCOUNTS.map((acc, i) => {
      const total = Math.round(sizes[i] * f);
      const connected = Math.round(total * rates[i]);
      return {
        account: acc,
        name: ACCOUNT_NAMES[acc],
        total_size: total,
        connected_size: connected,
        not_connected_size: total - connected,
        connected_percentage: (connected / total) * 100,
        total_minutes: Math.round(connected * (service === 'voicedrop' ? 2.29 : service === 'conference' ? 22.1 : 10.9)),
        crns: [0.46, 0.31, 0.23].map((s, j) => {
          const t = Math.round(total * s);
          const c = Math.round(t * (rates[i] + (j - 1) * 0.02));
          return {
            crn: String(7720000 + i * 131 + j * 17),
            cpin: service === 'voicedrop' ? null : String(4410200 + i * 37 + j),
            total_size: t, connected_size: c, not_connected_size: t - c, connected_percentage: (c / t) * 100,
            total_minutes: Math.round(c * (service === 'voicedrop' ? 2.29 : 18.4)),
          };
        }),
      };
    });
  }
  function campaignBreakdown(kind, service) {
    const total = campaignAccounts(service).reduce((t, a) => t + a.total_size, 0);
    const rows = kind === 'provider' ? PROVIDERS.map((p) => [p[0], p[1], p[2]]) : LOCATIONS.map((l, i) => [l[0], l[1], [0.71, 0.69, 0.7, 0.67, 0.64, 0.68][i]]);
    return split(total, rows.map((r) => r[1])).map((t, i) => {
      const c = Math.round(t * rows[i][2]);
      return { label: rows[i][0], total_size: t, connected_size: c, not_connected_size: t - c, connected_percentage: (c / t) * 100 };
    });
  }
  const CAMPAIGNS = [
    ['08:00', '09:42', '7720003', '118230', '5512', 'Policy renewal reminder — Oct batch 3', 'BK-882041', 21480, 312, 21168, 20480, 688, 15204, 5964, 30412],
    ['08:30', '10:05', '7720134', '104582', '5108', 'EMI due tomorrow — retail loans', 'BK-882057', 18240, 506, 17734, 17101, 633, 13090, 4644, 24983],
    ['09:00', '11:20', '7720265', '120417', '6021', 'Ward 14 water supply schedule', 'BK-882066', 14900, 88, 14812, 14812, 0, 10611, 4201, 19870],
    ['09:15', '10:02', '7720396', '131906', '5240', 'KYC update pending', 'BK-882070', 9850, 240, 9610, 9388, 222, 6620, 2990, 13207],
    ['10:00', '12:30', '7720527', '140022', '6304', 'Parent–teacher meeting, Sat 26 Oct', 'BK-882081', 12410, 61, 12349, 12349, 0, 8183, 4166, 17904],
    ['11:30', '12:48', '7720658', '152871', '5779', 'Planned outage — Sector 21', 'BK-882093', 8870, 102, 8768, 8590, 178, 6004, 2764, 11845],
    ['14:00', '15:15', '7720789', '163340', '6112', 'Flu vaccination camp reminder', 'BK-882104', 7604, 74, 7530, 7530, 0, 5489, 2041, 10233],
    ['15:00', '16:40', '7720920', '170295', '5933', 'Plan upgrade offer — prepaid', 'BK-882118', 11230, 1408, 9822, 9100, 722, 5612, 4210, 12006],
    ['16:30', '17:10', '7721051', '181764', '6450', 'Delivery slot confirmation', 'BK-882126', 5120, 39, 5081, 5081, 0, 3488, 1593, 6214],
    ['18:00', '18:55', '7721182', '203551', '6687', 'Result declaration — Class XII supplementary', 'BK-882140', 16820, 145, 16675, 16675, 0, 12450, 4225, 22910],
  ].map((r) => ({
    date: YESTERDAY, start_time: r[0], end_time: r[1], crn: r[2], account_id: r[3], client_id: r[4], name: r[5], booking_reference: r[6],
    phone_number_count: r[7], dnd_count: r[8], dialout_count: r[9], blast_count: r[10], unblast_count: r[11], connected: r[12], not_connected: r[13], connected_duration: r[14],
  }));

  /* ── MultiCall registry ────────────────────────────────────────────── */
  const REGISTRY = [
    ['MC-20419', 'Bharat Insurance Co.', '+91 98201 44821', 'ops.alerts@bharatinsure.in', 14, 'Portal', '2026-10-22 16:04'],
    ['MC-20433', 'CityCare Hospitals', '+91 99300 11872', 'it-desk@citycare.org', 9, 'API', '2026-10-21 11:39'],
    ['MC-20457', 'Metro Civic Services', '+91 22 4012 7700', 'helpline@metrocivic.gov.in', 22, 'Portal', '2026-10-19 09:15'],
    ['MC-20488', 'Udaan Logistics', '+91 80 4718 2290', 'dispatch@udaanlog.com', 6, 'Sales', '2026-10-17 18:22'],
    ['MC-20502', 'Sunrise Schools Group', '+91 98450 66013', 'admin@sunriseschools.edu.in', 11, 'Portal', '2026-10-15 13:48'],
  ].map((r) => ({ reg: r[0], account: r[1], phone: r[2], email: r[3], profiles: r[4], source: r[5], updated: r[6] }));

  /* ── Upload: the one active dataset and past uploads ───────────────── */
  const DATASET = {
    file: 'cdr_codr_2026-10-01_to_2026-10-23.parquet',
    size: '1.84 GB',
    rows: 12486302,
    cdrRows: 9871140,
    codrRows: 2615162,
    from: '2026-10-01',
    to: '2026-10-23',
    uploadedBy: 'Mukesh K.',
    uploadedAt: '2026-10-24 09:12',
    processing: '6 min 41 s',
  };
  const UPLOADS = [
    { file: 'cdr_codr_2026-10-01_to_2026-10-23.parquet', size: '1.84 GB', by: 'Mukesh K.', at: '2026-10-24 09:12', status: 'Active' },
    { file: 'cdr_codr_2026-10-01_to_2026-10-22.parquet', size: '1.76 GB', by: 'Ritika S.', at: '2026-10-23 09:05', status: 'Replaced' },
    { file: 'cdr_2026-10-22_partial.parquet', size: '402 MB', by: 'Ritika S.', at: '2026-10-23 08:51', status: 'Failed', reason: 'Missing column CONFEREE_TYPE' },
    { file: 'cdr_codr_2026-10-01_to_2026-10-21.parquet', size: '1.69 GB', by: 'Mukesh K.', at: '2026-10-22 09:20', status: 'Replaced' },
    { file: 'cdr_codr_2026-10-01_to_2026-10-20.parquet', size: '1.61 GB', by: 'Arjun P.', at: '2026-10-21 09:02', status: 'Replaced' },
  ];
  const NEW_FILE = { file: 'cdr_codr_2026-10-01_to_2026-10-24.parquet', size: '1.91 GB', rows: 12978554, from: '2026-10-01', to: '2026-10-24' };

  /* ── Reports ───────────────────────────────────────────────────────── */
  const SCHEDULES = [
    { id: 'r1', name: 'Daily Voicedrop summary', service: 'voicedrop', freq: 'Daily', time: '08:00', day: '', format: 'XLSX', recipients: ['ops-team@dsnl.in', 'ritika.s@dsnl.in', 'arjun.p@dsnl.in'], range: 'Previous day', next: 'Oct 25, 08:00', last: 'Delivered', active: true, metrics: ['kpi', 'direction', 'connection', 'providers', 'reblast', 'reasons'] },
    { id: 'r2', name: 'Conference minutes — weekly', service: 'conference', freq: 'Weekly', time: '09:00', day: 'Monday', format: 'CSV', recipients: ['billing@dsnl.in'], range: 'Previous 7 days', next: 'Oct 26, 09:00', last: 'Delivered', active: true, metrics: ['kpi', 'direction', 'peak'] },
    { id: 'r3', name: 'MultiCall connect rate by provider', service: 'multicall', freq: 'Daily', time: '07:30', day: '', format: 'PDF', recipients: ['noc@dsnl.in', 'arjun.p@dsnl.in'], range: 'Previous day', next: '—', last: 'Failed', active: false, metrics: ['connection', 'providers'] },
    { id: 'r4', name: 'All services — month to date', service: 'all', freq: 'Monthly', time: '10:00', day: '1st', format: 'XLSX', recipients: ['management@dsnl.in', 'cfo-office@dsnl.in', 'ops-team@dsnl.in', 'mukesh.mk@dsnl.in', 'sales-lead@dsnl.in'], range: 'Month to date', next: 'Nov 1, 10:00', last: 'Delivered', active: true, metrics: ['kpi', 'direction', 'connection', 'peak', 'providers', 'reblast', 'reasons'] },
    { id: 'r5', name: 'Account 118230 — campaign delivery', service: 'voicedrop', freq: 'Daily', time: '18:00', day: '', format: 'CSV', recipients: ['account-mgr@dsnl.in'], range: 'Previous day', next: 'Oct 24, 18:00', last: 'Delivered', active: true, metrics: ['kpi', 'connection', 'reasons'], account: '118230' },
    { id: 'r6', name: 'Disconnect reasons — weekly review', service: 'all', freq: 'Weekly', time: '17:00', day: 'Friday', format: 'PDF', recipients: ['qa-voice@dsnl.in', 'noc@dsnl.in'], range: 'Previous 7 days', next: 'Oct 30, 17:00', last: 'Delivered', active: true, metrics: ['reasons', 'providers'] },
  ];
  const HISTORY = [
    { id: 'h1', report: 'Daily Voicedrop summary', at: 'Oct 24, 08:00', range: 'Oct 23', status: 'Delivered', size: '412 KB', format: 'XLSX' },
    { id: 'h2', report: 'MultiCall connect rate by provider', at: 'Oct 24, 07:30', range: 'Oct 23', status: 'Failed', size: '—', format: 'PDF', reason: 'Dataset was being replaced when the run started' },
    { id: 'h3', report: 'Account 118230 — campaign delivery', at: 'Oct 24, 18:00', range: 'Oct 24', status: 'Queued', size: '—', format: 'CSV' },
    { id: 'h4', report: 'All services — ad hoc export', at: 'Oct 24, 10:41', range: 'Oct 1 – Oct 23', status: 'Running', size: '—', format: 'XLSX' },
    { id: 'h5', report: 'Account 118230 — campaign delivery', at: 'Oct 23, 18:00', range: 'Oct 23', status: 'Delivered', size: '88 KB', format: 'CSV' },
    { id: 'h6', report: 'Daily Voicedrop summary', at: 'Oct 23, 08:00', range: 'Oct 22', status: 'Delivered', size: '398 KB', format: 'XLSX' },
    { id: 'h7', report: 'MultiCall connect rate by provider', at: 'Oct 23, 07:30', range: 'Oct 22', status: 'Delivered', size: '1.2 MB', format: 'PDF' },
    { id: 'h8', report: 'Disconnect reasons — weekly review', at: 'Oct 23, 17:00', range: 'Oct 16 – Oct 22', status: 'Delivered', size: '2.4 MB', format: 'PDF' },
    { id: 'h9', report: 'Daily Voicedrop summary', at: 'Oct 22, 08:00', range: 'Oct 21', status: 'Delivered', size: '405 KB', format: 'XLSX' },
    { id: 'h10', report: 'Conference minutes — weekly', at: 'Oct 19, 09:00', range: 'Oct 12 – Oct 18', status: 'Delivered', size: '146 KB', format: 'CSV' },
  ];
  const METRIC_OPTIONS = [
    ['kpi', 'KPI summary (calls, participants, minutes)'], ['direction', 'Dial In vs Dial Out'], ['connection', 'Connected vs Not Connected'],
    ['peak', 'Peak ports over time'], ['providers', 'Service-provider counts'], ['reblast', 'Reblast & DTMF counts'], ['reasons', 'Disconnect reasons'],
  ];

  /* ── Assistant ─────────────────────────────────────────────────────── */
  const SUGGESTIONS = [
    'How many voicedrop calls connected yesterday?',
    'Which carrier had the worst connect rate for voicedrop yesterday?',
    'Compare dial-in and dial-out connect rates for conference yesterday',
    'What were the top 5 disconnect reasons yesterday?',
  ];
  const CONVERSATIONS = [
    { id: 'c-1042', title: 'Worst carrier connect rate — Voicedrop', group: 'Today', meta: '4 messages · 10:18' },
    { id: 'c-1041', title: 'Voicedrop connected calls yesterday', group: 'Today', meta: '2 messages · 09:40' },
    { id: 'c-1039', title: 'Conference dial-in vs dial-out', group: 'Yesterday', meta: '6 messages' },
    { id: 'c-1036', title: 'Top 5 disconnect reasons', group: 'Yesterday', meta: '2 messages' },
    { id: 'c-1031', title: 'MultiCall minutes by location', group: 'Previous 7 days', meta: '3 messages' },
    { id: 'c-1027', title: 'Account 118230 reblast analysis', group: 'Previous 7 days', meta: '8 messages' },
    { id: 'c-1022', title: 'Peak ports on Oct 17', group: 'Previous 7 days', meta: '2 messages' },
  ];
  const THREAD = [
    { role: 'user', text: 'Which carrier had the worst connect rate for voicedrop yesterday?', time: '10:18' },
    {
      role: 'ai', time: '10:18', took: '6.4 s', query: 'cdr · voicedrop · 2026-10-23 · group by SERVICE_PROVIDER',
      html: `<p><strong>BSNL</strong> had the lowest Voicedrop connect rate yesterday (Oct 23, 2026): <strong>61.8%</strong> — 11,683 connected out of 18,904 attempts. That is 7.2 points below the Voicedrop average of 69.0%.</p>`,
      table: { cols: ['Carrier', 'Attempts', 'Connected', 'Connect rate'], rows: [['Airtel', '92,140', '65,604', '71.2%'], ['Jio', '81,775', '57,570', '70.4%'], ['Vodafone Idea', '49,306', '32,591', '66.1%'], ['Tata Tele', '6,191', '4,018', '64.9%'], ['BSNL', '18,904', '11,683', '61.8%']] },
    },
    { role: 'user', text: 'What were the top disconnect reasons for BSNL?', time: '10:21' },
    {
      role: 'ai', time: '10:21', took: '4.9 s', query: 'cdr · voicedrop · 2026-10-23 · SERVICE_PROVIDER = BSNL · group by DISCONNECT_REASON',
      html: `<p>For BSNL's 7,221 unconnected Voicedrop attempts, <strong>No answer</strong> leads at 39.6%, followed by <strong>Subscriber absent</strong> at 21.4% — about twice its share on other carriers, which usually points to coverage rather than the campaign.</p>`,
      table: { cols: ['Disconnect reason', 'Calls', 'Share'], rows: [['No answer', '2,860', '39.6%'], ['Subscriber absent', '1,545', '21.4%'], ['User busy', '1,307', '18.1%'], ['Call rejected', '888', '12.3%'], ['Network out of order', '621', '8.6%']] },
    },
  ];

  window.DATA = {
    TODAY, YESTERDAY, SERVICES, ACCOUNTS, ACCOUNT_NAMES, dashboard, daysBetween,
    campaignAccounts, campaignBreakdown, CAMPAIGNS, REGISTRY,
    DATASET, UPLOADS, NEW_FILE, SCHEDULES, HISTORY, METRIC_OPTIONS,
    SUGGESTIONS, CONVERSATIONS, THREAD,
  };
})();
