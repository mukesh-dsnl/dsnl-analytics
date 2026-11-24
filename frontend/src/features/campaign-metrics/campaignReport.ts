import { providerName } from '../../lib/providers';
import type { Report, ReportColumn, ReportSection } from '../../lib/reportExport';
import { dayLabel } from '../summary/format';
import type { ConferenceRecord } from '../conference-summary/api';
import type {
  AccountMetricsRow,
  Breakdown,
  CampaignService,
  LocationMetricsRow,
  ServiceProviderMetricsRow,
  VoicedropCampaignRow,
} from './api';
import { isNoAccount, measureLabels } from './labels';

const SERVICE_NAMES: Record<CampaignService, string> = {
  voicedrop: 'Voicedrop',
  conference: 'Audio Conference',
  multicall: 'MultiCall',
};

const num = (label: string): ReportColumn => ({ label, kind: 'number' });
const pct = (label: string): ReportColumn => ({ label, kind: 'percent' });
const share = (part: number, whole: number) => (whole ? Math.round((part / whole) * 1000) / 10 : 0);
const total = <T,>(rows: T[], pick: (r: T) => number) => rows.reduce((t, r) => t + pick(r), 0);

/** Minutes from "09:15:00" to "16:30:00". */
function minutesBetween(start: string | null, end: string | null): number | null {
  if (!start || !end) return null;
  const s = (t: string) => {
    const [h, m, sec] = t.split(':').map(Number);
    return h * 3600 + m * 60 + (sec || 0);
  };
  return Math.max(Math.round((s(end) - s(start)) / 60), 0);
}

/** Every tab's data for the day, fetched for the export. */
export interface CampaignExportData {
  accounts: AccountMetricsRow[];
  providers: Breakdown<ServiceProviderMetricsRow>;
  locations: Breakdown<LocationMetricsRow>;
  /** Voicedrop's Campaigns tab. */
  campaigns?: VoicedropCampaignRow[];
  /** Conference's Conferences tab. */
  conferences?: ConferenceRecord[];
}

/** One sheet's measure columns, as the tab shows them. */
function measureSection(
  title: string,
  first: ReportColumn[],
  rows: { cells: (string | number | null)[]; total_size: number; connected_size: number; not_connected_size: number; connected_percentage: number }[],
  labels: ReturnType<typeof measureLabels>,
  dayTotal?: { total_size: number; connected_size: number; not_connected_size: number; connected_percentage: number },
  note?: string,
): ReportSection {
  const blanks = first.slice(1).map(() => null);
  const t = dayTotal ?? {
    total_size: total(rows, (r) => r.total_size),
    connected_size: total(rows, (r) => r.connected_size),
    not_connected_size: total(rows, (r) => r.not_connected_size),
    connected_percentage: share(total(rows, (r) => r.connected_size), total(rows, (r) => r.total_size)),
  };
  return {
    title,
    note,
    columns: [...first, num(labels.total), num(labels.connected), num(labels.notConnected), pct(labels.percent)],
    rows: rows.map((r) => [...r.cells, r.total_size, r.connected_size, r.not_connected_size, r.connected_percentage]),
    total: ['Total', ...blanks, t.total_size, t.connected_size, t.not_connected_size, t.connected_percentage],
    bar: first.length,
  };
}

/**
 * Campaign Metrics for one day and service: a sheet per tab — Account wise,
 * Campaigns (or Conferences), Service Provider wise, Location wise — with a
 * column for every figure the tab shows. The PDF prints the same tables on
 * landscape pages.
 */
export function campaignReport(service: CampaignService, date: string, data: CampaignExportData): Report {
  const name = SERVICE_NAMES[service];
  const labels = measureLabels(service);
  const sections: ReportSection[] = [];

  // ── Account wise ──
  const accounts = data.accounts;
  const minutes = total(accounts, (a) => a.total_minutes);
  sections.push({
    title: 'Account wise',
    columns: [
      { label: 'Account', kind: 'id' },
      { label: 'Account name' },
      num(labels.total),
      num(labels.connected),
      num(labels.notConnected),
      pct(labels.percent),
      num('Minutes'),
    ],
    rows: accounts.map((a) => [
      isNoAccount(a.account) ? 'No account' : a.account,
      a.account_name ?? '',
      a.total_size,
      a.connected_size,
      a.not_connected_size,
      a.connected_percentage,
      a.total_minutes,
    ]),
    total: [
      'Total',
      `${accounts.length} accounts`,
      total(accounts, (a) => a.total_size),
      total(accounts, (a) => a.connected_size),
      total(accounts, (a) => a.not_connected_size),
      share(total(accounts, (a) => a.connected_size), total(accounts, (a) => a.total_size)),
      minutes,
    ],
    bar: 2,
  });

  // ── Campaigns (Voicedrop) ──
  if (data.campaigns) {
    const rows = data.campaigns;
    const dialled = (r: VoicedropCampaignRow) => r.connected + r.not_connected;
    sections.push({
      title: 'Campaigns',
      columns: [
        { label: 'Account', kind: 'id' },
        { label: 'Client', kind: 'id' },
        { label: 'Book Ref', kind: 'id' },
        { label: 'Start' },
        { label: 'End' },
        num('Room min'),
        { label: 'Campaign' },
        { label: 'CRN', kind: 'id' },
        num('Numbers'),
        num('DND'),
        num('Dial out'),
        num('Blast'),
        num('Unblast'),
        num('Connected'),
        num('Not connected'),
        pct('Connected %'),
        num('Duration'),
      ],
      rows: rows.map((r) => [
        r.account_id,
        r.client_id,
        r.booking_reference,
        r.start_time,
        r.end_time,
        minutesBetween(r.start_time, r.end_time),
        r.name,
        r.crn,
        r.phone_number_count,
        r.dnd_count,
        r.dialout_count,
        r.blast_count,
        r.unblast_count,
        r.connected,
        r.not_connected,
        share(r.connected, dialled(r)),
        r.connected_duration,
      ]),
      total: [
        'Total',
        null,
        null,
        null,
        null,
        null,
        `${rows.length} campaigns`,
        null,
        total(rows, (r) => r.phone_number_count),
        total(rows, (r) => r.dnd_count),
        total(rows, (r) => r.dialout_count),
        total(rows, (r) => r.blast_count),
        total(rows, (r) => r.unblast_count),
        total(rows, (r) => r.connected),
        total(rows, (r) => r.not_connected),
        share(total(rows, (r) => r.connected), total(rows, dialled)),
        total(rows, (r) => r.connected_duration),
      ],
    });
  }

  // ── Conferences (Conference) ──
  if (data.conferences) {
    const rows = [...data.conferences].sort((a, b) => (a.start_time ?? '').localeCompare(b.start_time ?? ''));
    sections.push({
      title: 'Conferences',
      columns: [
        { label: 'Account', kind: 'id' },
        { label: 'Account name' },
        { label: 'Start' },
        { label: 'End' },
        num('Room min'),
        { label: 'Conference' },
        { label: 'CRN', kind: 'id' },
        { label: 'Conf Num', kind: 'id' },
        { label: 'PIN', kind: 'id' },
        { label: 'DID', kind: 'id' },
        num('Ringed'),
        num('Connected'),
        pct('Connected %'),
        num('Call min'),
        num('Attended min'),
        num('Peak port'),
      ],
      rows: rows.map((r) => [
        r.account_id,
        r.account_name ?? '',
        r.start_time,
        r.end_time,
        r.length_minutes,
        r.conference_name ?? '',
        r.crn,
        r.conf_num,
        r.pin,
        r.dids.join(', '),
        r.ringed,
        r.connected,
        share(r.connected, r.ringed),
        r.call_minutes,
        r.attended_minutes,
        r.peak_port,
      ]),
      total: [
        'Total',
        `${rows.length} conferences`,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        total(rows, (r) => r.ringed),
        total(rows, (r) => r.connected),
        share(total(rows, (r) => r.connected), total(rows, (r) => r.ringed)),
        total(rows, (r) => r.call_minutes),
        total(rows, (r) => r.attended_minutes),
        Math.max(0, ...rows.map((r) => r.peak_port)),
      ],
    });
  }

  // ── Service Provider wise and Location wise: the day's own total ──
  const overlapNote = (n: number, group: string) =>
    n > 0
      ? `${n.toLocaleString()} of the ${labels.unit} were tried on more than one ${group}, so they appear in each of those rows. The Total counts each one once.`
      : undefined;
  sections.push(
    measureSection(
      'Service Provider wise',
      [{ label: 'Provider' }, { label: 'Code', kind: 'id' }],
      data.providers.rows.map((r) => ({ ...r, cells: [providerName(r.service_provider), r.service_provider] })),
      labels,
      data.providers.total,
      overlapNote(data.providers.overlap, 'provider'),
    ),
  );
  sections.push(
    measureSection(
      'Location wise',
      [{ label: 'Location' }],
      data.locations.rows.map((r) => ({ ...r, cells: [r.location] })),
      labels,
      data.locations.total,
      overlapNote(data.locations.overlap, 'location'),
    ),
  );

  const dayTotal = data.providers.total;
  const kpis: Report['kpis'] = [
    { label: labels.total, value: dayTotal.total_size, note: 'each counted once' },
    { label: labels.connected, value: dayTotal.connected_size, note: `${dayTotal.connected_percentage.toFixed(1)}% ${labels.percent.toLowerCase().replace('connected % ', '')}` },
    { label: 'Accounts', value: accounts.length },
    { label: 'Minutes', value: minutes },
  ];
  if (data.campaigns) kpis.splice(2, 0, { label: 'Campaigns', value: data.campaigns.length });
  if (data.conferences) kpis.splice(2, 0, { label: 'Conferences', value: data.conferences.length });

  return {
    title: `${name} · Campaign Metrics`,
    subtitle: dayLabel(date),
    filename: `${service}-campaign-metrics-${date}`,
    meta: [
      ['Service', name],
      ['Date', dayLabel(date)],
    ],
    kpis,
    sections,
    // The Campaigns and Conferences tables run to 16–17 columns.
    orientation: 'landscape',
  };
}
