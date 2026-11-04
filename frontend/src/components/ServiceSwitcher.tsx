import { useState } from 'react';
import clsx from 'clsx';
import { Check, ChevronsUpDown } from 'lucide-react';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { SERVICES, SERVICE_ORDER } from './services';
import type { ServiceId } from './services';

/**
 * The sidebar's service switcher: which service's pages the sidebar lists
 * under it. A full-width control on the open sidebar; on the icon rail, the
 * service's icon, opening to the side.
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
            'flex items-center rounded-xl bg-white/[0.08] text-white ring-1 ring-white/15 transition-colors hover:bg-white/[0.14] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300',
            collapsed ? 'mx-auto h-10 w-10 justify-center' : 'w-full gap-2.5 px-2 py-2 text-left',
            open && 'bg-white/[0.14]',
          )}
        >
          <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white/15">
            <Icon className="h-4 w-4" />
          </span>
          {!collapsed && (
            <>
              <span className="min-w-0 flex-1">
                <span className="block text-[10px] font-semibold uppercase tracking-wider text-white/55">Service</span>
                <span className="block truncate text-sm font-medium leading-tight">{current.name}</span>
              </span>
              <ChevronsUpDown className="h-4 w-4 shrink-0 text-white/60" />
            </>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        side={collapsed ? 'right' : 'bottom'}
        align="start"
        sideOffset={8}
        className="w-[248px] border-white/10 bg-[#13213a] p-1.5 text-white shadow-[0_16px_40px_rgba(0,0,0,0.4)]"
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
                'flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors',
                id === value ? 'bg-white/[0.10]' : 'hover:bg-white/[0.06]',
              )}
            >
              <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/10">
                <OptionIcon className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-medium">{option.name}</span>
                <span className="block truncate text-[11px] text-white/55">{option.blurb}</span>
              </span>
              {id === value && <Check className="h-4 w-4 shrink-0 text-sky-300" />}
            </button>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}
