import { RotateCcw, X } from 'lucide-react';
import { useState } from 'react';
import type { FormEvent, MouseEvent } from 'react';
import clsx from 'clsx';
import type { CdrFilters } from '../api';

/** The narrowing fields a service can offer. Date range lives beside them in the header, not here. */
export type DetailField = 'account_id' | 'crn' | 'conf_num' | 'cpin' | 'time_from' | 'time_to';

const FIELD_CATALOG: Record<
  DetailField,
  { label: string; type: 'text' | 'time'; placeholder?: string; width: string; numeric?: boolean }
> = {
  // Widths are set per field from what actually goes in them — an account id is
  // six digits, a CPIN seven — rather than one uniform width that would leave
  // the short fields padded and the long ones clipping their own placeholder.
  //
  // All four identifiers are numbers in the source (ACCOUNTID, CRN and
  // CHAIR_PIN are BIGINT; CONF_NUM is text but holds digits only), so the
  // fields take digits only. Letters used to be accepted and simply matched
  // nothing, which showed a page of zeros with no hint as to why.
  account_id: { label: 'Account ID', type: 'text', placeholder: 'Account ID', width: 'w-28', numeric: true },
  crn: { label: 'CRN', type: 'text', placeholder: 'CRN', width: 'w-24', numeric: true },
  conf_num: { label: 'Conf Num', type: 'text', placeholder: 'Conf Num', width: 'w-28', numeric: true },
  cpin: { label: 'CPIN', type: 'text', placeholder: 'CPIN', width: 'w-24', numeric: true },
  time_from: { label: 'Time From', type: 'time', width: 'w-[124px]' },
  time_to: { label: 'Time To', type: 'time', width: 'w-[124px]' },
};

const INPUT_CLASS =
  'h-10 px-3 rounded-lg border bg-white dark:bg-surface-dark border-zinc-200 dark:border-zinc-800 ' +
  'text-zinc-900 dark:text-white text-sm placeholder:text-zinc-400 ' +
  'field-focus outline-none ' +
  '[&::-webkit-calendar-picker-indicator]:dark:invert [&::-webkit-calendar-picker-indicator]:opacity-50';

/**
 * A native time input's own clear "x" only shows up reliably in some
 * browsers and sits flush against the picker icon, easy to miss. Hiding it
 * in favour of one explicit, always-in-the-same-place button (below) keeps
 * clearing a time field discoverable and consistent with the "x" everywhere
 * else in this app.
 */
const TIME_INPUT_CLASS = `${INPUT_CLASS} pr-7 [&::-webkit-clear-button]:hidden [&::-webkit-inner-spin-button]:hidden`;

interface ServiceFilterBarProps {
  /** Which fields this service offers — All shows none of these, just the date range. */
  fields: DetailField[];
  value: CdrFilters;
  /** Called with the whole filter set when it is applied: Apply, Enter, or the clear button. */
  onChange: (next: CdrFilters) => void;
}

/**
 * The narrowing filters for the active service tab, as they appear in the app
 * header beside the date control.
 *
 * Laid out as a single compact row rather than a labelled card: it shares a
 * 64px band with the date picker and theme toggle, so each field carries its
 * name as a placeholder and the two time inputs are labelled by a prefix
 * instead of a stacked label. The row scrolls sideways rather than wrapping —
 * the header's height is fixed, and a wrapped second line would push the date
 * control out of the band.
 *
 * Each service (Voicedrop / Conference / Multicall) offers a different field
 * set — see CDRDashboardPage — because they don't share an identity scheme:
 * CPIN, for instance, only means anything once CODR is in the join.
 *
 * The fields are a draft until Apply (or Enter), as on Port Analyzer. A day's
 * files are a heavy read, and applying on every pause in typing meant a
 * half-typed account id ("1094" on the way to "109446") fired its own query
 * and flashed its own page of figures. Clearing applies at once: there is
 * nothing half-typed about an empty field.
 */
export function ServiceFilterBar({ fields, value, onChange }: ServiceFilterBarProps) {
  const [draft, setDraft] = useState(value);
  // When the applied filters change from outside (Apply itself, or a switch of
  // service, which empties them), the draft starts over from them.
  const [synced, setSynced] = useState(value);
  if (synced !== value) {
    setSynced(value);
    setDraft(value);
  }

  if (fields.length === 0) return null;

  const set = (key: DetailField, raw: string) => setDraft((d) => ({ ...d, [key]: raw === '' ? null : raw }));

  const dirty = fields.some((key) => (draft[key] ?? null) !== (value[key] ?? null));
  const hasAny = fields.some((key) => draft[key] || value[key]);

  const apply = (e: FormEvent) => {
    e.preventDefault();
    if (dirty) onChange(draft);
  };

  const clear = () => {
    const cleared = { ...value };
    for (const key of fields) cleared[key] = null;
    setDraft(cleared);
    onChange(cleared);
  };

  /**
   * Clicking anywhere in a time box opens the native picker, not just the
   * small calendar-icon in its corner — showPicker() is what the browser's
   * own icon triggers internally, so this just widens the hit target to the
   * whole field. Falls back to nothing (a plain click-to-focus) on browsers
   * that don't support it, which is what happened before this handler existed.
   */
  const openTimePicker = (e: MouseEvent<HTMLInputElement>) => {
    e.currentTarget.showPicker?.();
  };

  return (
    // `mx-auto` rather than `justify-center` on the scroll container above:
    // auto margins on a flex item absorb the free space when there is any, and
    // collapse to zero when there isn't — so this centres while it fits and
    // still scrolls from its true start once it doesn't. Centring the container
    // instead would push the overflow off the left edge, out of reach.
    <form onSubmit={apply} className="relative flex items-center gap-2.5 min-w-max py-1 mx-auto">
      {fields.map((key) => {
        const field = FIELD_CATALOG[key];
        const currentValue = draft[key] ?? '';

        if (field.type === 'time') {
          return (
            <div key={key} className="flex items-center gap-1.5 shrink-0">
              {/* The label has to be visible, not just a placeholder: a native
                  time input always renders "--:--", so there is no empty state
                  for a placeholder to occupy. */}
              <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400 whitespace-nowrap">
                {key === 'time_from' ? 'From' : 'To'}
              </span>
              <div className="relative">
                <input
                  id={`cdr-filter-${key}`}
                  type="time"
                  aria-label={field.label}
                  value={currentValue}
                  onChange={(e) => set(key, e.target.value)}
                  onClick={openTimePicker}
                  className={`${TIME_INPUT_CLASS} ${field.width} cursor-pointer`}
                />
                {currentValue && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      set(key, '');
                    }}
                    aria-label={`Clear ${field.label}`}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 rounded text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 dark:hover:text-zinc-200 dark:hover:bg-zinc-800 transition-colors"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>
          );
        }

        return (
          <input
            key={key}
            id={`cdr-filter-${key}`}
            type="text"
            aria-label={field.label}
            value={currentValue}
            placeholder={field.placeholder}
            inputMode={field.numeric ? 'numeric' : undefined}
            title={field.numeric ? `${field.label}: digits only` : undefined}
            onChange={(e) => set(key, field.numeric ? e.target.value.replace(/\D/g, '') : e.target.value)}
            className={`${INPUT_CLASS} ${field.width} shrink-0`}
          />
        );
      })}

      <button
        type="submit"
        disabled={!dirty}
        title={dirty ? 'Apply these filters (Enter)' : 'Change a filter, then apply it'}
        className={clsx(
          'inline-flex h-10 shrink-0 items-center rounded-lg px-4 text-sm font-semibold transition-colors',
          dirty
            ? 'bg-blue-600 text-white hover:bg-blue-700'
            : 'cursor-not-allowed border border-zinc-200 text-zinc-400 dark:border-zinc-800 dark:text-zinc-500',
        )}
      >
        Apply
      </button>

      <button
        type="button"
        onClick={clear}
        disabled={!hasAny}
        title="Clear filters"
        aria-label="Clear filters"
        className="inline-flex items-center justify-center h-10 w-10 shrink-0 rounded-lg border border-zinc-200 dark:border-zinc-800 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/50 disabled:opacity-40 disabled:pointer-events-none transition-colors"
      >
        <RotateCcw className="w-4 h-4" />
      </button>

      {/* Taken out of the flow entirely and hung off the row's right edge, so
          it contributes nothing to the row's width. That is what lets the
          inputs centre on their own width alone: in flow, this changed the
          total width and — because the row is centred — re-centred every field
          on the first keystroke and again when the debounce settled, so the bar
          appeared to jump while being typed into. */}
      <span
        aria-live="polite"
        className="absolute left-full ml-3 top-1/2 -translate-y-1/2 text-xs text-zinc-400 dark:text-zinc-500 whitespace-nowrap pointer-events-none"
      >
        {dirty ? 'Not applied yet' : ''}
      </span>
    </form>
  );
}
