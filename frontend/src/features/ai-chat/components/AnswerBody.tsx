import type { ReactNode } from 'react';

/**
 * Renders an assistant answer: prose, plus any markdown tables in it.
 *
 * Deliberately a tiny hand-rolled parser rather than a markdown library. The
 * model is instructed to emit exactly two things — pipe tables for breakdowns
 * and **bold** for a headline figure — so the surface to support is small and
 * fixed, and pulling in a full markdown renderer (plus a sanitiser, since this
 * is model output) would be a lot of weight and a lot of attack surface for
 * two constructs.
 *
 * Nothing here interprets HTML: text is only ever placed as text nodes by
 * React, so a table cell containing `<script>` renders as those characters.
 */

/** A row of `| a | b |`, with the optional leading/trailing pipes stripped. */
function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

/** `|---|:--:|` — the separator that makes the line above it a header. */
function isSeparator(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes('-') || !trimmed.includes('|')) return false;
  return splitRow(trimmed).every((cell) => /^:?-{1,}:?$/.test(cell));
}

function isTableRow(line: string): boolean {
  return line.trim().startsWith('|') && line.trim().length > 1;
}

/**
 * Whether this answer contains a table, so the bubble around it can take the
 * full column width instead of the 85% a sentence looks right in.
 */
export function hasTable(text: string): boolean {
  const lines = text.split('\n');
  return lines.some(
    (line, index) =>
      isTableRow(line) && index + 1 < lines.length && isSeparator(lines[index + 1]),
  );
}

/** Right-align a column when every value in it reads as a number. */
function isNumericColumn(rows: string[][], index: number): boolean {
  const values = rows.map((row) => row[index]).filter((v) => v != null && v !== '');
  if (!values.length) return false;
  return values.every((v) => /^[-+]?[\d,]+(\.\d+)?\s*%?$/.test(v.trim()));
}

/** **bold** -> <strong>. Split on the delimiter; odd segments are the bold ones. */
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  return text.split(/\*\*/).map((segment, index) =>
    index % 2 === 1 ? (
      <strong key={`${keyPrefix}-b${index}`} className="font-semibold">
        {segment}
      </strong>
    ) : (
      <span key={`${keyPrefix}-t${index}`}>{segment}</span>
    ),
  );
}

function Table({ header, rows, tableKey }: { header: string[]; rows: string[][]; tableKey: string }) {
  const numeric = header.map((_, index) => isNumericColumn(rows, index));

  return (
    // Wide breakdowns scroll inside the bubble instead of stretching it.
    <div className="my-2 -mx-1 overflow-x-auto">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="border-b border-zinc-200 dark:border-zinc-700">
            {header.map((cell, index) => (
              <th
                key={index}
                scope="col"
                className={`px-2.5 py-1.5 font-semibold text-zinc-600 dark:text-zinc-300 whitespace-nowrap ${
                  numeric[index] ? 'text-right' : 'text-left'
                }`}
              >
                {renderInline(cell, `${tableKey}-h${index}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr
              key={rowIndex}
              className="border-b border-zinc-100 dark:border-zinc-800/60 last:border-0"
            >
              {header.map((_, cellIndex) => (
                <td
                  key={cellIndex}
                  className={`px-2.5 py-1.5 text-zinc-700 dark:text-zinc-300 ${
                    numeric[cellIndex]
                      ? 'text-right tabular-nums whitespace-nowrap'
                      : 'text-left'
                  }`}
                >
                  {renderInline(row[cellIndex] ?? '', `${tableKey}-r${rowIndex}c${cellIndex}`)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AnswerBody({ text }: { text: string }) {
  const lines = text.split('\n');
  const blocks: ReactNode[] = [];
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    const content = paragraph.join('\n').trim();
    paragraph = [];
    if (!content) return;
    blocks.push(
      <p key={`p${blocks.length}`} className="whitespace-pre-wrap break-words leading-relaxed">
        {renderInline(content, `p${blocks.length}`)}
      </p>,
    );
  };

  for (let i = 0; i < lines.length; i++) {
    // A table is a row, a separator, then its body — anything less is just a
    // line that happens to contain pipes, and is left as prose.
    if (isTableRow(lines[i]) && i + 1 < lines.length && isSeparator(lines[i + 1])) {
      flushParagraph();

      const header = splitRow(lines[i]);
      const rows: string[][] = [];
      let cursor = i + 2;

      while (cursor < lines.length && isTableRow(lines[cursor]) && !isSeparator(lines[cursor])) {
        const row = splitRow(lines[cursor]);
        // Pad or trim to the header's width so a ragged row can't shift the
        // columns of the rows below it.
        rows.push(header.map((_, index) => row[index] ?? ''));
        cursor++;
      }

      const tableKey = `t${blocks.length}`;
      blocks.push(<Table key={tableKey} tableKey={tableKey} header={header} rows={rows} />);
      i = cursor - 1;
      continue;
    }

    paragraph.push(lines[i]);
  }

  flushParagraph();

  return <div className="space-y-1">{blocks}</div>;
}
