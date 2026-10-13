import { useChartTheme } from '../chartTheme';

interface PhoneNumbersTooltipProps {
  phoneNumbers: number;
}

/**
 * Hover readout for the Total Participants KPI: the distinct phone numbers
 * behind those participants.
 *
 * The two differ on purpose. A participant is one conferee in one room on one
 * day, so a number dialled by two campaigns is two participants and one phone
 * number. Phone numbers are counted on their last 10 digits — TEL_DIGIT when
 * dialling out, CLI when dialling in — so a number written with and without
 * its prefix counts once.
 */
export function PhoneNumbersTooltip({ phoneNumbers }: PhoneNumbersTooltipProps) {
  const theme = useChartTheme();

  return (
    <div
      className="rounded-lg border px-3 py-2.5 shadow-lg text-xs min-w-[200px]"
      style={{ background: theme.tooltipBg, borderColor: theme.tooltipBorder, color: theme.tooltipText }}
    >
      <div className="flex items-center justify-between gap-3 tabular-nums font-medium">
        <span className="opacity-90">Total Phone Numbers</span>
        <span>{phoneNumbers.toLocaleString()}</span>
      </div>
      {/* <p className="mt-1 opacity-60">Distinct numbers dialled or dialling in</p> */}
    </div>
  );
}
