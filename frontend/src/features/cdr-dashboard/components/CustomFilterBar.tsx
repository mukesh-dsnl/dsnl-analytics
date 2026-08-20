import { RotateCcw } from 'lucide-react';
import type { CdrFilters } from '../api';

/** The fields this bar owns. The date range lives beside the tabs, not here. */
type DetailField = 'account_id' | 'crn' | 'conf_num' | 'time_from' | 'time_to';

const FIELDS: {
  key: DetailField;
  label: string;
  type: 'text' | 'time';
  placeholder?: string;
}[] = [
  { key: 'account_id', label: 'Account ID', type: 'text', placeholder: 'e.g. 109533' },
  { key: 'crn', label: 'CRN', type: 'text', placeholder: 'e.g. 296567' },
  { key: 'conf_num', label: 'Conf Num', type: 'text', placeholder: 'e.g. 4471' },
  { key: 'time_from', label: 'Time From', type: 'time' },
  { key: 'time_to', label: 'Time To', type: 'time' },
];

const INPUT_CLASS =
  'w-full px-3 py-2.5 rounded-md border bg-white dark:bg-zinc-900 border-zinc-300 dark:border-zinc-700 ' +
  'text-zinc-900 dark:text-white text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none ' +
  '[&::-webkit-calendar-picker-indicator]:dark:invert [&::-webkit-calendar-picker-indicator]:opacity-50';

interface CustomFilterBarProps {
  value: CdrFilters;
  onChange: (next: CdrFilters) => void;
  /** True while edits are still settling, so the bar can say so. */
  isPending?: boolean;
}

/**
 * The narrowing filters, shown only on the Custom tab.
 *
 * The time window applies independently of the date range: "09:00-17:00 across
 * the whole range" is the useful reading, not "from 9am on the first day to 5pm
 * on the last".
 *
 * Fields write straight through on every keystroke; the debounce lives one
 * level up, on the value the query reads, so typing stays responsive while
 * requests don't fire per character.
 */
export function CustomFilterBar({ value, onChange, isPending }: CustomFilterBarProps) {
  const set = (key: DetailField, raw: string) =>
    onChange({ ...value, [key]: raw === '' ? null : raw });

  const hasAny = FIELDS.some((field) => value[field.key]);

  const clear = () => {
    const cleared = { ...value };
    for (const field of FIELDS) cleared[field.key] = null;
    onChange(cleared);
  };

  return (
    <div className="bg-white dark:bg-[#09090B] border border-zinc-200 dark:border-zinc-800/60 rounded-md shadow-sm dark:shadow-lg px-5 py-4 transition-colors duration-300">
      <div className="flex items-end gap-3 flex-wrap">
        {FIELDS.map((field) => (
          <div key={field.key} className="flex-1 min-w-[150px]">
            <label
              htmlFor={`cdr-filter-${field.key}`}
              className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1.5"
            >
              {field.label}
            </label>
            <input
              id={`cdr-filter-${field.key}`}
              type={field.type}
              value={value[field.key] ?? ''}
              placeholder={field.placeholder}
              onChange={(e) => set(field.key, e.target.value)}
              className={INPUT_CLASS}
            />
          </div>
        ))}

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
