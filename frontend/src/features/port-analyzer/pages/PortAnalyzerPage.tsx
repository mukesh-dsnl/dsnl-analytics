import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { AlertTriangle, ChevronDown, Loader2, Play, Server } from 'lucide-react';

import { useHeaderSlot } from '../../../components/HeaderSlot';
import { useCdrStatus } from '../../campaign-metrics/hooks';
import { SingleDateSelector } from '../../campaign-metrics/components/SingleDateSelector';
import { dayLabel } from '../../summary/format';
import { analyzePorts } from '../api';
import type { PortRequest, PortService } from '../api';
import { MultiSelect } from '../components/MultiSelect';
import { PortActivity } from '../components/PortActivity';
import type { PortView } from '../components/PortActivity';
import { DEFAULT_FROM, DEFAULT_TO, defaultDay, fromSeconds, paramsFromRequest, requestFromParams, toSeconds } from '../params';

const SERVICES: { id: PortService; label: string }[] = [
  { id: 'all', label: 'All services' },
  { id: 'voicedrop', label: 'Voicedrop' },
  { id: 'conference', label: 'Conference' },
  { id: 'multicall', label: 'MultiCall' },
];

const PRESETS: { id: string; label: string; from: string; to: string }[] = [
  { id: 'working', label: '9 AM – 9 PM', from: DEFAULT_FROM, to: DEFAULT_TO },
  { id: 'day', label: 'Full day', from: '00:00:00', to: '23:59:59' },
  { id: 'night', label: 'Night · 00–06', from: '00:00:00', to: '05:59:59' },
  { id: 'morning', label: 'Morning · 06–12', from: '06:00:00', to: '11:59:59' },
  { id: 'business', label: 'Business · 09–18', from: '09:00:00', to: '17:59:59' },
  { id: 'afternoon', label: 'Afternoon · 12–18', from: '12:00:00', to: '17:59:59' },
  { id: 'evening', label: 'Evening · 18–24', from: '18:00:00', to: '23:59:59' },
];

/** What the filters set; everything else is fixed — minute by minute, no breakdown. */
interface Draft {
  date: string;
  service: PortService;
  service_providers: string[];
  time_from: string;
  time_to: string;
}

const draftOf = (r: PortRequest): Draft => ({
  date: r.date,
  service: r.service,
  service_providers: r.service_providers,
  time_from: r.time_from,
  time_to: r.time_to,
});
const sameDraft = (a: Draft, b: Draft) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Port Analyzer: how many ports were in use through one day — the +1 at each
 * call's start and -1 at its release, swept over the day. Choose the day,
 * service, providers and time, then Apply; the applied analysis is in the URL.
 */
export function PortAnalyzerPage() {
  const { data: status, isPending, error } = useCdrStatus();
  if (isPending) {
    return (
      <div className="flex items-center justify-center p-24">
        <Loader2 className="h-8 w-8 animate-spin text-[#50a6d5]" />
      </div>
    );
  }
  if (error || !status?.available || !status.cdr.date_max) {
    return (
      <div className="mx-auto mt-8 flex max-w-3xl items-start gap-3 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-900/20 dark:text-red-400">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <p>{error?.message ?? 'No CDR exports are readable — check CDR_LAKE_PATH in the backend .env.'}</p>
      </div>
    );
  }
  return <Analyzer minDate={status.cdr.date_min ?? null} maxDate={status.cdr.date_max} />;
}

function Analyzer({ minDate, maxDate }: { minDate: string | null; maxDate: string }) {
  const [params, setParams] = useSearchParams();
  // Minute by minute, the total only: "Hour wise" is folded from it in the chart.
  // Opens on yesterday, 9 AM to 9 PM, unless the URL says otherwise.
  const request: PortRequest = { ...requestFromParams(params, defaultDay(minDate, maxDate)), resolution: '1m', group_by: 'none' };
  // Minute wise unless the URL asks for hours.
  const view: PortView = params.get('view') === 'hour' ? 'hour' : 'minute';

  const apply = (draft: Draft) => {
    const next = paramsFromRequest({ ...request, ...draft });
    if (view !== 'minute') next.set('view', view);
    setParams(next);
  };
  const setView = (v: PortView) => {
    const next = new URLSearchParams(params);
    if (v === 'minute') next.delete('view');
    else next.set('view', v);
    setParams(next, { replace: true });
  };

  // The filters are a draft until Apply; a change to the applied analysis
  // (Apply, a zoom, Back) resets the draft to it.
  const applied = draftOf(request);
  const [draft, setDraft] = useState<Draft>(applied);
  const [synced, setSynced] = useState<Draft>(applied);
  if (!sameDraft(applied, synced)) {
    setSynced(applied);
    setDraft(applied);
  }
  const dirty = !sameDraft(draft, applied);
  const edit = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  const query = useQuery({
    queryKey: ['ports', request],
    queryFn: () => analyzePorts(request),
    placeholderData: (previous) => previous,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const result = query.data;
  const preset = PRESETS.find((p) => p.from === draft.time_from && p.to === draft.time_to);
  const appliedPreset = PRESETS.find((p) => p.from === request.time_from && p.to === request.time_to);

  // Full screen takes the filters with the chart: the whole working area,
  // over everything else, until Esc or the button again.
  const [full, setFull] = useState(false);
  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setFull(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [full]);

  const headerSlot = useHeaderSlot();
  const header =
    headerSlot &&
    createPortal(
      <div className="flex min-w-0 items-center gap-2">
        <Server className="h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
        <h1 className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">Port Analyzer</h1>
      </div>,
      headerSlot,
    );

  return (
    <div
      className={clsx(
        'vd-design',
        full
          ? 'fixed inset-3 z-[70] flex flex-col overflow-auto rounded-2xl bg-[#eef4fb] p-5 shadow-[0_24px_80px_rgba(15,23,42,0.35)] dark:bg-[#0f1729]'
          : 'mx-auto max-w-[1500px] p-8',
      )}
    >
      {header}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          apply(draft);
        }}
        className="mb-4 flex flex-wrap items-center gap-3"
      >
        <SingleDateSelector date={draft.date} onChange={(date) => edit({ date })} min={minDate} max={maxDate} />

        <Select
          label="Service"
          value={draft.service}
          onChange={(service) => edit({ service: service as PortService, service_providers: [] })}
          options={SERVICES}
        />

        <MultiSelect
          label="Provider"
          options={result?.options.service_providers ?? []}
          value={draft.service_providers}
          onChange={(service_providers) => edit({ service_providers })}
          placeholder="All"
        />

        <Select
          label="Time"
          value={preset?.id ?? 'custom'}
          onChange={(id) => {
            const p = PRESETS.find((x) => x.id === id);
            if (p) edit({ time_from: p.from, time_to: p.to });
          }}
          options={[...PRESETS, ...(preset ? [] : [{ id: 'custom', label: 'Custom' }])]}
        />
        <span className="flex items-center gap-1.5">
          <TimeInput value={draft.time_from} onChange={(time_from) => edit({ time_from })} label="From" />
          <span className="text-[#8a99ad]">–</span>
          <TimeInput value={draft.time_to} onChange={(time_to) => edit({ time_to })} label="To" />
        </span>

        <button
          type="submit"
          disabled={query.isFetching || (!dirty && !query.error)}
          className={clsx(
            'inline-flex h-10 items-center gap-2 rounded-xl px-5 text-[14px] font-semibold shadow-sm transition-colors',
            dirty
              ? 'bg-[#2563eb] text-white hover:bg-[#1d4ed8]'
              : 'bg-[#e8eef7] text-[#8a99ad] dark:bg-white/[0.06] dark:text-zinc-500',
            'disabled:cursor-not-allowed',
          )}
        >
          {query.isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          {query.isFetching ? 'Processing…' : 'Apply'}
        </button>
        {dirty && !query.isFetching && (
          <span className="flex items-center gap-1.5 text-[12px] text-[#b45309] dark:text-amber-300">
            <span className="h-1.5 w-1.5 rounded-full bg-[#f59e0b]" />
            Not applied yet
          </span>
        )}
      </form>

      {query.error && (
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-900/20 dark:text-red-400">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p className="break-words">{query.error.message}</p>
        </div>
      )}

      <PortActivity
        result={result}
        isFetching={query.isFetching}
        view={view}
        onView={setView}
        onZoom={(from, to) => apply({ ...applied, time_from: from, time_to: to })}
        zoomed={!appliedPreset}
        onResetZoom={() => apply({ ...applied, time_from: DEFAULT_FROM, time_to: DEFAULT_TO })}
        dateLabel={dayLabel(request.date)}
        full={full}
        onFull={setFull}
      />
    </div>
  );
}

// ── Controls ───────────────────────────────────────────────────────────────

/** A compact select with its label inside, on the left. */
function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { id: string; label: string }[];
}) {
  return (
    <label className="field-focus-within relative inline-flex h-9 items-center gap-2 rounded-lg border border-[#dfe7f1] bg-white pl-3 dark:border-white/[0.08] dark:bg-[#0e192c]">
      <span className="text-[11px] font-medium uppercase tracking-[0.4px] text-[#8a99ad]">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-full appearance-none bg-transparent pr-8 text-[13px] font-medium text-[#1f2b45] outline-none dark:text-zinc-100"
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 h-4 w-4 text-[#8a99ad]" />
    </label>
  );
}

/** HH:MM:SS; a partly typed time is not taken until it is complete. */
function TimeInput({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  const [text, setText] = useState(value);
  const [synced, setSynced] = useState(value);
  if (value !== synced) {
    setSynced(value);
    setText(value);
  }
  const take = (raw: string) => {
    const full = /^\d{2}:\d{2}$/.test(raw) ? `${raw}:00` : raw;
    if (/^\d{2}:\d{2}:\d{2}$/.test(full)) onChange(fromSeconds(toSeconds(full)));
  };
  return (
    <input
      type="time"
      step={1}
      aria-label={label}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        take(e.target.value);
      }}
      className="field-focus h-9 rounded-lg border border-[#dfe7f1] bg-white px-2 text-[13px] tabular-nums text-[#1f2b45] dark:border-white/[0.08] dark:bg-[#0e192c] dark:text-zinc-100 [&::-webkit-calendar-picker-indicator]:opacity-50"
    />
  );
}
