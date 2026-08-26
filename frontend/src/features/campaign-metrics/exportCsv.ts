/**
 * CSV export for the Campaign Metrics tables.
 *
 * Exports what the table currently shows — the active sort and search, every
 * page of it, not just the page in view. Downloading only the visible 50 rows
 * would be a quiet trap.
 */

/** RFC 4180 quoting: wrap in quotes when the value contains a delimiter, quote or newline. */
function cell(value: unknown): string {
  const text = value == null ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function downloadCsv(filename: string, headers: string[], rows: unknown[][]): void {
  const csv = [headers, ...rows].map((row) => row.map(cell).join(',')).join('\r\n');

  // A BOM so Excel opens UTF-8 correctly rather than mangling non-ASCII.
  const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
