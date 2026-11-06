import { TipBody } from '../cdr-dashboard/components/attempt-analytics/HoverTooltip';
import { fmt, pct } from '../cdr-dashboard/components/attempt-analytics/design';
import type { DayTotals } from './api';
import type { DailyColumn } from './components/DailyStatement';

/** What the Voicedrop Summary and Accounts pages colour their charts by, and how a day reads. */

export type CalendarMetric = 'dialed' | 'minutes';
export type HourMetric = 'campaigns' | 'dialed';

export const CALENDAR_METRICS: { id: CalendarMetric; label: string }[] = [
  { id: 'dialed', label: 'Dialed' },
  { id: 'minutes', label: 'Minutes' },
];
export const HOUR_METRICS: { id: HourMetric; label: string }[] = [
  { id: 'campaigns', label: 'Campaigns' },
  { id: 'dialed', label: 'Dialed' },
];
export const HOUR_LABELS: { id: HourMetric; label: string }[] = [
  { id: 'campaigns', label: 'Campaigns started' },
  { id: 'dialed', label: 'Numbers dialed' },
];

const CALENDAR_LABEL: Record<CalendarMetric, string> = { dialed: 'Numbers dialed', minutes: 'Connected minutes' };

/** A calendar day's readout: the chosen figure, then the day's campaigns. */
export function voicedropDayTip(metric: CalendarMetric) {
  return function VoicedropDayTip(day: DayTotals, eyebrow: string) {
    return (
      <TipBody
        eyebrow={eyebrow}
        title={CALENDAR_LABEL[metric]}
        value={day[metric]}
        share={`${fmt(day.campaigns)} campaign${day.campaigns === 1 ? '' : 's'}${day.accounts ? ` · ${day.accounts} account${day.accounts === 1 ? '' : 's'}` : ''}`}
        sections={[
          {
            title: 'That day',
            base: day.dialed,
            rows: [
              { label: 'Numbers dialed', value: day.dialed, share: '' },
              { label: 'Connected', value: day.connected, share: pct(day.connected, day.dialed) },
              { label: 'Connected minutes', value: day.minutes, share: '' },
              { label: 'DND', value: day.dnd, share: pct(day.dnd, day.phone_numbers) },
            ],
          },
        ]}
      />
    );
  };
}

/** A day as the daily statement prints it: the day's totals and its connect rate. */
export type VoicedropDayLine = DayTotals & { connect_rate: number };

const sum = (days: VoicedropDayLine[], key: keyof VoicedropDayLine) => days.reduce((t, d) => t + (Number(d[key]) || 0), 0);
const rate = (part: number, whole: number) => (whole ? Math.round((part / whole) * 1000) / 10 : 0);

export const withRate = (d: DayTotals): VoicedropDayLine => ({ ...d, connect_rate: rate(d.connected, d.dialed) });

export const VOICEDROP_DAILY_COLUMNS: DailyColumn<VoicedropDayLine>[] = [
  { key: 'campaigns', label: 'Campaigns' },
  { key: 'accounts', label: 'Accounts', total: () => NaN },
  { key: 'phone_numbers', label: 'Phone numbers' },
  { key: 'dnd', label: 'DND' },
  { key: 'dialout', label: 'Dial out' },
  { key: 'connected', label: 'Connected' },
  { key: 'connect_rate', label: 'Connect %', percent: true, total: (d) => rate(sum(d, 'connected'), sum(d, 'dialed')) },
  { key: 'minutes', label: 'Connected minutes' },
];
