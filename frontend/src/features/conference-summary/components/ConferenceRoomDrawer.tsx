import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { AlertTriangle, Check, Copy, Loader2, Printer, Users, X } from 'lucide-react';

import { useContentPanel } from '../../../components/ContentPanelSlot';
import { cleanName, dayLabel } from '../../summary/format';
import { conferenceSummaryApi } from '../api';
import type { ConferenceRoom } from '../api';

export interface RoomRef {
  date: string;
  account: number;
  crn: number;
  conf_num: string;
  /** Shown while the details load. */
  name?: string;
}

// Numbers line up without a monospace face: Inter's tabular digits.
const MONO = 'tabular-nums';

// The sheet's width: dragged on its left edge, remembered per browser.
const WIDTH_KEY = 'conference-room-drawer-width';
const MIN_WIDTH = 380;
const DEFAULT_WIDTH = 460;

function savedWidth(): number {
  try {
    const value = Number(localStorage.getItem(WIDTH_KEY));
    return value >= MIN_WIDTH ? value : DEFAULT_WIDTH;
  } catch {
    return DEFAULT_WIDTH;
  }
}

/**
 * One conference room in full, sliding in from the right of the floating
 * content panel (and only that panel — it portals into it): the booking from
 * that day's CODR, the DIDs and chairpersons from its CDR. Laid out as the
 * job-log drawer is — a white sheet, the conference's name as its title, a
 * monospace line under it, then label / value rows. Names are never cut short:
 * they wrap. The left edge drags to widen it, and Print opens the details as
 * a page of their own.
 */
export function ConferenceRoomDrawer({ room, onClose }: { room: RoomRef; onClose: () => void }) {
  const panel = useContentPanel();
  const query = useQuery({
    queryKey: ['conference-room', room.date, room.account, room.crn, room.conf_num],
    queryFn: () => conferenceSummaryApi.room(room),
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Drag the left edge: the sheet is anchored right, so moving left widens it.
  const [width, setWidth] = useState(savedWidth);
  const drag = useRef<{ x: number; width: number } | null>(null);
  const maxWidth = () => Math.max(MIN_WIDTH, (panel?.clientWidth ?? window.innerWidth) - 120);
  const startDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, width };
  };
  const onDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    setWidth(Math.round(Math.min(maxWidth(), Math.max(MIN_WIDTH, drag.current.width + drag.current.x - e.clientX))));
  };
  const endDrag = () => {
    if (!drag.current) return;
    drag.current = null;
    try {
      localStorage.setItem(WIDTH_KEY, String(width));
    } catch {
      // Private mode: the width simply isn't remembered.
    }
  };

  const data = query.data;
  const sheet = (
    <div className={clsx('inset-0 z-50', panel ? 'absolute' : 'fixed')} role="presentation">
      {/* The page behind dims; clicking it closes. */}
      <div className="drawer-fade absolute inset-0 bg-[#0f2340]/20 backdrop-blur-[1.5px]" onClick={onClose} />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={`Conference ${room.crn} details`}
        style={{ width: Math.min(width, maxWidth()) }}
        className="drawer-in font-sans antialiased absolute inset-y-0 right-0 flex max-w-full flex-col border-l border-[#e3eaf3] bg-white text-[#35415a] shadow-[-24px_0_60px_rgba(15,35,64,0.16)] dark:border-white/[0.06] dark:bg-[#0e192c] dark:text-zinc-200"
      >
        {/* The resize handle, along the left edge. */}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Drag to resize"
          title="Drag to resize"
          onPointerDown={startDrag}
          onPointerMove={onDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onDoubleClick={() => setWidth(DEFAULT_WIDTH)}
          className="group absolute inset-y-0 -left-1.5 z-10 flex w-3 cursor-col-resize touch-none items-center justify-center"
        >
          <span className="h-full w-px bg-transparent transition-colors group-hover:bg-[#93b8f3] group-active:bg-[#2563eb]" />
          <span className="absolute h-10 w-1 rounded-full bg-[#c9d5e4] opacity-0 transition-opacity group-hover:opacity-100 dark:bg-white/20" />
        </div>
        <header className="shrink-0 border-b border-[#eef2f7] px-5 pt-5 pb-4 dark:border-white/[0.07]">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#f1eafd] text-[#7c5cd6] dark:bg-violet-500/15 dark:text-violet-300">
              <Users className="h-[18px] w-[18px]" />
            </span>
            <h2 className="min-w-0 flex-1 break-words pt-1 text-[17px] font-semibold leading-snug text-[#16213a] dark:text-white">
              {data?.conference_name || room.name || `CRN ${room.crn}`}
            </h2>
            <div className="flex shrink-0 items-center gap-1.5">
              {data && (
                <IconButton label="Print details" onClick={() => printRoom(data)}>
                  <Printer className="h-4 w-4" />
                </IconButton>
              )}
              {data && <CopyDetails room={data} />}
              <IconButton label="Close" onClick={onClose}>
                <X className="h-4 w-4" />
              </IconButton>
            </div>
          </div>
          <p className={clsx(MONO, 'mt-2 text-[12.5px] text-[#6a7d96] dark:text-zinc-400')}>
            CRN {room.crn} · Conf {room.conf_num} · {dayLabel(room.date)}
          </p>
        </header>

        <div className="relative min-h-0 flex-1 overflow-y-auto bg-[#f7f9fc] px-5 py-4 [scrollbar-width:thin] dark:bg-transparent">
          {query.isPending ? (
            <DrawerLoading />
          ) : query.error ? (
            <div className="flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 px-3.5 py-3 text-[13px] text-red-700 dark:border-red-400/25 dark:bg-red-500/10 dark:text-red-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="font-medium">Couldn’t read this room.</p>
                <p className="mt-0.5 break-words opacity-80">{query.error.message}</p>
                <button type="button" onClick={() => query.refetch()} className="mt-2 text-xs font-semibold underline">
                  Retry
                </button>
              </div>
            </div>
          ) : (
            <Details room={data!} />
          )}
        </div>
      </aside>
    </div>
  );
  return panel ? createPortal(sheet, panel) : sheet;
}

function Details({ room }: { room: ConferenceRoom }) {
  return (
    <>
      <Section title="Account">
        <Row label="Account">
          <IdName id={room.account_id} name={room.account_name} />
        </Row>
        <Row label="Client">{room.client_id != null ? <IdName id={room.client_id} name={room.client_name} /> : <Dash />}</Row>
        <Row label="Conference">{room.conference_name || <Dash />}</Row>
      </Section>

      <Section title="Timing">
        <Row label="Date">{dayLabel(room.date)}</Row>
        <Row label="Start time" mono>
          {room.start_time ?? <Dash />}
        </Row>
        <Row label="End time" mono>
          {room.end_time ?? <Dash />}
        </Row>
        <Row label="Room duration" mono>
          {room.room_duration_mins != null ? `${room.room_duration_mins} min` : <Dash />}
        </Row>
      </Section>

      <Section title="Room">
        <Row label="CRN" mono>
          {room.crn}
        </Row>
        <Row label="Conference no." mono>
          {room.conf_num}
        </Row>
        <Row label="Chair PIN" mono>
          {room.chair_pin ?? <Dash />}
        </Row>
        <Row label={room.dids.length > 1 ? 'DIDs' : 'DID'} mono>
          {room.dids.length ? (
            <span className="flex flex-col items-end gap-0.5">
              {room.dids.map((did) => (
                <span key={did}>{did}</span>
              ))}
            </span>
          ) : (
            <Dash />
          )}
        </Row>
      </Section>

      <Section title={`Chairpersons${room.chairpersons.length ? ` · ${room.chairpersons.length}` : ''}`}>
        {room.cdr_note ? (
          <p className="py-2.5 text-[12px] text-amber-700 dark:text-amber-200/80">{room.cdr_note}</p>
        ) : room.chairpersons.length === 0 ? (
          <p className="py-2.5 text-[12.5px] text-[#6a7d96] dark:text-zinc-400">
            No chairperson called in{room.chair_name ? ` · booked for ${room.chair_name}` : ''}.
          </p>
        ) : (
          <ul className="divide-y divide-[#eef2f7] dark:divide-white/[0.05]">
            {room.chairpersons.map((c, i) => (
              <li key={`${c.phone}-${c.name}-${i}`} className="flex items-center gap-3 py-2.5">
                <span
                  className={clsx('h-2 w-2 shrink-0 rounded-full', c.joined ? 'bg-emerald-500' : 'bg-[#c3cdda] dark:bg-[#4a5870]')}
                  title={c.joined ? 'Joined the room' : 'Called, never joined'}
                />
                <span className="min-w-0 flex-1">
                  <span className="block break-words text-[13.5px] font-semibold text-[#1d4ed8] dark:text-sky-300">{c.name ?? 'No name'}</span>
                  <span className={clsx(MONO, 'block text-[12.5px] text-[#2563eb] dark:text-sky-400')}>{c.phone ?? 'No number'}</span>
                </span>
                <span className={clsx(MONO, 'shrink-0 text-right text-[12px] text-[#8a99ad] dark:text-zinc-500')}>
                  {c.first_call && <span className="block">{c.first_call}</span>}
                  {c.legs > 1 && <span className="block">{c.legs} calls</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-5 last:mb-1">
      <h3 className="mb-1.5 px-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#2f5a8c] dark:text-sky-300">{title}</h3>
      <div className="rounded-xl border border-[#e6ecf4] bg-white px-3.5 shadow-[0_1px_2px_#1c305408] dark:border-white/[0.06] dark:bg-white/[0.025]">{children}</div>
    </section>
  );
}

function Row({ label, mono, children }: { label: string; mono?: boolean; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-[#eef2f7] py-2.5 last:border-0 dark:border-white/[0.05]">
      <span className="shrink-0 whitespace-nowrap text-[13px] font-semibold text-[#0f172a] dark:text-zinc-100">{label}</span>
      <span className={clsx('min-w-0 break-words text-right text-[13.5px] font-medium text-[#1d4ed8] dark:text-sky-300', mono && MONO)}>{children}</span>
    </div>
  );
}

function IdName({ id, name }: { id: number; name: string | null }) {
  const label = cleanName(name, id);
  return (
    <span>
      <span className={clsx(MONO, 'font-bold text-[#1d4ed8] dark:text-sky-300')}>{id}</span>
      {label && (
        <>
          <span className="mx-1.5 text-[#93b0e0] dark:text-zinc-600">-</span>
          {label}
        </>
      )}
    </span>
  );
}

const Dash = () => <span className="text-[#93b0e0] dark:text-zinc-600">—</span>;

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#e3eaf3] bg-white text-[#5b6a82] transition-colors hover:bg-[#f3f7fc] hover:text-[#16213a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#42b9e9]/60 dark:border-white/10 dark:bg-white/[0.04] dark:text-zinc-300 dark:hover:bg-white/[0.1] dark:hover:text-white"
    >
      {children}
    </button>
  );
}

/** The details as plain text, for pasting into a mail or a ticket. */
function CopyDetails({ room }: { room: ConferenceRoom }) {
  const [copied, setCopied] = useState(false);
  const text = [
    `Account: ${room.account_id}${room.account_name ? ` - ${room.account_name}` : ''}`,
    `Client: ${room.client_id ?? '—'}${room.client_name ? ` - ${room.client_name}` : ''}`,
    `Conference: ${room.conference_name ?? '—'}`,
    `Date: ${room.date}`,
    `Start: ${room.start_time ?? '—'}  End: ${room.end_time ?? '—'}  Duration: ${room.room_duration_mins ?? '—'} min`,
    `CRN: ${room.crn}  Conf Num: ${room.conf_num}  Chair PIN: ${room.chair_pin ?? '—'}`,
    `DID: ${room.dids.join(', ') || '—'}`,
    'Chairpersons:',
    ...room.chairpersons.map((c) => `  ${c.name ?? 'No name'} - ${c.phone ?? 'No number'}${c.joined ? '' : ' (never joined)'}`),
  ].join('\n');
  return (
    <IconButton
      label={copied ? 'Copied' : 'Copy details'}
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-300" /> : <Copy className="h-4 w-4" />}
    </IconButton>
  );
}

/** The Port Analyzer's loading look: a sweeping bar and a Processing chip. */
function DrawerLoading() {
  return (
    <div className="relative h-64 overflow-hidden rounded-xl border border-[#e6ecf4] bg-white dark:border-white/[0.06] dark:bg-white/[0.02]">
      <div className="absolute inset-x-0 top-0 h-1 overflow-hidden bg-[#e8f0fe] dark:bg-sky-500/10" role="progressbar" aria-label="Processing">
        <div className="progress-sweep h-full w-1/4 rounded-full bg-[#2563eb]" />
      </div>
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="flex items-center gap-3 rounded-xl border border-[#e4eaf2] bg-white px-4 py-3 shadow-[0_10px_30px_rgba(15,23,42,0.12)] dark:border-white/[0.08] dark:bg-[#13213a]">
          <Loader2 className="h-5 w-5 animate-spin text-[#2563eb]" />
          <span className="text-[13px] font-semibold text-[#0f172a] dark:text-white">Processing…</span>
        </div>
      </div>
    </div>
  );
}

const escapeHtml = (value: unknown) =>
  String(value ?? '—').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/**
 * The details as a page of their own, in a new window, and the print dialog
 * over it: every value in full on white, the chairpersons as a table — rather
 * than printing the app around a sheet that is clipped to the screen.
 */
function printRoom(room: ConferenceRoom) {
  const idName = (id: number | null, name: string | null) =>
    id == null ? '—' : `<b class="id">${id}</b>${name ? ` - ${escapeHtml(name)}` : ''}`;
  const row = (label: string, value: string) => `<tr><th>${label}</th><td>${value}</td></tr>`;
  const chairs = room.chairpersons.length
    ? `<table class="list"><thead><tr><th>Name</th><th>Phone</th><th>First call</th><th>Calls</th><th>Joined</th></tr></thead><tbody>${room.chairpersons
        .map(
          (c) =>
            `<tr><td>${escapeHtml(c.name ?? 'No name')}</td><td class="mono">${escapeHtml(c.phone ?? '—')}</td><td class="mono">${escapeHtml(c.first_call)}</td><td class="mono">${c.legs}</td><td>${c.joined ? 'Yes' : 'No'}</td></tr>`,
        )
        .join('')}</tbody></table>`
    : `<p class="note">${escapeHtml(room.cdr_note ?? 'No chairperson called in.')}</p>`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(room.conference_name ?? `CRN ${room.crn}`)}</title>
<style>
  body { font: 13px/1.5 Inter, 'Segoe UI', system-ui, sans-serif; font-variant-numeric: tabular-nums; color: #16213a; margin: 32px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .meta { font-size: 12px; color: #5b6a82; margin-bottom: 20px; }
  h2 { font-size: 11px; letter-spacing: .12em; text-transform: uppercase; color: #2f5a8c; margin: 18px 0 6px; }
  table { width: 100%; border-collapse: collapse; }
  .kv th { width: 34%; text-align: left; font-weight: 600; font-size: 13px; color: #0f172a; padding: 6px 0; vertical-align: top; }
  .kv td { padding: 6px 0; border-bottom: 1px solid #eef2f7; color: #1d4ed8; font-weight: 500; }
  .kv tr:last-child td { border-bottom: 0; }
  .list th { text-align: left; font-size: 11px; color: #0f172a; border-bottom: 1px solid #cfe0f3; padding: 6px 8px 6px 0; }
  .list td { padding: 6px 8px 6px 0; border-bottom: 1px solid #eef2f7; color: #1d4ed8; }
  .id { color: #1d4ed8; }
  .mono { font-variant-numeric: tabular-nums; }
  .note { color: #6a7d96; }
  @page { margin: 14mm; }
</style></head><body>
<h1>${escapeHtml(room.conference_name ?? `CRN ${room.crn}`)}</h1>
<div class="meta">CRN ${room.crn} · Conf ${escapeHtml(room.conf_num)} · ${escapeHtml(dayLabel(room.date))}</div>
<h2>Account</h2><table class="kv">
${row('Account', idName(room.account_id, room.account_name))}
${row('Client', idName(room.client_id, room.client_name))}
${row('Conference', escapeHtml(room.conference_name))}
</table>
<h2>Timing</h2><table class="kv">
${row('Date', escapeHtml(dayLabel(room.date)))}
${row('Start time', `<span class="mono">${escapeHtml(room.start_time)}</span>`)}
${row('End time', `<span class="mono">${escapeHtml(room.end_time)}</span>`)}
${row('Room duration', room.room_duration_mins != null ? `${room.room_duration_mins} min` : '—')}
</table>
<h2>Room</h2><table class="kv">
${row('CRN', `<span class="mono">${room.crn}</span>`)}
${row('Conference no.', `<span class="mono">${escapeHtml(room.conf_num)}</span>`)}
${row('Chair PIN', `<span class="mono">${escapeHtml(room.chair_pin)}</span>`)}
${row(room.dids.length > 1 ? 'DIDs' : 'DID', `<span class="mono">${room.dids.length ? room.dids.join('<br>') : '—'}</span>`)}
</table>
<h2>Chairpersons${room.chairpersons.length ? ` · ${room.chairpersons.length}` : ''}</h2>
${chairs}
</body></html>`;
  const win = window.open('', '_blank', 'width=820,height=900');
  if (!win) return;
  win.document.open();
  win.document.write(html);
  win.document.close();
  win.focus();
  win.onafterprint = () => win.close();
  win.print();
}
