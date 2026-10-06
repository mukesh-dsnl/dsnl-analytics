import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

/** "1,234.5", "12.3%", "$40" → number; anything else → null. */
function toNumber(cell: string): number | null {
  const cleaned = cell.replace(/\*\*/g, '').replace(/[,%$₹\s]/g, '');
  if (!/^[-+]?\d+(\.\d+)?$/.test(cleaned)) return null;
  return Number(cleaned);
}

const SERIES_COLORS = ['#0089bf', '#10b981', '#f59e0b'];
const MAX_POINTS = 40;

/**
 * A chart of one answer table, drawn in the browser — /chart asks the model for
 * a table shaped for it (labels first, numbers after), so there is nothing to
 * compute here beyond reading the cells.
 */
export function AnswerChart({ header, rows }: { header: string[]; rows: string[][] }) {
  const numericColumns = header
    .map((name, index) => ({ name: name.replace(/\*\*/g, ''), index }))
    .filter(({ index }) => index > 0 && rows.length > 0 && rows.every((row) => toNumber(row[index] ?? '') !== null))
    .slice(0, 3);

  if (rows.length < 2 || !numericColumns.length) return null;

  const shown = rows.slice(0, MAX_POINTS);
  const data = shown.map((row) => {
    const point: Record<string, string | number> = { label: (row[0] ?? '').replace(/\*\*/g, '') };
    for (const column of numericColumns) point[column.name] = toNumber(row[column.index] ?? '') ?? 0;
    return point;
  });

  // A series over time reads as a line once it has enough points to be one.
  const isSeries = /date|day|month|hour|week/i.test(header[0] ?? '') && shown.length > 7;
  const Chart = isSeries ? LineChart : BarChart;

  return (
    <figure className="my-3 rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-700 dark:bg-zinc-900">
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <Chart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-zinc-200 dark:text-zinc-800" />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" minTickGap={12} />
            <YAxis tick={{ fontSize: 11 }} width={56} tickFormatter={(v: number) => v.toLocaleString()} />
            <Tooltip formatter={(v) => (typeof v === 'number' ? v.toLocaleString() : String(v ?? ''))} />
            {numericColumns.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
            {numericColumns.map((column, i) =>
              isSeries ? (
                <Line key={column.name} type="monotone" dataKey={column.name} stroke={SERIES_COLORS[i]} strokeWidth={2} dot={false} />
              ) : (
                <Bar key={column.name} dataKey={column.name} fill={SERIES_COLORS[i]} radius={[3, 3, 0, 0]} />
              ),
            )}
          </Chart>
        </ResponsiveContainer>
      </div>
      {rows.length > MAX_POINTS && (
        <figcaption className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          Showing the first {MAX_POINTS} of {rows.length} rows.
        </figcaption>
      )}
    </figure>
  );
}
