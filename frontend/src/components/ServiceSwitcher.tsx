import { useState } from 'react';
import clsx from 'clsx';
import { Check, ChevronsUpDown } from 'lucide-react';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { SERVICES, SERVICE_ORDER } from './services';
import type { ServiceId } from './services';

/** The tile's light-theme colours only: the switcher is white in both themes. */
const lightTile = (tile: string) =>
  tile
    .split(' ')
    .filter((c) => !c.startsWith('dark:'))
    .join(' ');

/**
 * The sidebar's service switcher: which service's pages the sidebar lists
 * under it. A full-width control on the open sidebar; on the icon rail, the
 * service's icon, opening to the side. White in both themes — on the navy
 * sidebar it has to read at a glance as the one control there is.
 */
export function ServiceSwitcher({
  value,
  onChange,
  collapsed,
}: {
  value: ServiceId;
  onChange: (service: ServiceId) => void;
  collapsed: boolean;
}) {
  const [open, setOpen] = useState(false);
  const current = SERVICES[value];
  const Icon = current.icon;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Service: ${current.name}. Change service`}
          title={collapsed ? `${current.name} — change service` : undefined}
          className={clsx(
            'flex items-center rounded-xl bg-white text-[#0f172a] shadow-[0_2px_8px_rgba(0,0,0,0.18)] transition-colors hover:bg-[#f3f7fc] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300',
            collapsed ? 'mx-auto h-10 w-10 justify-center' : 'w-full gap-2.5 px-2 py-2 text-left',
            open && 'ring-2 ring-sky-300',
          )}
        >
          <span className={clsx('inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg', lightTile(current.tile))}>
            <Icon className="h-4 w-4" />
          </span>
          {!collapsed && (
            <>
              <span className="min-w-0 flex-1">
                <span className="block text-[10px] font-semibold uppercase tracking-wider text-[#6b7a90]">Service</span>
                <span className="block truncate text-sm font-semibold leading-tight">{current.name}</span>
              </span>
              <ChevronsUpDown className="h-4 w-4 shrink-0 text-[#6b7a90]" />
            </>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        side={collapsed ? 'right' : 'bottom'}
        align="start"
        sideOffset={8}
        className="w-[248px] border-[#e4eaf2] bg-white p-1.5 text-[#0f172a] shadow-[0_16px_40px_rgba(0,0,0,0.3)] dark:border-[#e4eaf2] dark:bg-white dark:text-[#0f172a]"
      >
        {SERVICE_ORDER.map((id) => {
          const option = SERVICES[id];
          const OptionIcon = option.icon;
          return (
            <button
              key={id}
              type="button"
              onClick={() => {
                onChange(id);
                setOpen(false);
              }}
              className={clsx(
                'flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#93b8f3]',
                id === value ? 'bg-[#eef4fd]' : 'hover:bg-[#f5f8fc]',
              )}
            >
              <span className={clsx('inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', lightTile(option.tile))}>
                <OptionIcon className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-medium">{option.name}</span>
                <span className="block truncate text-[11px] text-[#6b7a90]">{option.blurb}</span>
              </span>
              {id === value && <Check className="h-4 w-4 shrink-0 text-[#2563eb]" />}
            </button>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}
