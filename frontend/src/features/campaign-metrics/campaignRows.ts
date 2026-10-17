import type { VoicedropCampaignRow } from './api';

/** Sortable columns: every field, plus the derived connected percentage. */
export type CampaignSortKey = keyof VoicedropCampaignRow | 'connected_percentage';

/** A row with its connected share worked out, so it can be sorted on. */
export type CampaignTableRow = VoicedropCampaignRow & { connected_percentage: number };

/** Connected as a share of the numbers that were dialled — connected plus not connected. */
export function withConnectedShare(row: VoicedropCampaignRow): CampaignTableRow {
  const dialled = row.connected + row.not_connected;
  return {
    ...row,
    connected_percentage: dialled > 0 ? Math.round((row.connected / dialled) * 1000) / 10 : 0,
  };
}

/** Numbers left unblasted mean the campaign did not finish dialling its list. */
export function isIncomplete(row: VoicedropCampaignRow): boolean {
  return row.unblast_count > 0;
}

export const CAMPAIGN_COLUMNS: { key: CampaignSortKey; label: string; align: 'left' | 'right' }[] = [
  { key: 'start_time', label: 'Start Time', align: 'left' },
  { key: 'end_time', label: 'End Time', align: 'left' },
  { key: 'crn', label: 'CRN', align: 'left' },
  { key: 'account_id', label: 'Account', align: 'left' },
  { key: 'client_id', label: 'Client', align: 'left' },
  { key: 'name', label: 'Name', align: 'left' },
  { key: 'booking_reference', label: 'Booking Ref', align: 'left' },
  { key: 'phone_number_count', label: 'Phone Numbers', align: 'right' },
  { key: 'dnd_count', label: 'DND', align: 'right' },
  { key: 'dialout_count', label: 'Dial Out', align: 'right' },
  { key: 'blast_count', label: 'Blast', align: 'right' },
  { key: 'unblast_count', label: 'Unblast', align: 'right' },
  { key: 'connected', label: 'Connected', align: 'right' },
  { key: 'not_connected', label: 'Not Connected', align: 'right' },
  { key: 'connected_percentage', label: 'Connected %', align: 'right' },
  { key: 'connected_duration', label: 'Connected Duration', align: 'right' },
];
