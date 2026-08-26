import { Search, X } from 'lucide-react';

interface HeaderSearchProps {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  /** Shown while the debounced term is still catching up with what's typed. */
  isPending?: boolean;
}

/**
 * The Campaign Metrics search, as it appears in the app header.
 *
 * Sized and shaped like the analytics filter inputs that occupy the same band
 * on the other pages, so the header keeps one control height whichever module
 * is mounted.
 */
export function HeaderSearch({ value, onChange, placeholder, isPending }: HeaderSearchProps) {
  return (
    // `mx-auto` centres it in the free space while it fits and collapses to
    // zero when it doesn't — the same trick the analytics filter row uses.
    <div className="relative mx-auto">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400 pointer-events-none" />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="w-72 lg:w-96 h-10 pl-9 pr-8 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#09090B] text-sm text-zinc-900 dark:text-white placeholder:text-zinc-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Clear search"
          className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 dark:hover:text-zinc-200 dark:hover:bg-zinc-800 transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
      {/* Out of flow, hung off the right edge — in flow it would change the
          box's width and re-centre the whole control on every keystroke. */}
      <span
        aria-live="polite"
        className="absolute left-full ml-3 top-1/2 -translate-y-1/2 text-xs text-zinc-400 dark:text-zinc-500 whitespace-nowrap pointer-events-none"
      >
        {isPending ? 'Searching…' : ''}
      </span>
    </div>
  );
}
