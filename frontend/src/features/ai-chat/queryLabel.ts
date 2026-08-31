/**
 * Turns a tool call into one readable line.
 *
 * The trace under an answer is there so a reader can see *what was looked up*,
 * not so they can audit SQL. Showing the statement made the panel technical in
 * a way that hid the one useful fact — which breakdown, which service, which
 * days. So each call is reduced to a sentence anyone can check against the
 * question they asked.
 *
 * Nothing is invented here: every part of the line comes from the arguments
 * the model actually sent, and a panel this file doesn't recognise falls back
 * to its own name rather than to a guess.
 */

import type { ChatQuery } from './api';

/** Panel name -> what that panel is, in words. */
const PANEL_LABELS: Record<string, string> = {
  summary: 'Totals',
  dtmf: 'Conferees who entered DTMF digits',
  call_direction: 'Dial in vs dial out',
  connection_status: 'Connected vs not connected',
  peak_ports: 'Peak concurrent ports',
  service_provider: 'Breakdown by carrier',
  reblast: 'Reblast attempts',
  reblast_aid: 'Reblast attempts by retry sequence',
  disconnect_reason: 'Disconnect reasons',
  location: 'Breakdown by bridge location',
  minutes_by_location: 'Connected minutes by location',
  call_funnel: 'Call lifecycle (initiated, ringed, connected, ended)',
  call_funnel_direction: 'Call lifecycle, split by dial direction',
  call_duration: 'Connected-call duration',
  call_duration_direction: 'Call duration, split by dial direction',
  by_account: 'Breakdown by account',
  by_date: 'Daily totals',
};

/** Measure name -> what it is, in words. */
const MEASURE_LABELS: Record<string, string> = {
  calls: 'calls',
  connected: 'connected',
  not_connected: 'not connected',
  connect_rate: 'connect rate',
  minutes: 'minutes',
  phone_numbers: 'phone numbers',
  conferences: 'conferences',
  accounts: 'accounts',
  reblasts: 'reblasts',
  dtmf_entries: 'DTMF entries',
};

/** Dimension name -> how it reads after "by". */
const DIMENSION_LABELS: Record<string, string> = {
  date: 'date',
  hour: 'hour',
  location: 'location',
  account: 'account',
  service_provider: 'carrier',
  conference: 'conference',
  direction: 'dial direction',
  disconnect_reason: 'disconnect reason',
  blast: 'blast',
  service_type: 'service',
};

/** "a", "a and b", "a, b and c" — the list reads as a sentence, not an array. */
function joinWords(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function asStringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v));
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);
  }
  return [];
}

const SERVICE_LABELS: Record<string, string> = {
  voicedrop: 'Voicedrop',
  conference: 'Conference',
  multicall: 'Multicall',
  all: '',
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-08-30" -> "30 Aug 2026". Left alone if it isn't a plain ISO date. */
function formatDay(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return value.trim() || null;
  const [, year, month, day] = match;
  const name = MONTHS[Number(month) - 1];
  return name ? `${Number(day)} ${name} ${year}` : value;
}

/** One day reads as a date; a span reads as a range. */
function formatRange(from: unknown, to: unknown): string | null {
  const start = formatDay(from);
  const end = formatDay(to);
  if (!start && !end) return null;
  if (!start) return end;
  if (!end || start === end) return start;
  return `${start} – ${end}`;
}

function asText(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number') return String(value);
  return null;
}

export interface QuerySummary {
  /** What was looked up. */
  title: string;
  /** Range and filters, already joined — may be empty. */
  detail: string;
}

export function summarizeQuery(query: ChatQuery): QuerySummary {
  const input = query.input ?? {};
  const range = formatRange(input.date_from, input.date_to);

  const parts: string[] = [];
  if (range) parts.push(range);

  const service = asText(input.service);
  if (service && SERVICE_LABELS[service] !== '') {
    parts.push(SERVICE_LABELS[service] ?? service);
  }

  const account = asText(input.account_id);
  if (account) parts.push(`account ${account}`);

  const crn = asText(input.crn);
  if (crn) parts.push(`CRN ${crn}`);

  // The cube tool describes itself: its measures and grouping are already the
  // sentence a reader wants ("Minutes and calls by date"), so the title is
  // assembled from them rather than from a lookup table of fixed shapes.
  if (query.tool === 'query_metrics') {
    const measures = asStringList(input.measures).map((m) => MEASURE_LABELS[m] ?? m);
    const dimensions = asStringList(input.group_by).map((d) => DIMENSION_LABELS[d] ?? d);

    const what = measures.length ? joinWords(measures) : 'Totals';
    const by = dimensions.length ? ` by ${joinWords(dimensions)}` : '';
    const title = `${what.charAt(0).toUpperCase()}${what.slice(1)}${by}`;

    return { title, detail: parts.join(' · ') };
  }

  // Tier B already carries a one-line description of its own intent — that is
  // exactly this line, written by the model at the time it ran the query, so
  // it is used verbatim rather than reconstructed from the SQL.
  if (query.tool === 'run_cdr_query') {
    const purpose = asText(input.purpose);
    return {
      title: purpose ?? 'Custom query over the call records',
      detail: parts.join(' · '),
    };
  }

  const panel = asText(input.panel);
  const title = (panel && PANEL_LABELS[panel]) || (panel ? `Breakdown: ${panel}` : 'Looked up call records');

  return { title, detail: parts.join(' · ') };
}
