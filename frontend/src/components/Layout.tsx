import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { useUIStore, useAuthStore } from '../store';
import {
  Activity,
  ContactRound,
  LayoutGrid,
  LogOut,
  Megaphone,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Sparkles,
  Sun,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import clsx from 'clsx';
import { useEffect, useRef, useState } from 'react';
import { HeaderDateRange } from '../features/cdr-dashboard/components/HeaderDateRange';
import { HeaderCampaignDate } from '../features/campaign-metrics/components/HeaderCampaignDate';
import { HeaderSlotContext } from './HeaderSlot';
import { ContentPanelContext } from './ContentPanelSlot';
import { ConversationList } from '../features/ai-chat/components/ConversationList';

interface NavItem {
  label: string;
  path: string;
  icon: LucideIcon;
}

interface NavSection {
  title: string;
  items: NavItem[];
}

/**
 * The two views every service offers: Attempt Metrics is the per-service
 * analytics dashboard, Campaign Metrics the single-day account/provider/
 * location tables. MultiCall adds its registration lookup.
 */
const serviceItems = (service: 'voicedrop' | 'conference' | 'multicall'): NavItem[] => [
  { label: 'Attempt Metrics', path: `/analytics/${service}/attempt-metrics`, icon: Activity },
  { label: 'Campaign Metrics', path: `/analytics/${service}/campaign-metrics`, icon: Megaphone },
  ...(service === 'multicall'
    ? [{ label: 'Registration Lookup', path: '/analytics/multicall/registry', icon: ContactRound }]
    : []),
];

/**
 * Always-open, labelled groups: every destination is one click away and the
 * service it belongs to is the heading above it, so nothing needs expanding.
 */
const NAV: NavSection[] = [
  { title: 'Overview', items: [{ label: 'All Services', path: '/analytics/all/attempt-metrics', icon: LayoutGrid }] },
  { title: 'Voicedrop', items: serviceItems('voicedrop') },
  { title: 'Conference', items: serviceItems('conference') },
  { title: 'MultiCall', items: serviceItems('multicall') },
];
// The assistant is deliberately not a nav entry: the floating button in the
// corner is its way in, and two controls for one destination in the same
// column is one too many.

/**
 * How long the content panel takes to collapse back to the sign-in card, and
 * therefore how long the route is held open after Logout is pressed. Matches
 * Login's EXPAND_MS so the two halves of the journey run at the same speed —
 * and, as there, the CSS duration and the timeout have to agree or the route
 * changes mid-flight and the transition simply disappears.
 */
const COLLAPSE_MS = 550;

/**
 * Where the panel's left edge collapses to: 40% of the viewport, which is
 * where the sign-in card's own left edge sits. The padding is what moves, so
 * the figure is that mark less the sidebar the panel is already offset by —
 * w-64 open, w-20 collapsed.
 */
const COLLAPSE_PADDING = {
  open: 'lg:pl-[calc(40vw-256px)]',
  collapsed: 'lg:pl-[calc(40vw-80px)]',
};

function NavLink({ item, section, active, collapsed }: { item: NavItem; section: string; active: boolean; collapsed: boolean }) {
  // Three services share "Attempt Metrics", so the rail names the service too.
  const railLabel = `${section} · ${item.label}`;
  return (
    <Link
      to={item.path}
      aria-current={active ? 'page' : undefined}
      // On the rail the label is gone, so it moves to the tooltip and the
      // accessible name.
      title={collapsed ? railLabel : undefined}
      aria-label={collapsed ? railLabel : undefined}
      className={clsx(
        'relative flex items-center gap-3 rounded-xl py-2.5 text-sm font-medium transition-colors',
        collapsed ? 'justify-center px-0' : 'px-3',
        // Pure white ink either way: the sidebar scrim (see .app-sidebar-scrim)
        // is what buys white its contrast on the cyan ground, with none to spare.
        active ? 'bg-white/25 text-white ring-1 ring-white/30 shadow-sm' : 'text-white hover:bg-white/15',
      )}
    >
      {/* The marker sits on the sidebar's own left edge, outside the pill. */}
      {active && (
        <span aria-hidden="true" className="absolute -left-3 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-r-full bg-primary" />
      )}
      <item.icon className="h-5 w-5 shrink-0" />
      {!collapsed && <span className="whitespace-nowrap">{item.label}</span>}
    </Link>
  );
}

/** "admin" -> "AD", "mukesh kumar" -> "MK". */
function initials(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/[\s._-]+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : parts[0].slice(0, 2)).toUpperCase();
}

export function Layout() {
  const { theme, toggleTheme, isSidebarCollapsed, toggleSidebar } = useUIStore();
  const { username, aiPermission, logout } = useAuthStore();
  const location = useLocation();
  const navigate = useNavigate();
  // A callback ref rather than useRef: the outlet below needs this node as a
  // *value* to portal into, so it has to survive a render, and a plain ref
  // would still be null on the render the children mount in.
  const [headerSlot, setHeaderSlot] = useState<HTMLDivElement | null>(null);
  // Same reasoning for the panel itself: page-owned overlays portal into it so
  // they centre on the card rather than on the viewport (see ContentPanelSlot).
  const [contentPanel, setContentPanel] = useState<HTMLDivElement | null>(null);
  /** Set the moment Logout is pressed: the panel is collapsing and the route is about to change. */
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const collapseTimer = useRef<number | undefined>(undefined);
  /** The corner button's opening/closing circle — null when nothing is moving. */

  useEffect(() => () => window.clearTimeout(collapseTimer.current), []);

  // The only thing that applies the theme once the app is mounted — the store
  // sets the value, this puts it on the document. Runs on mount too, so the
  // value restored from localStorage lands here without a toggle.
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  const isActivePath = (path: string) =>
    location.pathname === path || location.pathname.startsWith(`${path}/`);

  /** The chat route is the one page with no date control of its own. */
  const isAiChat = location.pathname.startsWith('/assistant');
  const isMulticallRegistry = location.pathname.startsWith('/analytics/multicall/registry');

  // Where "Analytics" goes back to. Remembering the page the chat was opened
  // from means the round trip returns you to the dashboard you were reading,
  // not to a default one you then have to navigate away from.
  const lastAnalyticsPath = useRef('/analytics/all/attempt-metrics');
  if (!isAiChat) lastAnalyticsPath.current = location.pathname;

  /**
   * Sign-in run backwards.
   *
   * The panel shrinks from its own footprint to the 40% mark the sign-in card
   * occupies while the sidebar fades out, and only then does the route change
   * — so the card that appears is the panel you were just looking at, at the
   * same size and in the same place.
   *
   * The store write waits for the same reason it does on the way in: clearing
   * auth now would send RequireAuth straight to /login and cut the animation.
   * `logout` now also destroys the session server-side, so the delay is the
   * animation's, not the request's — it is awaited inside the timeout rather
   * than before it.
   */
  const handleLogout = () => {
    setIsLoggingOut(true);
    collapseTimer.current = window.setTimeout(() => {
      void logout().finally(() => navigate('/login', { replace: true }));
    }, COLLAPSE_MS);
  };

  return (
    // The ground runs under the sidebar *and* the gutter, so the margin around
    // the content panel reads as a continuation of the sidebar rather than as a
    // separate surface — one field of colour with the panel inset into it.
    //
    // Its texture (see .app-ground) is a flat brand fill with a diagonal sheen
    // and a halftone dot grid over it: cyan #00a3e0 in light, indigo #21257a in
    // dark. The fill stays flat underneath because any gradient spanning the
    // whole field would drift away from itself between the sidebar and the far
    // edge of the gutter, putting a seam exactly where the two are continuous.
    <div className="app-ground flex h-screen w-full overflow-hidden font-sans text-zinc-900 dark:text-zinc-100">

      {/* Left Sidebar — flush to the edge, full height; w-64, or a w-20 icon
          rail when collapsed. No fill
          of its own: it is the ground showing through, plus a scrim that fades
          out by its right edge to buy the nav text contrast without drawing a
          line between the sidebar and the gutter. On logout it fades out the
          way the sign-in page fades its own left region. */}
      <aside
        className={clsx(
          'app-sidebar-scrim flex shrink-0 flex-col overflow-hidden z-20',
          isSidebarCollapsed ? 'w-20' : 'w-64',
          isLoggingOut && 'opacity-0 pointer-events-none',
        )}
        // Width for the collapse, opacity for the logout fade — each at its own
        // speed, written out so neither is left to stylesheet order.
        style={{ transitionProperty: 'width, opacity', transitionDuration: '300ms, 500ms' }}
      >
        {/* Logo, with the collapse control at the row's right end. Collapsed,
            only the tile is left; the way back out is the expand button at the
            top left of the header. */}
        <div className={clsx('flex h-[72px] shrink-0 items-center', isSidebarCollapsed ? 'justify-center' : 'gap-2 pl-6 pr-3')}>
          <Link to="/" title={isSidebarCollapsed ? 'DSNL Analytics' : undefined} className="group flex min-w-0 items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white transition-opacity group-hover:opacity-90">
              <img src="/DSNL.png" alt="DSNL" className="h-full w-full object-cover" />
            </div>
            {!isSidebarCollapsed && (
              <div className="flex min-w-0 flex-col whitespace-nowrap leading-tight">
                <span className="text-base font-semibold tracking-tight text-white">DSNL Analytics</span>
                <span className="text-[11px] font-medium text-white/70">by DSNL</span>
              </div>
            )}
          </Link>
          {!isSidebarCollapsed && (
            <button
              type="button"
              onClick={toggleSidebar}
              aria-label="Collapse sidebar"
              title="Collapse sidebar"
              className="ml-auto shrink-0 rounded-lg p-2 text-white/80 transition-colors hover:bg-white/15 hover:text-white"
            >
              <PanelLeftClose className="h-5 w-5" />
            </button>
          )}
        </div>

        {/* Analytics | Chat — which side of the app is open. It replaces the
            floating corner button: a switch you can see, where navigation
            already lives, rather than a round icon that had to be learned. */}
        {aiPermission && (
          isSidebarCollapsed ? (
            <Link
              to={isAiChat ? lastAnalyticsPath.current : '/assistant'}
              title={isAiChat ? 'Analytics' : 'Chat'}
              aria-label={isAiChat ? 'Switch to Analytics' : 'Switch to Chat'}
              className="mx-auto mb-2 flex h-9 w-9 items-center justify-center rounded-xl bg-white/15 text-white transition-colors hover:bg-white/25"
            >
              {isAiChat ? <LayoutGrid className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
            </Link>
          ) : (
            <div className="mx-3 mb-2 flex shrink-0 rounded-xl bg-white/15 p-1" role="tablist" aria-label="Analytics or Chat">
              {[
                { label: 'Analytics', to: lastAnalyticsPath.current, active: !isAiChat },
                { label: 'Chat', to: '/assistant', active: isAiChat },
              ].map((tab) => (
                <Link
                  key={tab.label}
                  to={tab.to}
                  role="tab"
                  aria-selected={tab.active}
                  className={clsx(
                    'flex-1 rounded-lg py-1.5 text-center text-sm font-medium transition-colors',
                    tab.active ? 'bg-white text-zinc-900 shadow-sm' : 'text-white/85 hover:text-white',
                  )}
                >
                  {tab.label}
                </Link>
              ))}
            </div>
          )
        )}

        {/* overflow-x-hidden: the labels come back before the width transition
            finishes, which would otherwise flash a horizontal scrollbar. */}
        <div className={clsx('flex min-h-0 flex-1 flex-col', !isAiChat && 'overflow-y-auto overflow-x-hidden [scrollbar-width:thin]')}>
          {/* While the chat is open the same column lists conversations
              instead of analytics destinations. The chat list scrolls itself so
              "New chat" stays put while threads move under it. */}
          {isAiChat ? (
            <ConversationList isCollapsed={isSidebarCollapsed} />
          ) : (
            <nav className="space-y-5 px-3 py-4" aria-label="Analytics">
              {NAV.map((section) => (
                <div key={section.title} className="space-y-1">
                  {/* On the rail a short rule stands in for the section name. */}
                  {isSidebarCollapsed ? (
                    <div aria-hidden="true" className="mx-auto mb-2 h-px w-8 bg-white/25" />
                  ) : (
                    <div className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-white/55">
                      {section.title}
                    </div>
                  )}
                  {section.items.map((item) => (
                    <NavLink
                      key={item.path}
                      item={item}
                      section={section.title}
                      active={isActivePath(item.path)}
                      collapsed={isSidebarCollapsed}
                    />
                  ))}
                </div>
              ))}
            </nav>
          )}
        </div>

        {/* Footer: identity + sign out. Stacked on the rail. */}
        <div className={clsx('flex shrink-0 items-center gap-3 border-t border-white/10 p-3', isSidebarCollapsed ? 'flex-col' : 'px-4')}>
          <div
            title={isSidebarCollapsed && username ? `Signed in as ${username}` : undefined}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-white"
          >
            {initials(username)}
          </div>
          {!isSidebarCollapsed && (
            <div className="min-w-0 flex-1 leading-tight">
              <div className="truncate text-sm font-semibold text-white">{username}</div>
              <div className="text-[11px] text-white/65">Signed in</div>
            </div>
          )}
          <button
            type="button"
            onClick={handleLogout}
            disabled={isLoggingOut}
            title="Logout"
            aria-label="Logout"
            className="shrink-0 rounded-lg p-2 text-white/80 transition-colors hover:bg-white/15 hover:text-white"
          >
            <LogOut className="h-5 w-5" />
          </button>
        </div>
      </aside>

      {/* Main content — the one floating panel. The gutter lives on this
          wrapper rather than on the row, so the sidebar stays flush left while
          the panel still floats clear of all four edges.

          Opaque rather than glass, and it keeps the same zinc scroll surface it
          always had: every card inside it is white, and those need a slightly
          darker ground to read as raised. `overflow-hidden` is what makes the
          corners actually clip the header and the scroll area. */}
      <div
        className={clsx(
          'flex-1 min-w-0 p-3 transition-[padding] ease-in-out',
          // On the way out the left padding — and only the left padding —
          // grows until the panel's left edge is on the sign-in card's 40%
          // mark. Padding rather than a transform, so the panel genuinely
          // reflows to the smaller box and its contents settle where they will
          // be on the other side, instead of the whole thing being squashed.
          // lg-only, matching the card: below that the card is full width and
          // there is no horizontal move to make.
          isLoggingOut && (isSidebarCollapsed ? COLLAPSE_PADDING.collapsed : COLLAPSE_PADDING.open),
        )}
        style={{ transitionDuration: `${COLLAPSE_MS}ms` }}
      >
      {/* No border: against the brand blue the panel edge is already a hard
          value change, and a light hairline there would read as a halo. */}
      {/* `relative` is load-bearing: it is what makes this card the containing
          block for the overlays pages portal in, so they cover the panel and
          nothing outside it. */}
      <div
        ref={setContentPanel}
        className="relative h-full flex flex-col rounded-2xl overflow-hidden
                   shadow-lg shadow-black/10
                   bg-zinc-50 dark:bg-canvas-dark"
      >
        {/* The date control lives here rather than on the page: it applies to
            every route in its module, so it belongs above the outlet. Campaign
            Metrics gets its own single-date control instead of the analytics
            date range, since the two modules read the lake differently (one day
            vs a range) and hold their selections in separate stores. */}
        {/* The surface itself stays put while its contents fade, which is the
            sign-in card's exit in reverse — there the card's shell held while
            the form faded as it grew. A dashboard squeezed into a 60%-wide box
            on the way out would read as a layout bug, not as a transition. */}
        <header
          className={clsx(
            `h-[72px] flex items-center gap-5 px-6 shrink-0 z-10
             bg-white dark:bg-surface-dark border-b border-zinc-200 dark:border-zinc-800/60
             transition-opacity duration-300`,
            isLoggingOut && 'opacity-0 pointer-events-none',
          )}
        >
          {/* Page-owned controls land here — the per-service filters. Layout
              only provides the space; what goes in it is decided by whichever
              page is mounted (see HeaderSlot). It takes the free width so the
              date control and theme toggle stay pinned right.

              `overflow-x-auto` with no visible scrollbar: on the six-field
              services this row can outrun a narrow window, and a scrollbar
              inside a 72px band would eat the inputs' bottom edge.

              The vertical padding is load-bearing. Setting overflow on one axis
              makes the other one clip too (it cannot stay `visible`), so a
              focus ring — which paints outside the input's border box — was
              being sliced off top and bottom. The padding gives it somewhere to
              land inside the scroll box. */}
          {/* Expand lives here, top left of the header: on the rail there is no
              room for it beside the logo. Collapse is in the sidebar itself. */}
          {isSidebarCollapsed && (
            <button
              type="button"
              onClick={toggleSidebar}
              aria-label="Expand sidebar"
              title="Expand sidebar"
              className="-ml-2 -mr-2 p-2 rounded-lg shrink-0 text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:text-zinc-200 dark:hover:bg-zinc-800/50 transition-colors"
            >
              <PanelLeftOpen className="w-5 h-5" />
            </button>
          )}
          <div
            ref={setHeaderSlot}
            className="flex-1 min-w-0 flex items-center py-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          />
          {/* The AI chat carries no date control: the range is part of the
              question, and the assistant names the one it used in its answer.
              A picker here would imply it narrowed the query, which it did not. */}
          {isAiChat || isMulticallRegistry ? null : location.pathname.endsWith('/campaign-metrics') ? (
            <HeaderCampaignDate />
          ) : (
            <HeaderDateRange />
          )}
          <button
            onClick={toggleTheme}
            title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            className="p-2 rounded-lg shrink-0 text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:text-zinc-200 dark:hover:bg-zinc-800/50 transition-colors"
          >
            {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
          </button>
        </header>

        {/* Main Content Area */}
        <main
          className={clsx(
            'flex-1 relative transition-opacity duration-300',
            isAiChat ? 'flex flex-col overflow-hidden' : 'overflow-y-auto',
            isLoggingOut && 'opacity-0 pointer-events-none',
          )}
        >
          <HeaderSlotContext.Provider value={headerSlot}>
            <ContentPanelContext.Provider value={contentPanel}>
              <Outlet />
            </ContentPanelContext.Provider>
          </HeaderSlotContext.Provider>
        </main>
      </div>
      </div>

    </div>
  );
}
