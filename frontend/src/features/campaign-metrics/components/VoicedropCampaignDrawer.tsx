import { useQuery } from '@tanstack/react-query';
import { Megaphone, Printer } from 'lucide-react';

import {
  CopyButton,
  DetailsDrawer,
  Dash,
  IconButton,
  IdName,
  PRINT_STYLE,
  Row,
  Section,
  escapeHtml,
  printPage,
} from '../../../components/DetailsDrawer';
import { providerName } from '../../../lib/providers';
import { dayLabel } from '../../summary/format';
import { campaignApi } from '../api';
import type { VoicedropCampaignDetail } from '../api';
import type { CampaignTableRow } from '../campaignRows';

const WIDTH_KEY = 'voicedrop-campaign-drawer-width';
const nf = new Intl.NumberFormat('en-US');

/** Minutes from start to end ("09:15:00" → "16:30:00" is 435). */
function roomMinutes(start: string | null, end: string | null): number | null {
  if (!start || !end) return null;
  const seconds = (t: string) => {
    const [h, m, s] = t.split(':').map(Number);
    return h * 3600 + m * 60 + (s || 0);
  };
  return Math.max(Math.round((seconds(end) - seconds(start)) / 60), 0);
}

/** "3,210 · 54.7%" — the share of numbers dialled (connected + not connected). */
function withShare(part: number, row: CampaignTableRow): string {
  const dialled = row.connected + row.not_connected;
  return `${nf.format(part)} · ${dialled ? ((part / dialled) * 100).toFixed(1) : '0.0'}%`;
}

/**
 * One Voicedrop campaign in full, in the same side sheet as a conference
 * room: Account, Timing and Room as there, and the campaign's own figures
 * where a conference lists its chairpersons. The summary row supplies most
 * of it, so the sheet opens filled; the providers, the blast count and the
 * names arrive from one small read of that day's CDR file.
 */
export function VoicedropCampaignDrawer({ row, onClose }: { row: CampaignTableRow; onClose: () => void }) {
  const date = row.date ?? '';
  const query = useQuery({
    queryKey: ['voicedrop-campaign', date, row.crn, row.account_id, row.client_id],
    queryFn: () => campaignApi.campaignDetail(date, row.crn, row.account_id, row.client_id),
    enabled: !!date,
    staleTime: 5 * 60_000,
  });
  const detail = query.data;
  const minutes = roomMinutes(row.start_time, row.end_time);
  const pending = <span className="text-[#93b0e0] dark:text-zinc-500">Loading…</span>;
  const failed = query.error ? <span className="text-red-600 dark:text-red-300" title={query.error.message}>Couldn’t read</span> : null;

  return (
    <DetailsDrawer
      ariaLabel={`Campaign ${row.crn} details`}
      title={row.name || `CRN ${row.crn}`}
      subtitle={`CRN ${row.crn}${row.booking_reference != null ? ` · Book Ref ${row.booking_reference}` : ''}${date ? ` · ${dayLabel(date)}` : ''}`}
      icon={<Megaphone className="h-[18px] w-[18px]" />}
      iconTile="bg-[#e8f0fe] text-[#2563eb] dark:bg-blue-500/15 dark:text-blue-300"
      widthKey={WIDTH_KEY}
      onClose={onClose}
      actions={
        <>
          <IconButton label="Print details" onClick={() => printCampaign(row, detail)}>
            <Printer className="h-4 w-4" />
          </IconButton>
          <CopyButton text={detailsText(row, detail)} />
        </>
      }
    >
      <Section title="Account">
        <Row label="Account">
          <IdName id={row.account_id} name={detail?.account_name ?? null} />
        </Row>
        <Row label="Client">
          <IdName id={row.client_id} name={detail?.client_name ?? null} />
        </Row>
        <Row label="Campaign">{row.name || <Dash />}</Row>
      </Section>

      <Section title="Timing">
        <Row label="Date">{date ? dayLabel(date) : <Dash />}</Row>
        <Row label="Start time" mono>
          {row.start_time ?? <Dash />}
        </Row>
        <Row label="End time" mono>
          {row.end_time ?? <Dash />}
        </Row>
        <Row label="Room duration" mono>
          {minutes != null ? `${minutes} min` : <Dash />}
        </Row>
      </Section>

      <Section title="Room">
        <Row label="CRN" mono>
          {row.crn}
        </Row>
        <Row label="Book Ref" mono>
          {row.booking_reference ?? <Dash />}
        </Row>
        <Row label={detail && detail.service_providers.length > 1 ? 'Service providers' : 'Service provider'}>
          {detail ? (
            detail.service_providers.length ? (
              <span className="flex flex-col items-end gap-0.5">
                {detail.service_providers.map((code) => (
                  <span key={code} title={`Code ${code}`}>
                    {providerName(code)}
                  </span>
                ))}
              </span>
            ) : (
              <Dash />
            )
          ) : (
            failed ?? pending
          )}
        </Row>
        <Row label="Total blasts" mono>
          {detail ? (detail.found_in_cdr ? detail.total_blasts : <Dash />) : (failed ?? pending)}
        </Row>
      </Section>

      <Section title="Voicedrop details">
        <Row label="List size" mono>
          {nf.format(row.phone_number_count)}
        </Row>
        <Row label="DND" mono>
          {nf.format(row.dnd_count)}
        </Row>
        <Row label="Dial out" mono>
          {nf.format(row.dialout_count)}
        </Row>
        <Row label="Blast" mono>
          {nf.format(row.blast_count)}
        </Row>
        <Row label="Unblast" mono>
          {row.unblast_count > 0 ? (
            <span className="font-semibold text-red-600 dark:text-red-400">{nf.format(row.unblast_count)}</span>
          ) : (
            nf.format(row.unblast_count)
          )}
        </Row>
        <Row label="Connected" mono>
          <span className="text-emerald-700 dark:text-emerald-400">{withShare(row.connected, row)}</span>
        </Row>
        <Row label="Not connected" mono>
          {withShare(row.not_connected, row)}
        </Row>
      </Section>
    </DetailsDrawer>
  );
}

/** The details as plain text, for pasting into a mail or a ticket. */
function detailsText(row: CampaignTableRow, detail?: VoicedropCampaignDetail): string {
  const minutes = roomMinutes(row.start_time, row.end_time);
  return [
    `Account: ${row.account_id}${detail?.account_name ? ` - ${detail.account_name}` : ''}`,
    `Client: ${row.client_id}${detail?.client_name ? ` - ${detail.client_name}` : ''}`,
    `Campaign: ${row.name ?? '—'}`,
    `Date: ${row.date ?? '—'}`,
    `Start: ${row.start_time ?? '—'}  End: ${row.end_time ?? '—'}  Duration: ${minutes ?? '—'} min`,
    `CRN: ${row.crn}  Book Ref: ${row.booking_reference ?? '—'}`,
    `Service provider: ${detail ? detail.service_providers.map(providerName).join(', ') || '—' : '—'}`,
    `Total blasts: ${detail?.found_in_cdr ? detail.total_blasts : '—'}`,
    `List size: ${row.phone_number_count}  DND: ${row.dnd_count}  Dial out: ${row.dialout_count}`,
    `Blast: ${row.blast_count}  Unblast: ${row.unblast_count}`,
    `Connected: ${withShare(row.connected, row)}  Not connected: ${withShare(row.not_connected, row)}`,
  ].join('\n');
}

/** The details as a page of their own, laid out as the conference room prints. */
function printCampaign(row: CampaignTableRow, detail?: VoicedropCampaignDetail) {
  const minutes = roomMinutes(row.start_time, row.end_time);
  const idName = (id: number, name: string | null | undefined) => `<b class="id">${id}</b>${name ? ` - ${escapeHtml(name)}` : ''}`;
  const tr = (label: string, value: string) => `<tr><th>${label}</th><td>${value}</td></tr>`;
  const mono = (value: unknown) => `<span class="mono">${escapeHtml(value)}</span>`;
  const title = escapeHtml(row.name ?? `CRN ${row.crn}`);
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>${PRINT_STYLE}</style></head><body>
<h1>${title}</h1>
<div class="meta">CRN ${row.crn}${row.booking_reference != null ? ` · Book Ref ${row.booking_reference}` : ''} · ${escapeHtml(row.date ? dayLabel(row.date) : '—')}</div>
<h2>Account</h2><table class="kv">
${tr('Account', idName(row.account_id, detail?.account_name))}
${tr('Client', idName(row.client_id, detail?.client_name))}
${tr('Campaign', escapeHtml(row.name))}
</table>
<h2>Timing</h2><table class="kv">
${tr('Date', escapeHtml(row.date ? dayLabel(row.date) : '—'))}
${tr('Start time', mono(row.start_time))}
${tr('End time', mono(row.end_time))}
${tr('Room duration', minutes != null ? `${minutes} min` : '—')}
</table>
<h2>Room</h2><table class="kv">
${tr('CRN', mono(row.crn))}
${tr('Book Ref', mono(row.booking_reference))}
${tr('Service provider', escapeHtml(detail ? detail.service_providers.map(providerName).join(', ') || '—' : '—'))}
${tr('Total blasts', mono(detail?.found_in_cdr ? detail.total_blasts : '—'))}
</table>
<h2>Voicedrop details</h2><table class="kv">
${tr('List size', mono(nf.format(row.phone_number_count)))}
${tr('DND', mono(nf.format(row.dnd_count)))}
${tr('Dial out', mono(nf.format(row.dialout_count)))}
${tr('Blast', mono(nf.format(row.blast_count)))}
${tr('Unblast', mono(nf.format(row.unblast_count)))}
${tr('Connected', mono(withShare(row.connected, row)))}
${tr('Not connected', mono(withShare(row.not_connected, row)))}
</table>
</body></html>`;
  printPage(html);
}
