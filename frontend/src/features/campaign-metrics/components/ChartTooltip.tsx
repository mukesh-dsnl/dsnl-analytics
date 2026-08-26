import type { TooltipState } from '../useChartTooltip';

/**
 * The hover readout itself.
 *
 * Must be rendered inside an element carrying `data-tooltip-root` and
 * `position: relative` — `useChartTooltip` measures against that element, and
 * this positions itself within it.
 *
 * Non-interactive by construction: it sits under `pointer-events-none` so it
 * can never steal the hover that produced it, which would make it flicker.
 */
export function ChartTooltip({ state }: { state: TooltipState | null }) {
  if (!state) return null;

  return (
    <div
      className="pointer-events-none absolute z-50 -translate-x-1/2 -translate-y-[calc(100%+10px)] whitespace-nowrap rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2.5 py-1.5 shadow-lg"
      style={{ left: state.x, top: state.y }}
      role="tooltip"
    >
      <p className="text-[11px] font-semibold text-zinc-900 dark:text-white">{state.title}</p>
      {state.lines.map((line) => (
        <p
          key={line.label}
          className="mt-0.5 flex items-center gap-1.5 text-[11px] text-zinc-600 dark:text-zinc-400"
        >
          {line.color && (
            <span
              className="h-2 w-2 shrink-0 rounded-sm"
              style={{ backgroundColor: line.color }}
            />
          )}
          <span>{line.label}</span>
          <span className="ml-auto pl-2 font-semibold tabular-nums text-zinc-900 dark:text-white">
            {line.value}
          </span>
        </p>
      ))}
    </div>
  );
}
