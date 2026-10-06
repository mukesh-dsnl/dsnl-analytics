import { format } from 'date-fns';
import { Hash, KeyRound, Mail, Phone } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { SearchCriteria, SearchField } from './api';

export const surface = 'rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800/70 dark:bg-surface-dark';
export const focus = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-surface-dark';

/** The server refuses more than this many values in one box. */
export const MAX_VALUES = 100;

/** Main accounts have a Reg Num divisible by 8; every other Reg Num is a duplicate the server never returns. */
export function isDuplicateRegNum(value: string): boolean {
  return /^\d+$/.test(value) && BigInt(value) % 8n !== 0n;
}

export interface FieldMeta {
  key: SearchField;
  label: string;
  icon: LucideIcon;
  placeholder: string;
  inputMode: 'numeric' | 'tel' | 'email';
}

export const SEARCH_FIELDS: FieldMeta[] = [
  { key: 'reg_nums', label: 'Reg Num', icon: Hash, placeholder: 'e.g. 102345, 102346', inputMode: 'numeric' },
  { key: 'phones', label: 'Phone', icon: Phone, placeholder: 'e.g. 9876543210, 9123456780', inputMode: 'tel' },
  { key: 'emails', label: 'Email', icon: Mail, placeholder: 'e.g. name@company.com', inputMode: 'email' },
  { key: 'cpins', label: 'CPIN', icon: KeyRound, placeholder: 'e.g. 482913, 557120', inputMode: 'numeric' },
];

export const FIELD_BY_KEY = Object.fromEntries(SEARCH_FIELDS.map((field) => [field.key, field])) as Record<SearchField, FieldMeta>;

export const EMPTY_DRAFTS: Record<SearchField, string> = { reg_nums: '', phones: '', emails: '', cpins: '' };

/** A box's text as distinct values: commas, semicolons, spaces and line breaks all separate. */
export function parseValues(raw: string, caseInsensitive = false): string[] {
  const seen = new Set<string>();
  const values: string[] = [];
  for (const part of raw.split(/[,;\s]+/)) {
    const value = part.trim();
    const key = caseInsensitive ? value.toLowerCase() : value;
    if (value && !seen.has(key)) {
      seen.add(key);
      values.push(value);
    }
  }
  return values;
}

export function toCriteria(drafts: Record<SearchField, string>): SearchCriteria {
  return {
    reg_nums: parseValues(drafts.reg_nums),
    phones: parseValues(drafts.phones),
    emails: parseValues(drafts.emails, true),
    cpins: parseValues(drafts.cpins),
  };
}

export function sourceLabel(value: number | null | undefined): string {
  return value === 1 ? 'MultiCall app' : value === 2 ? 'Facebook' : value === 3 ? 'Google' : 'Unspecified';
}

export function dateLabel(value: string | null | undefined, withTime = true): string {
  if (!value) return '—';
  const date = new Date(value.replace(' ', 'T'));
  return Number.isNaN(date.getTime()) ? value : format(date, withTime ? 'dd MMM yyyy · HH:mm' : 'dd MMM yyyy');
}

export function initials(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '#';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}
