import type { ClipboardEvent, FormEvent } from 'react';
import clsx from 'clsx';
import { Loader2, RotateCcw, Search, X } from 'lucide-react';
import type { SearchField } from '../api';
import { MAX_VALUES, SEARCH_FIELDS, focus, parseValues, surface } from '../lookup';
import type { FieldMeta } from '../lookup';

interface SearchPanelProps {
  drafts: Record<SearchField, string>;
  onChange: (field: SearchField, value: string) => void;
  onSubmit: () => void;
  onReset: () => void;
  /** After the first search the bar moves from mid-page to the top. */
  docked: boolean;
  pending: boolean;
}

/**
 * Four boxes in one row, one per searchable column. Every box takes a
 * comma-separated list; the server turns each list into an IN (...) and
 * returns any main account that matches at least one value.
 */
export function SearchPanel({ drafts, onChange, onSubmit, onReset, docked, pending }: SearchPanelProps) {
  const counts = SEARCH_FIELDS.map((field) => parseValues(drafts[field.key], field.key === 'emails').length);
  const total = counts.reduce((sum, count) => sum + count, 0);
  const overLimit = counts.some((count) => count > MAX_VALUES);
  const canSearch = total > 0 && !overLimit && !pending;
  const hasText = SEARCH_FIELDS.some((field) => drafts[field.key].trim());

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (canSearch) onSubmit();
  }

  return <form onSubmit={submit} role="search" aria-label="Registration lookup"
    className={clsx(surface, 'p-3 transition-shadow duration-300 sm:p-4', !docked && 'shadow-lg')}>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[repeat(4,minmax(0,1fr))_auto]">
      {SEARCH_FIELDS.map((field, index) => <SearchBox key={field.key} field={field} value={drafts[field.key]} count={counts[index]}
        disabled={pending} autoFocus={!docked && index === 0} onChange={(value) => onChange(field.key, value)} />)}

      <div className="flex items-end gap-2 sm:col-span-2 xl:col-span-1">
        <button type="submit" disabled={!canSearch} className={clsx('inline-flex h-10 flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-blue-600 px-5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 xl:flex-none', focus)}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Search
        </button>
        <button type="button" onClick={onReset} disabled={!hasText && !docked} title="Clear search and start over" aria-label="Clear search and start over"
          className={clsx('inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-zinc-200 text-zinc-500 transition-colors hover:bg-zinc-50 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-white', focus)}>
          <RotateCcw className="h-4 w-4" />
        </button>
      </div>
    </div>

    {overLimit && <p role="alert" className="mt-3 text-xs font-medium text-red-600 dark:text-red-400">Each box accepts up to {MAX_VALUES} values per search.</p>}
  </form>;
}

function SearchBox({ field, value, count, disabled, autoFocus, onChange }: {
  field: FieldMeta; value: string; count: number; disabled: boolean; autoFocus: boolean;
  onChange: (value: string) => void;
}) {
  const Icon = field.icon;
  const id = `mc-search-${field.key}`;
  const over = count > MAX_VALUES;

  // A single-line input silently drops line breaks, which would glue a pasted
  // spreadsheet column into one value. Turn them into commas instead.
  function onPaste(event: ClipboardEvent<HTMLInputElement>) {
    const pasted = event.clipboardData.getData('text');
    if (!/[\r\n\t]/.test(pasted)) return;
    event.preventDefault();
    const input = event.currentTarget;
    const joined = pasted.split(/[\r\n\t]+/).map((part) => part.trim()).filter(Boolean).join(', ');
    const start = input.selectionStart ?? value.length;
    const end = input.selectionEnd ?? value.length;
    const before = value.slice(0, start);
    const glue = before.trim() && !/[,;]\s*$/.test(before) ? ', ' : '';
    onChange(before + glue + joined + value.slice(end));
  }

  return <label htmlFor={id} className="block min-w-0">
    <span className="mb-1.5 flex items-center justify-between gap-2 text-[11px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
      {field.label}
      {count > 1 && <span className={clsx('rounded-full px-2 py-0.5 text-[10px] font-semibold normal-case tracking-normal', over ? 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300' : 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300')}>{count} values</span>}
    </span>
    <span className="relative block">
      <Icon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
      <input id={id} value={value} onChange={(event) => onChange(event.target.value)} onPaste={onPaste}
        disabled={disabled} autoFocus={autoFocus} type="text" inputMode={field.inputMode} autoComplete="off" spellCheck={false}
        placeholder={field.placeholder}
        className={clsx(
          'w-full rounded-lg border bg-white pl-10 pr-9 text-zinc-900 placeholder:text-zinc-400 transition-colors disabled:cursor-wait disabled:opacity-60 dark:bg-zinc-900/50 dark:text-white',
          over ? 'border-red-300 dark:border-red-500/50' : 'border-zinc-200 hover:border-zinc-300 dark:border-zinc-700 dark:hover:border-zinc-600',
          'h-10 text-sm',
          focus,
        )} />
      {value && !disabled && <button type="button" onClick={() => onChange('')} aria-label={`Clear ${field.label}`}
        className={clsx('absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200', focus)}>
        <X className="h-3.5 w-3.5" />
      </button>}
    </span>
  </label>;
}
