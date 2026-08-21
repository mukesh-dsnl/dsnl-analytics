import { RotateCcw, X } from 'lucide-react';
import type { MouseEvent } from 'react';
import type { CdrFilters } from '../api';

/** The narrowing fields a service can offer. Date range lives beside the tabs, not here. */
export type DetailField = 'account_id' | 'crn' | 'conf_num' | 'cpin' | 'time_from' | 'time_to';

const FIELD_CATALOG: Record<
  DetailField,
  { label: string; type: 'text' | 'time'; placeholder?: string }
> = {
  account_id: { label: 'Account ID', type: 'text', placeholder: 'e.g. 109533' },
  crn: { label: 'CRN', type: 'text', placeholder: 'e.g. 296567' },
  conf_num: { label: 'Conf Num', type: 'text', placeholder: 'e.g. 4471' },
  cpin: { label: 'CPIN', type: 'text', placeholder: 'e.g. 8708430' },
  time_from: { label: 'Time From', type: 'time' },
  time_to: { label: 'Time To', type: 'time' },
};

const INPUT_CLASS =
  'w-full px-3 py-2.5 rounded-md border bg-white dark:bg-zinc-900 border-zinc-300 dark:border-zinc-700 ' +
  'text-zinc-900 dark:text-white text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none ' +
  '[&::-webkit-calendar-picker-indicator]:dark:invert [&::-webkit-calendar-picker-indicator]:opacity-50';

/**
 * A native time input's own clear "x" only shows up reliably in some
 * browsers and sits flush against the picker icon, easy to miss. Hiding it
 * in favour of one explicit, always-in-the-same-place button (below) keeps
 * clearing a time field discoverable and consistent with the "x" everywhere
 * else in this app.
 */
const TIME_INPUT_CLASS = `${INPUT_CLASS} pr-8 [&::-webkit-clear-button]:hidden [&::-webkit-inner-spin-button]:hidden`;

interface ServiceFilterBarProps {
  /** Which fields this service offers — All shows none of these, just the date range. */
  fields: DetailField[];
  value: CdrFilters;
  onChange: (next: CdrFilters) => void;
  /** True while edits are still settling, so the bar can say so. */
  isPending?: boolean;
}

/**
 * The narrowing filters for the active service tab.
 *
 * Each service (Voicedrop / Conference / Multicall) offers a different field
 * set — see CDRDashboardPage — because they don't share an identity scheme:
 * CPIN, for instance, only means anything once CODR is in the join. The date
 * range and service itself live one level up, applying no matter which of
 * these fields are shown.
 *
 * Fields write straight through on every keystroke; the debounce lives one
 * level up, on the value the query reads, so typing stays responsive while
 * requests don't fire per character.
 */
export function ServiceFilterBar({ fields, value, onChange, isPending }: ServiceFilterBarProps) {
  if (fields.length === 0) return null;

  const set = (key: DetailField, raw: string) =>
    onChange({ ...value, [key]: raw === '' ? null : raw });

  const hasAny = fields.some((key) => value[key]);

  const clear = () => {
    const cleared = { ...value };
    for (const key of fields) cleared[key] = null;
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
    <div className="bg-white dark:bg-[#09090B] border border-zinc-200 dark:border-zinc-800/60 rounded-md shadow-sm dark:shadow-lg px-5 py-4 transition-colors duration-300">
      <div className="flex items-end gap-3 flex-wrap">
        {fields.map((key) => {
          const field = FIELD_CATALOG[key];
          const currentValue = value[key] ?? '';

          return (
            <div key={key} className="flex-1 min-w-[150px]">
              <label
                htmlFor={`cdr-filter-${key}`}
                className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1.5"
              >
                {field.label}
              </label>

              {field.type === 'time' ? (
                <div className="relative">
                  <input
                    id={`cdr-filter-${key}`}
                    type="time"
                    value={currentValue}
                    onChange={(e) => set(key, e.target.value)}
                    onClick={openTimePicker}
                    className={`${TIME_INPUT_CLASS} cursor-pointer`}
                  />
                  {currentValue && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        set(key, '');
                      }}
                      aria-label={`Clear ${field.label}`}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 dark:hover:text-zinc-200 dark:hover:bg-zinc-800 transition-colors"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ) : (
                <input
                  id={`cdr-filter-${key}`}
                  type="text"
                  value={currentValue}
                  placeholder={field.placeholder}
                  onChange={(e) => set(key, e.target.value)}
                  className={INPUT_CLASS}
                />
              )}
            </div>
          );
        })}

        <button
          type="button"
          onClick={clear}
          disabled={!hasAny}
          className="flex items-center gap-2 px-4 py-2.5 rounded-md border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <RotateCcw className="w-4 h-4" />
          Clear
        </button>
      </div>

      {isPending && <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-3">Applying filters…</p>}
    </div>
  );
}
