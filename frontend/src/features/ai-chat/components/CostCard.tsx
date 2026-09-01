import { Coins } from 'lucide-react';
import type { TokenUsage } from '../api';

interface CostCardProps {
  usage: TokenUsage;
}

/** Small amounts need more decimals than money usually does. */
function formatCost(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      // A conversation costs fractions of a cent; two decimals would round
      // every honest figure to $0.00 and make the card look broken.
      minimumFractionDigits: amount > 0 && amount < 0.01 ? 4 : 2,
      maximumFractionDigits: 4,
    }).format(amount);
  } catch {
    // An unrecognised currency code should not take the card down with it.
    return `${amount.toFixed(4)} ${currency}`;
  }
}

/**
 * What this conversation has cost, attached above the composer.
 *
 * Deliberately labelled an estimate: it is token counts multiplied by rates
 * from configuration (`AI_PRICE_*`), not anything the provider has billed. The
 * rates are a starting default unless someone has set their own, so presenting
 * this as an invoice would be a lie told in currency.
 *
 * Flat-bottomed and borderless along its lower edge so it reads as attached to
 * the input below rather than as a card floating above it.
 */
export function CostCard({ usage }: CostCardProps) {
  if (usage.total_tokens <= 0) return null;

  return (
    <div
      className="mx-3 flex items-center justify-between gap-3 rounded-t-lg border border-b-0
                 border-zinc-200 dark:border-zinc-800
                 bg-zinc-50 dark:bg-canvas-dark
                 px-3 py-1.5 text-[11px]"
      title="Estimated from token counts and the configured rates — not a provider invoice"
    >
      <span className="flex items-center gap-1.5 text-zinc-500 dark:text-zinc-400">
        <Coins className="w-3.5 h-3.5" />
        Conversation cost
        <span className="text-zinc-400 dark:text-zinc-500">(est.)</span>
      </span>

      <span className="flex items-center gap-2 tabular-nums">
        <span className="text-zinc-400 dark:text-zinc-500">
          {usage.input_tokens.toLocaleString()} in · {usage.output_tokens.toLocaleString()} out
        </span>
        <span className="font-semibold text-zinc-700 dark:text-zinc-200">
          {formatCost(usage.cost, usage.currency)}
        </span>
      </span>
    </div>
  );
}
