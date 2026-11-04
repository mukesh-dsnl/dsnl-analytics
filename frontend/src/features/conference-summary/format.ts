import type { ConferenceDay } from './api';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-11-02" → "2 Nov 2026", without the UTC shift `new Date(iso)` applies. */
export function dayLabel(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** Rooms by how many parties connected — conference_daily_summary's Party_* columns. */
export const PARTY_BUCKETS: {
  key: 'party_0' | 'party_1' | 'party_2' | 'party_3' | 'party_above_3';
  label: string;
  title: string;
  color: string;
}[] = [
  { key: 'party_0', label: '0', title: 'Rooms nobody joined', color: '#ee8a3c' },
  { key: 'party_1', label: '1', title: 'Rooms with one party connected', color: '#bcd9ee' },
  { key: 'party_2', label: '2', title: 'Rooms with two parties connected', color: '#7fbce0' },
  { key: 'party_3', label: '3', title: 'Rooms with three parties connected', color: '#50a6d5' },
  { key: 'party_above_3', label: '>3', title: 'Rooms with more than three parties connected', color: '#2f6fa8' },
];

export const partyTotal = (day: ConferenceDay) => PARTY_BUCKETS.reduce((sum, b) => sum + day[b.key], 0);
