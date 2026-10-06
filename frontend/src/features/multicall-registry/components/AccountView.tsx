import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  AlertTriangle, ArrowLeft, CalendarClock, ChevronDown, ChevronLeft, ChevronRight,
  Filter, Globe2, Loader2, Mail, Phone, Users, X,
} from 'lucide-react';
import { multicallApi } from '../api';
import type { Profile, RegistrationMatch, SearchCriteria } from '../api';
import { dateLabel, focus, sourceLabel, surface } from '../lookup';
import { Avatar, Field, Hit, Kbd, StatusPill } from './shared';

interface AccountViewProps {
  accounts: RegistrationMatch[];
  index: number;
  criteria: SearchCriteria;
  onNavigate: (index: number) => void;
  onBack: () => void;
}

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
}

export function AccountView({ accounts, index, criteria, onNavigate, onBack }: AccountViewProps) {
  const account = accounts[index];
  const regNum = String(account.reg_num);
  const matchedRefs = useMemo(() => new Set(account.matched_profiles), [account]);

  const detail = useInfiniteQuery({
    queryKey: ['multicall', 'registration', regNum],
    queryFn: ({ pageParam }) => multicallApi.registration(regNum, pageParam),
    initialPageParam: 1,
    getNextPageParam: (page) => page.has_more ? page.page + 1 : undefined,
    staleTime: Infinity,
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const registration = detail.data?.pages[0]?.registration ?? account;
  const profiles = useMemo(() => detail.data?.pages.flatMap((page) => page.profiles) ?? [], [detail.data]);

  const [query, setQuery] = useState('');
  const [selection, setSelection] = useState<{ reg: string; ref: string } | null>(null);

  // A different account starts with a clean profile filter.
  const [filterFor, setFilterFor] = useState(regNum);
  if (filterFor !== regNum) {
    setFilterFor(regNum);
    setQuery('');
  }

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return profiles;
    return profiles.filter((profile) => [profile.profile_name, profile.profile_phone, profile.profile_email, profile.profile_ref_num, profile.conf_ref_num]
      .some((value) => value != null && String(value).toLowerCase().includes(needle)));
  }, [profiles, query]);

  // Until a profile is picked, open on the one the search pointed at.
  const chosenRef = selection?.reg === regNum ? selection.ref : null;
  const current = profiles.find((profile) => String(profile.profile_ref_num) === chosenRef)
    ?? profiles.find((profile) => matchedRefs.has(String(profile.profile_ref_num)))
    ?? profiles[0];
  const currentRef = current ? String(current.profile_ref_num) : null;

  function selectProfile(ref: string) {
    setSelection({ reg: regNum, ref });
  }

  const hasPrev = index > 0;
  const hasNext = index < accounts.length - 1;

  // ← → move between accounts, ↑ ↓ between profiles, Esc returns to results.
  const keyState = useRef({ visible, currentRef, index, hasPrev, hasNext });
  useEffect(() => {
    keyState.current = { visible, currentRef, index, hasPrev, hasNext };
  });
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.altKey || event.ctrlKey || event.metaKey || isTyping(event.target)) return;
      const state = keyState.current;
      if (event.key === 'ArrowLeft' && state.hasPrev) onNavigate(state.index - 1);
      else if (event.key === 'ArrowRight' && state.hasNext) onNavigate(state.index + 1);
      else if (event.key === 'Escape') onBack();
      else if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && state.visible.length) {
        event.preventDefault();
        const position = state.visible.findIndex((profile) => String(profile.profile_ref_num) === state.currentRef);
        const step = event.key === 'ArrowDown' ? 1 : -1;
        const next = state.visible[Math.min(state.visible.length - 1, Math.max(0, position + step))];
        const ref = String(next.profile_ref_num);
        setSelection({ reg: String(accounts[state.index].reg_num), ref });
        document.getElementById(`mc-profile-${ref}`)?.scrollIntoView({ block: 'nearest' });
      } else return;
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [accounts, onBack, onNavigate]);

  const loaded = profiles.length;
  const allLoaded = !detail.hasNextPage;

  return <div className="mc-rise space-y-4">
    {/* Navigation bar */}
    <div className={clsx(surface, 'flex flex-wrap items-center justify-between gap-3 px-3 py-2.5 sm:px-4')}>
      <button type="button" onClick={onBack} className={clsx('inline-flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm font-semibold text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800', focus)}>
        <ArrowLeft className="h-4 w-4" /> All results
      </button>
      <div className="flex items-center gap-2">
        <span className="hidden text-xs text-zinc-500 sm:inline dark:text-zinc-400">Account <span className="font-semibold tabular-nums text-zinc-900 dark:text-white">{index + 1}</span> of <span className="tabular-nums">{accounts.length}</span></span>
        <NavButton disabled={!hasPrev} onClick={() => onNavigate(index - 1)} label="Previous account" hint="←"><ChevronLeft className="h-4 w-4" /> <span className="hidden sm:inline">Prev</span></NavButton>
        <NavButton disabled={!hasNext} onClick={() => onNavigate(index + 1)} label="Next account" hint="→"><span className="hidden sm:inline">Next</span> <ChevronRight className="h-4 w-4" /></NavButton>
      </div>
    </div>

    <div className={clsx('grid items-start gap-4', accounts.length > 1 && '2xl:grid-cols-[260px_minmax(0,1fr)]')}>
      {accounts.length > 1 && <AccountRail accounts={accounts} index={index} onNavigate={onNavigate} />}

      <div className="min-w-0 space-y-4">
        {/* Account summary */}
        <section className={clsx(surface, 'overflow-hidden')} aria-label="Account">
          <div className="flex flex-col gap-5 p-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 items-center gap-4">
              <Avatar name={registration.name} size="lg" />
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-blue-700 dark:text-blue-400">Account · Reg #{regNum}</p>
                <h2 className="mt-1 truncate text-xl font-semibold tracking-tight text-zinc-900 dark:text-white">{registration.name || 'Unnamed account'}</h2>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 sm:min-w-[330px]">
              <Stat label="Profiles" value={account.profile_count} />
              <Stat label="Active" value={account.active_profile_count} tone="text-emerald-600 dark:text-emerald-400" />
              <Stat label="Inactive" value={account.profile_count - account.active_profile_count} tone="text-zinc-500 dark:text-zinc-400" />
            </div>
          </div>
          <dl className="grid gap-4 border-t border-zinc-100 bg-zinc-50/60 px-5 py-4 sm:grid-cols-2 xl:grid-cols-4 dark:border-zinc-800 dark:bg-zinc-900/20">
            <IconField icon={Phone} label="Phone"><Hit hit={!!registration.phone && criteria.phones.includes(registration.phone)}>{registration.phone}</Hit></IconField>
            <IconField icon={Mail} label="Email"><Hit hit={!!registration.email && criteria.emails.includes(registration.email.toLowerCase())}>{registration.email}</Hit></IconField>
            <IconField icon={Globe2} label="Registered via">{sourceLabel(registration.source)}</IconField>
            <IconField icon={CalendarClock} label="Last updated">{dateLabel(registration.updated_at)}</IconField>
          </dl>
        </section>

        {/* Profiles */}
        {detail.isError ? <div role="alert" className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-700/40 dark:bg-red-500/10 dark:text-red-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div><p>{detail.error.message}</p><button type="button" onClick={() => detail.refetch()} className={clsx('mt-2 rounded text-xs font-semibold underline', focus)}>Try again</button></div>
        </div>
        : detail.isPending ? <ProfilesSkeleton />
        : profiles.length === 0 ? <div className={clsx(surface, 'flex flex-col items-center px-6 py-14 text-center')}>
          <span className="rounded-2xl bg-zinc-100 p-3 text-zinc-400 dark:bg-zinc-800"><Users className="h-6 w-6" /></span>
          <p className="mt-3 text-sm font-semibold text-zinc-900 dark:text-white">No profiles yet</p>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">This account has not created any MultiCall profiles.</p>
        </div>
        : <div className="grid items-start gap-4 lg:grid-cols-[minmax(280px,380px)_minmax(0,1fr)]">
          <section className={clsx(surface, 'min-w-0 overflow-hidden')} aria-label="Profiles">
            <div className="space-y-3 border-b border-zinc-100 p-3 dark:border-zinc-800">
              <div className="flex items-center justify-between px-1">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-white"><Users className="h-4 w-4 text-blue-600 dark:text-blue-400" /> Profiles</h3>
                <span className="text-xs tabular-nums text-zinc-500">{allLoaded ? `${loaded}` : `${loaded} of ${account.profile_count} loaded`}</span>
              </div>
              {loaded > 5 && <label className="relative block">
                <span className="sr-only">Find a profile</span>
                <Filter className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name, phone, email or ref" autoComplete="off"
                  className={clsx('h-9 w-full rounded-lg border border-zinc-200 bg-white pl-8 pr-8 text-sm text-zinc-900 placeholder:text-zinc-400 dark:border-zinc-700 dark:bg-zinc-900/50 dark:text-white', focus)} />
                {query && <button type="button" onClick={() => setQuery('')} aria-label="Clear profile filter" className={clsx('absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200', focus)}><X className="h-3.5 w-3.5" /></button>}
              </label>}
            </div>
            <div className="max-h-[560px] overflow-y-auto scrollbar-subtle" role="listbox" aria-label="Profiles">
              {visible.length ? visible.map((profile) => {
                const ref = String(profile.profile_ref_num);
                return <ProfileRow key={ref} profile={profile} active={ref === currentRef} onClick={() => selectProfile(ref)} />;
              }) : <p className="px-5 py-10 text-center text-sm text-zinc-500">No loaded profile fits this filter.</p>}
            </div>
            {detail.hasNextPage && <div className="border-t border-zinc-100 p-2 text-center dark:border-zinc-800">
              <button type="button" disabled={detail.isFetchingNextPage} onClick={() => detail.fetchNextPage()}
                className={clsx('inline-flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-50 dark:text-blue-400 dark:hover:bg-blue-500/10', focus)}>
                {detail.isFetchingNextPage ? <Loader2 className="h-4 w-4 animate-spin" /> : <ChevronDown className="h-4 w-4" />} Load more profiles
              </button>
            </div>}
          </section>

          {current && <ProfileDetails profile={current} criteria={criteria} />}
        </div>}

        <p className="hidden items-center justify-center gap-3 text-[11px] text-zinc-500 lg:flex dark:text-zinc-400">
          <span className="flex items-center gap-1"><Kbd>←</Kbd><Kbd>→</Kbd> accounts</span>
          <span className="flex items-center gap-1"><Kbd>↑</Kbd><Kbd>↓</Kbd> profiles</span>
          <span className="flex items-center gap-1"><Kbd>Esc</Kbd> back to results</span>
        </p>
      </div>
    </div>
  </div>;
}

function NavButton({ disabled, onClick, label, hint, children }: { disabled: boolean; onClick: () => void; label: string; hint: string; children: ReactNode }) {
  return <button type="button" disabled={disabled} onClick={onClick} aria-label={label} title={`${label} (${hint})`}
    className={clsx('inline-flex h-9 items-center gap-1 rounded-lg border border-zinc-200 px-3 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800', focus)}>
    {children}
  </button>;
}

function AccountRail({ accounts, index, onNavigate }: { accounts: RegistrationMatch[]; index: number; onNavigate: (index: number) => void }) {
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[aria-current="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [index]);
  return <nav className={clsx(surface, 'hidden overflow-hidden 2xl:sticky 2xl:top-4 2xl:block')} aria-label="Accounts in these results">
    <p className="border-b border-zinc-100 px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">Search results · {accounts.length}</p>
    <div ref={listRef} className="max-h-[calc(100vh-260px)] overflow-y-auto p-1.5 scrollbar-subtle">
      {accounts.map((row, position) => {
        const active = position === index;
        return <button key={String(row.reg_num)} type="button" aria-current={active} onClick={() => onNavigate(position)}
          className={clsx('flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors', focus,
            active ? 'bg-blue-50 ring-1 ring-blue-200 dark:bg-blue-500/10 dark:ring-blue-500/30' : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/40')}>
          <Avatar name={row.name} size="sm" />
          <span className="min-w-0 flex-1">
            <span className={clsx('block truncate text-sm', active ? 'font-semibold text-blue-800 dark:text-blue-200' : 'font-medium text-zinc-900 dark:text-white')}>{row.name || 'Unnamed account'}</span>
            <span className="block text-[11px] tabular-nums text-zinc-500 dark:text-zinc-400">#{String(row.reg_num)} · {row.profile_count} profile{row.profile_count === 1 ? '' : 's'}</span>
          </span>
        </button>;
      })}
    </div>
  </nav>;
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return <div className="rounded-lg border border-zinc-100 px-3 py-2 text-center dark:border-zinc-800">
    <p className={clsx('text-xl font-semibold tabular-nums', tone ?? 'text-zinc-900 dark:text-white')}>{value}</p>
    <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{label}</p>
  </div>;
}

function IconField({ icon: Icon, label, children }: { icon: typeof Phone; label: string; children: ReactNode }) {
  return <div className="flex min-w-0 items-start gap-2.5">
    <Icon className="mt-0.5 h-4 w-4 shrink-0 text-zinc-400" />
    <Field label={label}>{children}</Field>
  </div>;
}

function ProfileRow({ profile, active, onClick }: { profile: Profile; active: boolean; onClick: () => void }) {
  const ref = String(profile.profile_ref_num);
  return <button type="button" id={`mc-profile-${ref}`} role="option" aria-selected={active} onClick={onClick}
    className={clsx('relative w-full border-b border-zinc-100 px-4 py-3 text-left transition-colors last:border-b-0 dark:border-zinc-800', focus,
      active ? 'bg-blue-50/80 dark:bg-blue-500/10' : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/40')}>
    {active && <span className="absolute inset-y-0 left-0 w-0.5 bg-blue-600" />}
    <div className="flex items-start justify-between gap-3">
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold text-zinc-900 dark:text-white">{profile.profile_name || `Profile #${ref}`}</span>
        <span className="mt-0.5 block truncate text-xs tabular-nums text-zinc-500 dark:text-zinc-400">#{ref}{profile.profile_phone ? ` · ${profile.profile_phone}` : ''}</span>
      </span>
      <ChevronRight className={clsx('mt-0.5 h-4 w-4 shrink-0', active ? 'text-blue-600 dark:text-blue-400' : 'text-zinc-300 dark:text-zinc-600')} />
    </div>
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      <StatusPill status={profile.status} />
      {profile.is_default === 1 && <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700 dark:bg-blue-500/10 dark:text-blue-300">Default</span>}
    </div>
  </button>;
}

function yesNo(value: number | null): string {
  return value === 1 ? 'Yes' : value === 0 ? 'No' : '—';
}

/**
 * A compact label → value sheet. Ten short facts read best as tight rows with
 * the value right beside its label, not spread across a wide card.
 */
function ProfileDetails({ profile, criteria }: { profile: Profile; criteria: SearchCriteria }) {
  const ref = String(profile.profile_ref_num);
  const phoneHit = !!profile.profile_phone && criteria.phones.includes(profile.profile_phone);
  const emailHit = !!profile.profile_email && criteria.emails.includes(profile.profile_email.toLowerCase());
  return <section key={ref} className={clsx(surface, 'mc-rise min-w-0 overflow-hidden lg:sticky lg:top-4')} aria-label="Profile details">
    <div className="flex items-center gap-2 border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
      <h3 className="min-w-0 truncate text-base font-semibold text-zinc-900 dark:text-white">{profile.profile_name || `Profile #${ref}`}</h3>
      <span className="shrink-0 text-xs tabular-nums text-zinc-500 dark:text-zinc-400">#{ref}</span>
      {profile.is_default === 1 && <span className="shrink-0 rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700 dark:bg-blue-500/10 dark:text-blue-300">Default</span>}
    </div>
    <dl className="grid px-4 py-1 text-sm xl:grid-cols-2 xl:gap-x-8">
      <DetailRow label="Status"><StatusPill status={profile.status} /></DetailRow>
      <DetailRow label="Account type">{profile.account_type === 1 ? 'Business' : profile.account_type === 2 ? 'Retail' : '—'}</DetailRow>
      <DetailRow label="Phone"><Hit hit={phoneHit}>{profile.profile_phone || '—'}</Hit></DetailRow>
      <DetailRow label="Email"><Hit hit={emailHit}>{profile.profile_email || '—'}</Hit></DetailRow>
      <DetailRow label="Conference ref">{profile.conf_ref_num ?? '—'}</DetailRow>
      <DetailRow label="Profile size">{profile.profile_size ?? '—'}</DetailRow>
      <DetailRow label="Chairperson PIN">{profile.chair_pin || '—'}</DetailRow>
      <DetailRow label="Participant PIN">{profile.participant_pin || '—'}</DetailRow>
      <DetailRow label="ISD allowed">{yesNo(profile.isd_allowed)}</DetailRow>
      <DetailRow label="Acknowledged">{yesNo(profile.ack_status)}</DetailRow>
      <DetailRow label="Added">{dateLabel(profile.added_at)}</DetailRow>
      <DetailRow label="Last updated">{dateLabel(profile.profile_updated_at)}</DetailRow>
    </dl>
  </section>;
}

function DetailRow({ label, title, children }: { label: string; title?: string; children: ReactNode }) {
  return <div className="flex min-w-0 items-center gap-3 border-b border-zinc-100 py-2 last:border-b-0 xl:[&:nth-last-child(2)]:border-b-0 dark:border-zinc-800/70">
    <dt className="w-32 shrink-0 text-xs text-zinc-500 dark:text-zinc-400" title={title}>{label}</dt>
    <dd className="min-w-0 truncate font-medium tabular-nums text-zinc-900 dark:text-white">{children}</dd>
  </div>;
}

function ProfilesSkeleton() {
  return <div className="grid gap-4 lg:grid-cols-[minmax(280px,380px)_minmax(0,1fr)]" aria-busy="true" aria-label="Loading profiles">
    <div className={clsx(surface, 'space-y-3 p-4')}>
      {Array.from({ length: 5 }, (_, i) => <div key={i} className="space-y-2 rounded-lg p-2"><div className="h-3.5 w-2/3 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800" /><div className="h-3 w-1/3 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800" /></div>)}
    </div>
    <div className={clsx(surface, 'space-y-4 p-5')}>
      <div className="h-5 w-1/3 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800" />
      <div className="grid grid-cols-2 gap-4">{Array.from({ length: 6 }, (_, i) => <div key={i} className="h-10 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800" />)}</div>
    </div>
  </div>;
}
