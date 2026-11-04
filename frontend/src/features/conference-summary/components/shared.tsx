import { TipBody } from '../../cdr-dashboard/components/attempt-analytics/HoverTooltip';
import { fmt, pct } from '../../cdr-dashboard/components/attempt-analytics/design';
import type { ConferenceDayTotals } from '../api';

/** What both Conference summary tabs colour their charts by. */

export type CalendarMetric = 'conferences' | 'attended_minutes';
export type HourMetric = 'conferences' | 'connected';

export const CALENDAR_METRICS: { id: CalendarMetric; label: string }[] = [
  { id: 'conferences', label: 'Conferences' },
  { id: 'attended_minutes', label: 'Minutes' },
];
export const HOUR_METRICS: { id: HourMetric; label: string }[] = [
  { id: 'conferences', label: 'Conferences' },
  { id: 'connected', label: 'Parties' },
];
export const HOUR_LABELS: { id: HourMetric; label: string }[] = [
  { id: 'conferences', label: 'Conferences started' },
  { id: 'connected', label: 'Parties connected' },
];

const CALENDAR_LABEL: Record<CalendarMetric, string> = {
  conferences: 'Conferences',
  attended_minutes: 'Attended minutes',
};

/** A calendar day's readout: the chosen figure, then the day's rooms and parties. */
export function conferenceDayTip(metric: CalendarMetric) {
  return function ConferenceDayTip(day: ConferenceDayTotals, eyebrow: string) {
    return (
      <TipBody
        eyebrow={eyebrow}
        title={CALENDAR_LABEL[metric]}
        value={day[metric]}
        share={`${fmt(day.conferences)} conference${day.conferences === 1 ? '' : 's'}${day.accounts ? ` · ${day.accounts} account${day.accounts === 1 ? '' : 's'}` : ''}`}
        sections={[
          {
            title: 'That day',
            rows: [
              { label: 'Parties ringed', value: day.ringed, share: '' },
              { label: 'Parties connected', value: day.connected, share: pct(day.connected, day.ringed) },
              { label: 'Rooms nobody joined', value: day.empty_rooms, share: pct(day.empty_rooms, day.conferences) },
              { label: 'Attended minutes', value: day.attended_minutes, share: '' },
              { label: 'Peak port', value: day.peak_port, share: '' },
            ],
          },
        ]}
      />
    );
  };
}
