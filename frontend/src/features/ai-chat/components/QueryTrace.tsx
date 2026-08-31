import { useState } from 'react';
import { ChevronDown, Database, TriangleAlert } from 'lucide-react';
import clsx from 'clsx';
import type { ChatQuery } from '../api';

interface QueryTraceProps {
  queries: ChatQuery[];
}

/** `panel`/`sql` first, then the rest — the argument that says what was asked. */
const ORDER = ['panel', 'sql', 'purpose', 'service', 'date_from', 'date_to', 'account_id', 'crn'];

function orderedEntries(input: Record<string, unknown>): [string, unknown][] {
  return Object.entries(input).sort(([a], [b]) => {
    const ia = ORDER.indexOf(a);
    const ib = ORDER.indexOf(b);
    return (ia < 0 ? ORDER.length : ia) - (ib < 0 ? ORDER.length : ib);
  });
}

/**
 * What an answer was actually built from, collapsed by default.
 *
 * This is the part that makes a figure checkable. The model is instructed
 * never to state a number a tool did not return, but that is an instruction,
 * not a guarantee — so the calls behind every answer are always available,
 * one click away, with the generated SQL shown verbatim where there was any.
 *
 * Collapsed by default because the answer is the thing being read; expanded on
 * demand because "where did that number come from" is the question anyone
 * reporting off this will eventually ask.
 */
export function QueryTrace({ queries }: QueryTraceProps) {
  const [isOpen, setIsOpen] = useState(false);

  if (!queries.length) return null;

  const failed = queries.filter((q) => q.error).length;

  return (
    <div className="mt-3 border-t border-zinc-200 dark:border-zinc-800/60 pt-2">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200 transition-colors"
      >
        <Database className="w-3.5 h-3.5" />
        {queries.length} {queries.length === 1 ? 'query' : 'queries'}
        {failed > 0 && (
          <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-500">
            <TriangleAlert className="w-3.5 h-3.5" />
            {failed} retried
          </span>
        )}
        <ChevronDown
          className={clsx('w-3.5 h-3.5 transition-transform', isOpen && 'rotate-180')}
        />
      </button>

      {isOpen && (
        <ul className="mt-2 space-y-2">
          {queries.map((query, index) => (
            <li
              key={index}
              className="rounded-md bg-zinc-50 dark:bg-canvas-dark border border-zinc-200 dark:border-zinc-800/60 p-2.5"
            >
              <div className="flex items-center gap-2">
                <code className="text-[11px] font-mono font-semibold text-blue-700 dark:text-blue-400">
                  {query.tool}
                </code>
                {query.error && (
                  <span className="text-[10px] font-medium uppercase tracking-wide text-amber-600 dark:text-amber-500">
                    rejected — model retried
                  </span>
                )}
              </div>

              <dl className="mt-1.5 space-y-1">
                {orderedEntries(query.input).map(([key, value]) => (
                  <div key={key} className="flex gap-2 text-[11px]">
                    <dt className="shrink-0 w-[68px] text-zinc-500 dark:text-zinc-400">{key}</dt>
                    {/* SQL keeps its own line breaks and scrolls rather than
                        wrapping mid-token, which makes a long statement
                        readable instead of a paragraph of keywords. */}
                    <dd
                      className={clsx(
                        'min-w-0 flex-1 text-zinc-700 dark:text-zinc-300',
                        key === 'sql'
                          ? 'font-mono whitespace-pre-wrap break-words'
                          : 'break-words',
                      )}
                    >
                      {typeof value === 'string' ? value : JSON.stringify(value)}
                    </dd>
                  </div>
                ))}
              </dl>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
