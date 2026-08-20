import { useState } from 'react';
import { CalendarRange, Inbox } from 'lucide-react';

const INPUT_CLASS =
  'bg-transparent text-sm text-zinc-900 dark:text-white outline-none ' +
  '[&::-webkit-calendar-picker-indicator]:dark:invert [&::-webkit-calendar-picker-indicator]:opacity-50';

const todayIso = () => new Date().toISOString().slice(0, 10);

/**
 * Voicedrop → Blast Details.
 *
 * Nothing is wired to the backend yet — this is the page the sidebar's
 * expandable Voicedrop section links to, holding just enough of a date/time
 * filter for that to be dropped in later without reshaping the page around it.
 */
export function BlastDetailsPage() {
  const [date, setDate] = useState(todayIso());
  const [timeFrom, setTimeFrom] = useState('');
  const [timeTo, setTimeTo] = useState('');

  return (
    <div className="p-8 max-w-[1500px] mx-auto min-h-full">
      <div className="space-y-6">
        <div className="flex items-center gap-2 px-3 h-[46px] rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#09090B] w-fit transition-colors duration-300">
          <CalendarRange className="w-4 h-4 shrink-0 text-zinc-400" />

          <label htmlFor="blast-date" className="sr-only">
            Date
          </label>
          <input
            id="blast-date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className={`${INPUT_CLASS} w-[125px]`}
          />

          <span className="w-px h-5 bg-zinc-200 dark:bg-zinc-800 mx-1" />

          <label htmlFor="blast-time-from" className="sr-only">
            Time from
          </label>
          <input
            id="blast-time-from"
            type="time"
            value={timeFrom}
            onChange={(e) => setTimeFrom(e.target.value)}
            className={`${INPUT_CLASS} w-[100px]`}
          />
          <span className="text-zinc-300 dark:text-zinc-600 select-none">–</span>
          <label htmlFor="blast-time-to" className="sr-only">
            Time to
          </label>
          <input
            id="blast-time-to"
            type="time"
            value={timeTo}
            onChange={(e) => setTimeTo(e.target.value)}
            className={`${INPUT_CLASS} w-[100px]`}
          />
        </div>

        <div className="bg-white dark:bg-[#09090B] border border-zinc-200 dark:border-zinc-800/60 rounded-md shadow-sm dark:shadow-lg flex flex-col items-center justify-center gap-2 text-center py-24 transition-colors duration-300">
          <div className="w-11 h-11 rounded-md bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-zinc-400">
            <Inbox className="w-5 h-5" />
          </div>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">Nothing here yet.</p>
        </div>
      </div>
    </div>
  );
}
