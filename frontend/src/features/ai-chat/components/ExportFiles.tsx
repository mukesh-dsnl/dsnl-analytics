import { AlertTriangle, Download, FileSpreadsheet, FileText, Loader2 } from 'lucide-react';
import type { ExportInfo } from '../api';

function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * The /csv and /excel files under an answer.
 *
 * These hold the full data — every row of the answer's queries, not the
 * preview the chat shows — so a large range can take a moment after the
 * answer itself has arrived; until then the card says it is being prepared.
 */
export function ExportFiles({ exports }: { exports: ExportInfo[] }) {
  if (!exports.length) return null;

  return (
    <ul className="mt-3 flex flex-wrap gap-2" aria-label="Attached files">
      {exports.map((file) => {
        const isExcel = file.format === 'xlsx';
        const Icon = isExcel ? FileSpreadsheet : FileText;
        const kind = isExcel ? 'Excel' : 'CSV';
        return (
          <li
            key={file.id}
            className="flex min-w-[16rem] max-w-md items-center gap-3 rounded-xl border border-zinc-200 bg-white px-3 py-2.5 shadow-sm dark:border-zinc-700 dark:bg-zinc-900"
          >
            <span
              className={
                isExcel
                  ? 'rounded-lg bg-emerald-50 p-2 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300'
                  : 'rounded-lg bg-sky-50 p-2 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300'
              }
            >
              <Icon className="h-5 w-5" />
            </span>

            <span className="min-w-0 flex-1">
              {file.status === 'ready' ? (
                <>
                  <span className="block truncate text-sm font-medium text-zinc-900 dark:text-zinc-100" title={file.file_name ?? undefined}>
                    {file.file_name}
                  </span>
                  <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                    {file.row_count.toLocaleString()} rows
                    {isExcel && file.sheet_count > 1 ? ` · ${file.sheet_count} sheets` : ''} · {size(file.size_bytes)}
                    {file.truncated ? ' · reached the export limit' : ''}
                  </span>
                </>
              ) : file.status === 'pending' ? (
                <>
                  <span className="block text-sm font-medium text-zinc-900 dark:text-zinc-100">Preparing {kind}</span>
                  <span className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                    <Loader2 className="h-3 w-3 animate-spin" /> Running the full queries…
                  </span>
                </>
              ) : (
                <>
                  <span className="flex items-center gap-1.5 text-sm font-medium text-amber-800 dark:text-amber-300">
                    <AlertTriangle className="h-3.5 w-3.5" /> {kind} not created
                  </span>
                  <span className="block text-xs text-zinc-500 dark:text-zinc-400">{file.error}</span>
                </>
              )}
            </span>

            {file.status === 'ready' && file.download_url && (
              // A plain link: same origin, so the session cookie authorises it,
              // and the browser streams the file to disk itself.
              <a
                href={file.download_url}
                download={file.file_name ?? undefined}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-500"
              >
                <Download className="h-3.5 w-3.5" /> Download
              </a>
            )}
          </li>
        );
      })}
    </ul>
  );
}
