import { providerName } from '../../lib/providers';
import type { Report, ReportCell, ReportColumn, ReportSection } from '../../lib/reportExport';
import { dayLabel } from '../summary/format';
import type { CallCubeRow, CdrDashboard, CdrFilters, CategoryDatum, DirectionSplitDatum } from './api';

const SERVICE_NAMES: Record<string, string> = {
  all: 'All services',
  voicedrop: 'Voicedrop',
  conference: 'Audio Conference',
  multicall: 'MultiCall',
};

const isNotConnected = (label: string) => /\b(not|un)[\s_-]*connected/i.test(label);
const share = (part: number, whole: number) => (whole ? Math.round((part / whole) * 1000) / 10 : 0);
const sum = (rows: { value: number }[]) => rows.reduce((t, r) => t + r.value, 0);
const blastNumber = (label: string) => Number(label.match(/(\d+)\s*$/)?.[1] ?? 0);
const durationLabel = (label: string) => (label === '60+' ? 'Over 60 s' : `${label.replace('-', '–')} s`);
const num = (label: string): ReportColumn => ({ label, kind: 'number' });
const pctCol = (label = 'Share'): ReportColumn => ({ label, kind: 'percent' });

// The PDF keeps the report as approved; Excel adds the hover breakdowns.
const PDF: ReportSection['formats'] = ['html'];
const XLSX: ReportSection['formats'] = ['xlsx'];

// ── The call cube: the hover breakdowns behind several charts ─────────────
// One row per location × connected × direction × provider, with its attempts.

interface Split {
  connected: number;
  notConnected: number;
  dialIn: number;
  dialOut: number;
  byLocation: Map<string, number>;
  byProvider: Map<string, number>;
}

const emptySplit = (): Split => ({ connected: 0, notConnected: 0, dialIn: 0, dialOut: 0, byLocation: new Map(), byProvider: new Map() });
const add = (m: Map<string, number>, key: string, n: number) => m.set(key, (m.get(key) ?? 0) + n);

/** Every cube row folded under one key (a provider, a location, a status, a direction). */
function splitBy(cube: CallCubeRow[], key: (r: CallCubeRow) => string): Map<string, Split> {
  const out = new Map<string, Split>();
  for (const r of cube) {
    const s = out.get(key(r)) ?? emptySplit();
    if (r.is_connected) s.connected += r.count;
    else s.notConnected += r.count;
    if (/out/i.test(r.call_direction)) s.dialOut += r.count;
    else if (/in/i.test(r.call_direction)) s.dialIn += r.count;
    add(s.byLocation, r.location, r.count);
    add(s.byProvider, r.service_provider, r.count);
    out.set(key(r), s);
  }
  return out;
}

const sortedKeys = (cube: CallCubeRow[], pick: (r: CallCubeRow) => string) => {
  const totals = new Map<string, number>();
  for (const r of cube) add(totals, pick(r), r.count);
  return [...totals].sort((a, b) => b[1] - a[1]).map(([k]) => k);
};

/** Label | count | share, with the direction split when there is one. */
function breakdown(
  title: string,
  first: string,
  rows: CategoryDatum[],
  base: number,
  options: { unit?: string; label?: (l: string) => string; split?: DirectionSplitDatum[]; note?: string; formats?: ReportSection['formats'] } = {},
): ReportSection {
  const split = options.split;
  return {
    title,
    note: options.note,
    formats: options.formats,
    columns: [{ label: first }, num(options.unit ?? 'Attempts'), pctCol(), ...(split ? [num('Dial in'), num('Dial out')] : [])],
    rows: rows.map((r) => {
      const s = split?.find((d) => d.label === r.label);
      return [options.label ? options.label(r.label) : r.label, r.value, share(r.value, base), ...(split ? [s?.dial_in ?? 0, s?.dial_out ?? 0] : [])];
    }),
    bar: 1,
  };
}

/**
 * Everything the Attempt Metrics page shows, as one report. The PDF is the
 * headline figures and a table per chart. The Excel workbook has a sheet per
 * chart, and puts each chart's hover breakdown in it too — as extra columns
 * (by location, provider, direction, connected) or as a second table below.
 */
export function attemptReport(data: CdrDashboard, filters: CdrFilters, cube: CallCubeRow[] = []): Report {
  const service = SERVICE_NAMES[filters.service] ?? filters.service;
  const attempts = data.summary.total_calls;
  const connected = data.connection_status.filter((r) => !isNotConnected(r.label)).reduce((t, r) => t + r.value, 0);
  const oneDay = filters.date_from === filters.date_to;
  const when = oneDay ? dayLabel(filters.date_from) : `${dayLabel(filters.date_from)} – ${dayLabel(filters.date_to)}`;
  const rooms = filters.service === 'conference' || filters.service === 'multicall';

  const meta: [string, string][] = [
    ['Service', service],
    [oneDay ? 'Date' : 'Dates', when],
  ];
  if (filters.account_id) meta.push(['Account', filters.account_id]);
  if (filters.crn) meta.push(['CRN', filters.crn]);
  if (filters.conf_num) meta.push(['Conf Num', filters.conf_num]);
  if (filters.cpin) meta.push(['CPIN', filters.cpin]);
  if (filters.time_from || filters.time_to) meta.push(['Time', `${filters.time_from ?? '00:00'} – ${filters.time_to ?? '23:59'}`]);

  const locations = sortedKeys(cube, (r) => r.location);
  const providerCodes = sortedKeys(cube, (r) => r.service_provider);
  const locCols = locations.map((l) => num(`${l} attempts`));
  const provCols = providerCodes.map((p) => num(providerName(p)));
  const cubeCols = (s: Split | undefined): ReportCell[] => [
    ...locations.map((l) => s?.byLocation.get(l) ?? 0),
    ...providerCodes.map((p) => s?.byProvider.get(p) ?? 0),
  ];
  const hasCube = cube.length > 0;

  const sections: ReportSection[] = [];

  // ── Summary sheet: the headline cards' hover details ──
  sections.push({
    title: 'Attempts by outcome',
    sheet: 'Summary',
    formats: XLSX,
    columns: [{ label: 'Outcome' }, num('Attempts'), pctCol()],
    rows: [
      ['Connected', connected, share(connected, attempts)],
      ['Not connected', attempts - connected, share(attempts - connected, attempts)],
    ],
    total: ['Total attempts', attempts, 100],
  });
  if (data.minutes_by_location.length) {
    const minutesTotal = data.minutes_by_location.reduce((t, l) => t + l.minutes, 0);
    sections.push({
      title: 'Minutes by location',
      sheet: 'Summary',
      formats: XLSX,
      note: 'Each location rounds its own minutes, so the total can differ slightly from the headline figure.',
      columns: [{ label: 'Location' }, num('Minutes'), pctCol(), num('Dial-in min'), num('Dial-out min')],
      rows: data.minutes_by_location.map((l) => [l.label, l.minutes, share(l.minutes, minutesTotal), l.dial_in, l.dial_out]),
      total: [
        'Total',
        minutesTotal,
        100,
        data.minutes_by_location.reduce((t, l) => t + l.dial_in, 0),
        data.minutes_by_location.reduce((t, l) => t + l.dial_out, 0),
      ],
    });
  }

  // ── Call activity / duration (Voicedrop's dial-out stages) ──
  if (data.call_funnel.length) {
    sections.push(breakdown('Call activity', 'Stage', data.call_funnel, attempts, { split: data.call_funnel_direction }));
  }
  if (data.call_duration.length) {
    sections.push(
      breakdown('Call duration', 'Length', data.call_duration, sum(data.call_duration), {
        unit: 'Connected calls',
        label: durationLabel,
        split: data.call_duration_direction,
      }),
    );
  }

  // ── Connection and direction: short tables side by side in the PDF ──
  sections.push(breakdown('Connection', 'Status', data.connection_status, attempts, { formats: PDF }));
  sections.push(breakdown('Call direction', 'Direction', data.call_direction, attempts, { formats: PDF }));
  const byStatus = splitBy(cube, (r) => (r.is_connected ? 'Connected' : 'Not Connected'));
  sections.push({
    title: 'Connection',
    formats: XLSX,
    note: hasCube ? 'Attempts by status, split by direction, location and provider.' : undefined,
    columns: [{ label: 'Status' }, num('Attempts'), pctCol(), ...(hasCube ? [num('Dial in'), num('Dial out'), ...locCols, ...provCols] : [])],
    rows: data.connection_status.map((r) => {
      const s = byStatus.get(isNotConnected(r.label) ? 'Not Connected' : 'Connected');
      return [r.label, r.value, share(r.value, attempts), ...(hasCube ? [s?.dialIn ?? 0, s?.dialOut ?? 0, ...cubeCols(s)] : [])];
    }),
    total: ['Total', attempts, 100],
  });
  const byDirection = splitBy(cube, (r) => r.call_direction);
  sections.push({
    title: 'Call direction',
    formats: XLSX,
    columns: [{ label: 'Direction' }, num('Attempts'), pctCol(), ...(hasCube ? [num('Connected'), num('Not connected'), ...locCols, ...provCols] : [])],
    rows: data.call_direction.map((r) => {
      const s = byDirection.get(r.label);
      return [r.label, r.value, share(r.value, attempts), ...(hasCube ? [s?.connected ?? 0, s?.notConnected ?? 0, ...cubeCols(s)] : [])];
    }),
    total: ['Total', sum(data.call_direction), 100],
  });

  // ── Service providers ──
  const providers = [...data.service_provider].sort((a, b) => b.value - a.value);
  sections.push({
    title: 'Service providers',
    formats: PDF,
    columns: [{ label: 'Provider' }, { label: 'Code', kind: 'id' }, num('Attempts'), pctCol()],
    rows: providers.map((p) => [providerName(p.label), p.label, p.value, share(p.value, attempts)]),
    total: ['Total', null, sum(providers), share(sum(providers), attempts)],
    bar: 2,
  });
  const byProvider = splitBy(cube, (r) => r.service_provider);
  sections.push({
    title: 'Service providers',
    formats: XLSX,
    columns: [
      { label: 'Provider' },
      { label: 'Code', kind: 'id' },
      num('Attempts'),
      pctCol(),
      ...(hasCube ? [num('Connected'), num('Not connected'), pctCol('Connected %'), num('Dial in'), num('Dial out'), ...locCols] : []),
    ],
    rows: providers.map((p) => {
      const s = byProvider.get(p.label);
      return [
        providerName(p.label),
        p.label,
        p.value,
        share(p.value, attempts),
        ...(hasCube
          ? [s?.connected ?? 0, s?.notConnected ?? 0, share(s?.connected ?? 0, p.value), s?.dialIn ?? 0, s?.dialOut ?? 0, ...locations.map((l) => s?.byLocation.get(l) ?? 0)]
          : []),
      ];
    }),
    total: ['Total', null, sum(providers), share(sum(providers), attempts)],
  });

  // ── Location ──
  const minutes = new Map(data.minutes_by_location.map((m) => [m.label, m]));
  const byLocation = splitBy(cube, (r) => r.location);
  sections.push({
    title: 'Location',
    formats: PDF,
    columns: [{ label: 'Location' }, num('Attempts'), pctCol(), num('Minutes'), num('Dial-in min'), num('Dial-out min')],
    rows: data.location.map((l) => {
      const m = minutes.get(l.label);
      return [l.label, l.value, share(l.value, attempts), m?.minutes ?? 0, m?.dial_in ?? 0, m?.dial_out ?? 0];
    }),
    bar: 1,
  });
  sections.push({
    title: 'Location',
    formats: XLSX,
    columns: [
      { label: 'Location' },
      num('Attempts'),
      pctCol(),
      num('Minutes'),
      num('Dial-in min'),
      num('Dial-out min'),
      ...(hasCube ? [num('Connected'), num('Not connected'), pctCol('Connected %'), num('Dial in'), num('Dial out'), ...provCols] : []),
    ],
    rows: data.location.map((l) => {
      const m = minutes.get(l.label);
      const s = byLocation.get(l.label);
      return [
        l.label,
        l.value,
        share(l.value, attempts),
        m?.minutes ?? 0,
        m?.dial_in ?? 0,
        m?.dial_out ?? 0,
        ...(hasCube
          ? [s?.connected ?? 0, s?.notConnected ?? 0, share(s?.connected ?? 0, l.value), s?.dialIn ?? 0, s?.dialOut ?? 0, ...providerCodes.map((p) => s?.byProvider.get(p) ?? 0)]
          : []),
      ];
    }),
    total: ['Total', sum(data.location), 100],
  });

  // ── Repeat attempts, with the AID breakdown each blast's hover shows ──
  const stages = [...data.reblast.stages].sort((a, b) => blastNumber(a.label) - blastNumber(b.label));
  const aidsOf = (label: string) => data.reblast_aid.find((b) => b.label === label)?.aid ?? [];
  sections.push({
    title: 'Repeat attempts',
    note: `${data.reblast.total.toLocaleString()} reblasted (${share(data.reblast.total, attempts)}% of attempts). Blast 0 is the first dial.`,
    columns: [{ label: 'Blast' }, num('Attempts'), pctCol(), num('Connected'), num('Not connected')],
    rows: stages.map((s) => {
      const aids = aidsOf(s.label);
      return [s.label, s.value, share(s.value, attempts), aids.reduce((t, a) => t + a.connected, 0), aids.reduce((t, a) => t + a.not_connected, 0)];
    }),
    bar: 1,
  });
  sections.push({
    title: 'AID breakdown',
    sheet: 'Repeat attempts',
    formats: XLSX,
    note: 'Within each blast, the attempts at each AID count (the retry sequence), connected and not.',
    columns: [{ label: 'Blast' }, { label: 'AID' }, num('Attempts'), num('Connected'), num('Not connected'), pctCol('Connected %')],
    rows: stages.flatMap((s) =>
      aidsOf(s.label).map((a) => [s.label, a.label, a.connected + a.not_connected, a.connected, a.not_connected, share(a.connected, a.connected + a.not_connected)]),
    ),
  });

  // ── Disconnect reasons, and the codes the "Unnamed codes" group holds ──
  const reasons = [...data.disconnect_reason].sort((a, b) => b.value - a.value);
  sections.push(breakdown('Disconnect reasons', 'Reason', reasons, attempts));
  const unnamed = reasons.find((r) => r.codes?.length);
  if (unnamed?.codes?.length) {
    sections.push({
      title: `Codes in "${unnamed.label}"`,
      sheet: 'Disconnect reasons',
      formats: XLSX,
      columns: [{ label: 'Code' }, num('Attempts'), pctCol('Share of group')],
      rows: unnamed.codes.map((c) => [c.label, c.value, share(c.value, unnamed.value)]),
    });
  }

  // ── Peak ports: each hour's highest, then every bucket (Excel) ──
  const byHour = new Map<string, number>();
  for (const p of data.peak_ports) {
    const hour = p.bucket.length > 10 ? `${p.bucket.slice(0, 13)}:00` : p.bucket;
    byHour.set(hour, Math.max(byHour.get(hour) ?? 0, p.peak));
  }
  const hourLabel = (bucket: string) => (oneDay && bucket.length > 10 ? bucket.slice(11) : bucket);
  sections.push({
    title: 'Peak ports by hour',
    sheet: 'Peak ports',
    note: 'The highest number of ports in use at once, in each hour.',
    columns: [{ label: 'Hour', kind: 'id' }, num('Peak ports')],
    rows: [...byHour].map(([h, v]) => [hourLabel(h), v]),
    bar: 1,
  });
  if (data.peak_ports.length > byHour.size) {
    sections.push({
      title: 'Peak ports by minute',
      sheet: 'Peak ports',
      formats: XLSX,
      columns: [{ label: 'Time', kind: 'id' }, num('Peak ports')],
      rows: data.peak_ports.map((p) => [p.bucket, p.peak]),
    });
  }

  // ── Cause codes (the Detailed view) ──
  const causes = data.disconnect_cause ?? [];
  if (causes.length) {
    sections.push({
      title: 'Disconnect cause codes',
      note: 'The system cause code behind each attempt (the Detailed view).',
      columns: [{ label: 'Code', kind: 'id' }, { label: 'Cause' }, num('Attempts'), pctCol()],
      rows: causes.map((c) => [c.code || '—', c.label, c.value, share(c.value, attempts)]),
      total: ['Total', null, sum(causes), share(sum(causes), attempts)],
      bar: 2,
    });
  }

  const avg = connected ? data.summary.minutes_usage / connected : 0;
  const participants = data.summary.total_participants;
  const roomsCount = data.summary.total_conferences;
  const slug = filters.service === 'all' ? 'all-services' : filters.service;
  return {
    title: `${service} · Attempt Metrics`,
    subtitle: when,
    filename: `${slug}-attempt-metrics-${oneDay ? filters.date_from : `${filters.date_from}-to-${filters.date_to}`}`,
    meta,
    kpis: [
      { label: 'Total attempts', value: attempts, note: `${share(connected, attempts)}% of attempts connected` },
      { label: 'Total participants', value: participants, note: `${data.summary.total_phone_numbers.toLocaleString()} phone numbers` },
      ...(rooms
        ? [{ label: filters.service === 'conference' ? 'Conferences with calls' : 'Total conferences', value: roomsCount, note: `${roomsCount ? (participants / roomsCount).toFixed(1) : '0'} participants per conference` }]
        : []),
      { label: 'Total minutes', value: data.summary.minutes_usage, note: `${avg.toFixed(2)} min avg per connected call` },
      { label: 'DTMF count', value: data.dtmf, note: `${share(data.dtmf, connected)}% of connected calls` },
    ],
    sections,
  };
}
