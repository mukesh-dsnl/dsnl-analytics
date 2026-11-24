/**
 * Report export: a page's figures sent to POST /api/export/report and handed
 * back as an Excel workbook or an HTML page; PDF is that HTML page printed.
 * The shape matches backend/app/api/export.py::Report.
 */

export type ReportCell = string | number | null;

export interface ReportColumn {
  label: string;
  /** id: an identifier kept as text (CRN, phone, DID). percent: 0–100. */
  kind?: 'text' | 'id' | 'number' | 'percent';
}

export interface ReportSection {
  title: string;
  note?: string;
  columns: ReportColumn[];
  rows: ReportCell[][];
  total?: ReportCell[];
  /** Which column the HTML report draws a bar for. */
  bar?: number;
  /** Only in these formats (a per-minute table belongs in Excel only). */
  formats?: ('xlsx' | 'html')[];
  /** The Excel sheet it goes on; tables naming the same sheet stack. "Summary" joins the headline sheet. */
  sheet?: string;
}

export interface Report {
  title: string;
  subtitle?: string;
  filename: string;
  meta: [string, string][];
  kpis: { label: string; value: number; note?: string }[];
  sections: ReportSection[];
  /** The printed page: landscape for wide tables. */
  orientation?: 'portrait' | 'landscape';
}

export type ExportFormat = 'xlsx' | 'html' | 'pdf';

async function render(report: Report, format: 'xlsx' | 'html'): Promise<Blob> {
  const res = await fetch(`/api/export/report?format=${format}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(report),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(typeof body?.detail === 'string' ? body.detail : `Export failed (${res.status})`);
  }
  return res.blob();
}

function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Builds the report and exports it as a file. PDF opens the HTML report in a
 * new window with the print dialog, where "Save as PDF" writes the file. That
 * window is opened at once, inside the click and before anything is awaited,
 * so a popup blocker lets it through; the report fills it when it is ready.
 */
export async function exportReport(build: () => Report | Promise<Report>, format: ExportFormat): Promise<void> {
  if (format !== 'pdf') {
    const report = await build();
    save(await render(report, format), `${report.filename}.${format}`);
    return;
  }
  const win = window.open('', '_blank', 'width=1100,height=900');
  win?.document.write('<p style="font:14px system-ui;padding:24px;color:#6a7d96">Preparing the report…</p>');
  try {
    const report = await build();
    const page = await (await render(report, 'html')).text();
    if (!win) throw new Error('The browser blocked the print window. Allow pop-ups for this site and try again.');
    win.document.open();
    win.document.write(page);
    win.document.close();
    win.focus();
    // Give the page a moment to lay out before the print dialog snapshots it.
    window.setTimeout(() => win.print(), 300);
  } catch (error) {
    win?.close();
    throw error;
  }
}
