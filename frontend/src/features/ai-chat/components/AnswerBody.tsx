import { useEffect, useMemo, useState } from 'react';
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

type Block =
  | { kind: 'p'; text: string; length: number }
  | { kind: 'table'; header: string[]; rows: string[][]; length: number };

/**
 * Split an answer into prose and table blocks.
 *
 * Parsed to data first, rendered second, so the typing animation can decide
 * *per block* how much of it to show. A table has no meaningful half-state —
 * revealing it character by character would print pipes as prose until the
 * separator row arrived — so it is measured here and shown whole.
 */
function parseBlocks(text: string): Block[] {
  const lines = text.split('\n');
  const blocks: Block[] = [];
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    const content = paragraph.join('\n').trim();
    const consumed = paragraph.join('\n').length;
    paragraph = [];
    if (content) blocks.push({ kind: 'p', text: content, length: consumed });
  };

  for (let i = 0; i < lines.length; i++) {
    // A table is a row, a separator, then its body — anything less is just a
    // line that happens to contain pipes, and is left as prose.
    if (isTableRow(lines[i]) && i + 1 < lines.length && isSeparator(lines[i + 1])) {
      flushParagraph();

      const header = splitRow(lines[i]);
      const rows: string[][] = [];
      let cursor = i + 2;
      let consumed = lines[i].length + lines[i + 1].length;

      while (cursor < lines.length && isTableRow(lines[cursor]) && !isSeparator(lines[cursor])) {
        const row = splitRow(lines[cursor]);
        // Pad or trim to the header's width so a ragged row can't shift the
        // columns of the rows below it.
        rows.push(header.map((_, index) => row[index] ?? ''));
        consumed += lines[cursor].length;
        cursor++;
      }

      // A table costs a short beat, not its true character count. It appears
      // whole, so charging the animation for every character in it would buy
      // nothing but a pause with an empty screen — and the bigger the table,
      // the longer that pause, which is exactly backwards.
      void consumed;
      blocks.push({ kind: 'table', header, rows, length: TABLE_BEAT });
      i = cursor - 1;
      continue;
    }

    paragraph.push(lines[i]);
  }

  flushParagraph();
  return blocks;
}

/** Characters per second while an answer types itself in. */
const CHARS_PER_SECOND = 900;

/**
 * What a table costs the reveal, in character-equivalents.
 *
 * A beat long enough to read as "and then the table", short enough that a
 * fifty-row breakdown doesn't stall the animation. Its real length is
 * irrelevant because it renders whole either way.
 */
const TABLE_BEAT = 25;

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

/**
 * How many characters of the answer are on screen.
 *
 * Driven by requestAnimationFrame against a timestamp rather than a per-character
 * interval, so the rate holds steady under load and a dropped frame doesn't
 * desynchronise the reveal.
 */
function useReveal(total: number, enabled: boolean): number {
  const [shown, setShown] = useState(() => (enabled ? 0 : total));

  useEffect(() => {
    if (!enabled) {
      setShown(total);
      return;
    }

    let frame = 0;
    let start: number | null = null;

    const tick = (timestamp: number) => {
      if (start === null) start = timestamp;
      const elapsed = (timestamp - start) / 1000;
      const count = Math.min(total, Math.ceil(elapsed * CHARS_PER_SECOND));
      setShown(count);
      if (count < total) frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [total, enabled]);

  return shown;
}

interface AnswerBodyProps {
  text: string;
  /** Type the answer in. False for history, which should just be there. */
  animate?: boolean;
}

export function AnswerBody({ text, animate = false }: AnswerBodyProps) {
  const blocks = useMemo(() => parseBlocks(text), [text]);
  const total = useMemo(() => blocks.reduce((sum, b) => sum + b.length, 0), [blocks]);

  const shouldAnimate = animate && !prefersReducedMotion();
  const revealed = useReveal(total, shouldAnimate);

  const rendered: ReactNode[] = [];
  let consumed = 0;

  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index];
    const start = consumed;
    consumed += block.length;

    // Not reached yet — and neither is anything after it.
    if (revealed <= start) break;

    if (block.kind === 'table') {
      // Whole or not at all — a partial table is not a table. Reaching its
      // start is enough; the loop above already broke if we hadn't.
      rendered.push(
        <Table key={`t${index}`} tableKey={`t${index}`} header={block.header} rows={block.rows} />,
      );
      continue;
    }

    const visible = block.text.slice(0, Math.max(0, revealed - start));
    if (!visible) break;

    rendered.push(
      <p key={`p${index}`} className="whitespace-pre-wrap break-words leading-relaxed">
        {renderInline(visible, `p${index}`)}
        {/* The caret belongs to the line being written, and goes with it. */}
        {shouldAnimate && revealed < total && (
          <span className="inline-block w-[2px] h-4 ml-0.5 -mb-0.5 align-middle bg-blue-500 animate-pulse" />
        )}
      </p>,
    );
  }

  return <div className="space-y-2">{rendered}</div>;
}
