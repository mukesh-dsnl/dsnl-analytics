import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { Printer, Users } from 'lucide-react';

import {
  CopyButton,
  DetailsDrawer,
  Dash,
  DrawerError,
  DrawerLoading,
  IconButton,
  IdName,
  MONO,
  PRINT_STYLE,
  Row,
  Section,
  escapeHtml,
  printPage,
} from '../../../components/DetailsDrawer';
import { dayLabel } from '../../summary/format';
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

// The sheet's width: dragged on its left edge, remembered per browser.
const WIDTH_KEY = 'conference-room-drawer-width';

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
  const query = useQuery({
    queryKey: ['conference-room', room.date, room.account, room.crn, room.conf_num],
    queryFn: () => conferenceSummaryApi.room(room),
    staleTime: 5 * 60_000,
  });
  const data = query.data;

  return (
    <DetailsDrawer
      ariaLabel={`Conference ${room.crn} details`}
      title={data?.conference_name || room.name || `CRN ${room.crn}`}
      subtitle={`CRN ${room.crn} · Conf ${room.conf_num} · ${dayLabel(room.date)}`}
      icon={<Users className="h-[18px] w-[18px]" />}
      iconTile="bg-[#f1eafd] text-[#7c5cd6] dark:bg-violet-500/15 dark:text-violet-300"
      widthKey={WIDTH_KEY}
      onClose={onClose}
      actions={
        data && (
          <>
            <IconButton label="Print details" onClick={() => printRoom(data)}>
              <Printer className="h-4 w-4" />
            </IconButton>
            <CopyDetails room={data} />
          </>
        )
      }
    >
      {query.isPending ? (
        <DrawerLoading />
      ) : query.error ? (
        <DrawerError what="this room" message={query.error.message} onRetry={() => query.refetch()} />
      ) : (
        <Details room={data!} />
      )}
    </DetailsDrawer>
  );
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

/** The details as plain text, for pasting into a mail or a ticket. */
function CopyDetails({ room }: { room: ConferenceRoom }) {
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
  return <CopyButton text={text} />;
}

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
<style>${PRINT_STYLE}</style></head><body>
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
  printPage(html);
}
