import { providerName } from '../../lib/providers';
import type { Report } from '../../lib/reportExport';
import { dayLabel } from '../summary/format';
import type { AccountInsight, CampaignFilter } from './api';

const SERVICE_NAMES: Record<CampaignFilter['service'], string> = {
  voicedrop: 'VoiceDrop',
  conference: 'Conference',
  multicall: 'MultiCall',
};

const trailing = (label: string) => Number(label.match(/(\d+)\s*$/)?.[1] ?? 0);

/**
 * Everything the popup shows, as a report. Excel has two sheets: Summary (who
 * and when, the headline figures, failed attempts, disconnect reasons and
 * provider performance, as stacked tables) and Blast details (one row per
 * blast and AID: started, ringing, connected, ended). The PDF prints the same.
 */
export function insightReport(insight: AccountInsight, filters: CampaignFilter, account: string, crn?: string | null): Report {
  const { summary, failed, disconnect_reasons, blasts } = insight;
  const carriers = insight.carriers.map((c) => ({ ...c, attempts: c.attempts ?? 0, attempt_percentage: c.attempt_percentage ?? 0 }));
  const service = SERVICE_NAMES[filters.service] ?? filters.service;
  const meta: [string, string][] = [
    ['Service', service],
    ['Date', dayLabel(filters.date)],
    ['Account ID', account],
  ];
  if (crn) meta.push(['CRN', crn]);
  if (insight.cpin) meta.push(['CPIN', insight.cpin]);
  if (insight.conf_num) meta.push(['Conf Num', insight.conf_num]);

  const blastRows = blasts
    .slice()
    .sort((x, y) => trailing(x.label) - trailing(y.label))
    .flatMap((b) =>
      b.aids
        .slice()
        .sort((x, y) => trailing(x.label) - trailing(y.label))
        .map((a) => [trailing(b.label), trailing(a.label), a.proceeded, a.alert, a.connected, a.ended, a.total_initiated]),
    );
  const sumCol = (i: number) => blastRows.reduce((t, r) => t + Number(r[i] || 0), 0);

  return {
    title: `${service} · Account ${account}${crn ? ` · CRN ${crn}` : ''}`,
    subtitle: dayLabel(filters.date),
    filename: `campaign-${filters.service}-${account}${crn ? `-${crn}` : ''}-${filters.date}`,
    meta,
    kpis: [
      { label: 'Total uploaded', value: summary.total_uploaded },
      { label: 'Dial attempts', value: summary.dial_attempts },
      { label: 'Connected users', value: summary.connected_users, note: `${summary.connect_percentage.toFixed(2)}% connection rate` },
      { label: 'Connected dial out', value: summary.connected_dial_out },
      { label: 'Connected dial in', value: summary.connected_dial_in },
    ],
    sections: [
      {
        title: 'Failed attempts',
        sheet: 'Summary',
        columns: [{ label: 'Failure' }, { label: 'Attempts', kind: 'number' }, { label: 'Share of failures', kind: 'percent' }],
        rows: [
          ['Never rang', failed.never_rang, failed.never_rang_percentage],
          ['Rang, unanswered', failed.rang_unanswered, failed.rang_unanswered_percentage],
        ],
        total: ['Total failed', failed.total, 100],
        bar: 1,
      },
      {
        title: 'Disconnect reasons',
        sheet: 'Summary',
        columns: [{ label: 'Reason' }, { label: 'Attempts', kind: 'number' }, { label: 'Share of failures', kind: 'percent' }],
        rows: disconnect_reasons.map((r) => [r.reason, r.count, r.percentage]),
        bar: 1,
      },
      {
        title: 'Service providers',
        sheet: 'Summary',
        columns: [
          { label: 'Provider' },
          { label: 'Code', kind: 'id' },
          { label: 'Attempts', kind: 'number' },
          { label: 'Share of attempts', kind: 'percent' },
          { label: 'Numbers', kind: 'number' },
          { label: 'Connected', kind: 'number' },
          { label: 'Connected %', kind: 'percent' },
        ],
        rows: carriers.map((c) => [providerName(c.carrier), c.carrier, c.attempts, c.attempt_percentage, c.total, c.connected, c.connect_percentage]),
        bar: 2,
      },
      {
        title: 'Blast details',
        note: 'Dial-out attempts at each blast and AID (retry sequence): how many started, rang, connected and ended.',
        columns: [
          { label: 'Blast', kind: 'number' },
          { label: 'AID', kind: 'number' },
          { label: 'Started', kind: 'number' },
          { label: 'Ringing', kind: 'number' },
          { label: 'Connected', kind: 'number' },
          { label: 'Ended', kind: 'number' },
          { label: 'Total initiated', kind: 'number' },
        ],
        rows: blastRows,
        total: ['Total', null, sumCol(2), sumCol(3), sumCol(4), sumCol(5), sumCol(6)],
      },
    ],
  };
}
