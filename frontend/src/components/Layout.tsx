import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { useUIStore, useAuthStore } from '../store';
import {
  Activity,
  ChevronLeft,
  ChevronRight,
  LayoutGrid,
  LogOut,
  Megaphone,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  PhoneCall,
  PhoneForwarded,
  Sparkles,
  Sun,
  Users,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import EqualizerIcon from '@mui/icons-material/Equalizer';
import clsx from 'clsx';
import { useEffect, useRef, useState } from 'react';
import { HeaderDateRange } from '../features/cdr-dashboard/components/HeaderDateRange';
import { HeaderCampaignDate } from '../features/campaign-metrics/components/HeaderCampaignDate';
import { HeaderSlotContext } from './HeaderSlot';
import { ContentPanelContext } from './ContentPanelSlot';
import { ConversationList } from '../features/ai-chat/components/ConversationList';

interface NavNode {
  label: string;
  path: string;
  icon?: LucideIcon;
  children?: NavNode[];
}

/**
 * The two views every service offers, as its children.
 *
 * Attempt Metrics is the existing per-service analytics dashboard and Campaign
 * Metrics the single-day account/provider/location tables — the same two routes
 * as before, regrouped so a service is the thing you pick first and the view
 * second. A parent's own path is its Attempt Metrics child, so clicking the
 * service name lands on that view rather than on nothing.
 */
const serviceChildren = (service: 'voicedrop' | 'conference' | 'multicall'): NavNode[] => [
  { label: 'Attempt Metrics', path: `/analytics/${service}`, icon: Activity },
  { label: 'Campaign Metrics', path: `/campaign-metrics/${service}`, icon: Megaphone },
];

const NAV: NavNode[] = [
  { label: 'All', path: '/analytics/all', icon: LayoutGrid },
  {
    label: 'Voicedrop',
    path: '/analytics/voicedrop',
    icon: PhoneCall,
    children: serviceChildren('voicedrop'),
  },
  {
    label: 'Conference',
    path: '/analytics/conference',
    icon: Users,
    children: serviceChildren('conference'),
  },
  {
    label: 'Multicall',
    path: '/analytics/multicall',
    icon: PhoneForwarded,
    children: serviceChildren('multicall'),
  },
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

/** Every path a node's own link should read as "current" for, itself included. */
function collectPaths(node: NavNode, into: string[] = []): string[] {
  into.push(node.path);
  for (const child of node.children ?? []) collectPaths(child, into);
  return into;
}

interface NavRowProps {
  node: NavNode;
  depth: number;
  isCollapsed: boolean;
  openSections: Set<string>;
  toggle: (label: string) => void;
  isActivePath: (path: string) => boolean;
}

function NavRow({ node, depth, isCollapsed, openSections, toggle, isActivePath }: NavRowProps) {
  const hasChildren = !!node.children?.length;
  const isOpen = openSections.has(node.label);
  const isChild = depth > 0;
  // A parent reads as active whenever the current route is anywhere under it,
  // not only on its own exact path — so Voicedrop stays lit while you are on
  // either of its two views.
  const isActive = collectPaths(node).some(isActivePath);

  // A row with children is a section header, not a destination: it only opens
  // and closes, and its views are reached through the children. The exception
  // is the collapsed rail, where there is nowhere for children to appear — so
  // there it falls back to navigating to the service's own page.
  const isSectionToggle = hasChildren && !isCollapsed;

  // Two levels, two ways of reading as active, so both can be lit at once
  // without competing: a parent takes the filled pill, a child takes a bar down
  // its left edge. If children wore the pill too, an open service would show
  // two identical highlights and neither would say which level it meant.
  const rowClass = clsx(
    'relative w-full flex items-center gap-3 rounded-xl text-sm transition-colors min-w-0 text-left',
    isCollapsed ? 'justify-center px-0' : 'px-3',
    isChild ? 'py-2' : 'py-2.5',
    isChild
      ? isActive
        ? 'text-white font-semibold bg-white/10'
        : 'text-white/70 hover:text-white hover:bg-white/10 font-medium'
      : isActive
        ? 'bg-white/25 text-white border border-white/30 shadow-sm font-medium'
        // Pure white, not a tint. White on the bare cyan ground is only 2.87:1;
        // the sidebar's scrim (see .app-sidebar-scrim) lifts that to 4.54:1,
        // which is the whole contrast budget — there is none spare to spend on
        // softening the ink itself.
        : 'text-white hover:bg-white/15 border border-transparent font-medium',
  );

  const rowInner = (
    <>
      {isChild && isActive && !isCollapsed && (
        <span
          aria-hidden="true"
          className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-[3px] rounded-r-full bg-white"
        />
      )}
      {node.icon ? (
        <node.icon className={clsx('shrink-0', isChild ? 'w-4 h-4' : 'w-5 h-5')} />
      ) : (
        !isCollapsed && <span className="w-5 h-5 shrink-0" />
      )}
      {!isCollapsed && <span className="whitespace-nowrap truncate">{node.label}</span>}
    </>
  );

  return (
    <div>
      {isSectionToggle ? (
        <button
          type="button"
          onClick={() => toggle(node.label)}
          aria-expanded={isOpen}
          className={rowClass}
        >
          {rowInner}
        </button>
      ) : (
        <Link to={node.path} title={isCollapsed ? node.label : undefined} className={rowClass}>
          {rowInner}
        </Link>
      )}

      {/* The indent lives on this container, not as padding inside each child.
          That way the child's whole box — its background wash and the active
          bar down its left edge — starts inset from the parent's left edge, so
          it reads as nested even before the indicator is lit. Padding inside
          the row would have left the box full-width and only moved the text. */}
      {hasChildren && !isCollapsed && isOpen && (
        <div className="mt-1 space-y-1 ml-5">
          {node.children!.map((child) => (
            <NavRow
              key={child.path}
              node={child}
              depth={depth + 1}
              isCollapsed={isCollapsed}
              openSections={openSections}
              toggle={toggle}
              isActivePath={isActivePath}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function Layout() {
  const { theme, toggleTheme } = useUIStore();
  const { username, logout } = useAuthStore();
  const location = useLocation();
  const navigate = useNavigate();
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [openSections, setOpenSections] = useState<Set<string>>(() => new Set());
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

  useEffect(() => () => window.clearTimeout(collapseTimer.current), []);

  // Ensure theme is applied to document
  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [theme]);

  const isActivePath = (path: string) =>
    location.pathname === path || location.pathname.startsWith(`${path}/`);

  /** The chat route is the one page with no date control of its own. */
  const isAiChat = location.pathname.startsWith('/ai-chat');

  // Where "Analytics" goes back to. Remembering the page the chat was opened
  // from means the round trip returns you to the dashboard you were reading,
  // not to a default one you then have to navigate away from.
  const lastAnalyticsPath = useRef('/analytics/all');
  if (!isAiChat) lastAnalyticsPath.current = location.pathname;

  // Auto-expand whichever sections the current route is inside — landing
  // straight on /analytics/voicedrop/blast-details (a refresh, a bookmark)
  // should open Analytics and Voicedrop without the user hunting for them.
  // A union, not a replace, so a manual collapse elsewhere on the tree isn't
  // fought on every navigation.
  useEffect(() => {
    setOpenSections((prev) => {
      const next = new Set(prev);
      const visit = (node: NavNode) => {
        if (node.children?.some((child) => collectPaths(child).some(isActivePath))) {
          next.add(node.label);
        }
        node.children?.forEach(visit);
      };
      NAV.forEach(visit);
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  const toggleSection = (label: string) =>
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });

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
   */
  const handleLogout = () => {
    setIsLoggingOut(true);
    collapseTimer.current = window.setTimeout(() => {
      logout();
      navigate('/login', { replace: true });
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

      {/* Left Sidebar — flush to the edge, full height, solid brand blue */}
      <aside className={clsx(
        // width-only transition: the content column beside this is a separate
        // flex-1 sibling with no width transition of its own, so it never
        // animates — it just occupies whatever space this leaves it, frame by
        // frame, as this alone resizes.
        // No fill of its own — it is the ground showing through, plus a scrim
        // that fades out by its right edge to buy the nav text contrast
        // without drawing a line between the sidebar and the gutter.
        "app-sidebar-scrim flex flex-col shrink-0 z-20",
        isSidebarCollapsed ? "w-20" : "w-64",
        // Scrim and all on the way out, exactly as the sign-in page fades its
        // own left region — what is left behind is the bare ground, which is
        // the same field on both routes.
        isLoggingOut && "opacity-0 pointer-events-none"
      )}
      // Two properties, two durations: the collapse toggle stays at 300ms while
      // the logout fade runs at the 500ms the sign-in page uses for the same
      // region. Written out rather than stacked as duration utilities, which
      // would have left the winner to be decided by stylesheet order.
      style={{ transitionProperty: 'width, opacity', transitionDuration: '300ms, 500ms' }}>
        {/* Logo. No divider under it — the panel is one unbroken field of
            brand blue, and spacing alone separates the regions. */}
        <div className={clsx(
          "h-16 flex items-center gap-2 shrink-0",
          isSidebarCollapsed ? "justify-center px-3" : "px-4"
        )}>
          {/* Still always mounted, and still only its width and opacity
              animate — collapsing the whole brand block rather than unmounting
              it is what keeps the tile and the text shrinking together instead
              of the text popping out a frame ahead of the panel. */}
          <Link
            to="/"
            className={clsx(
              "flex items-center gap-3 group overflow-hidden min-w-0 transition-[max-width,opacity] duration-300",
              isSidebarCollapsed
                ? "max-w-0 opacity-0 pointer-events-none"
                : "max-w-[200px] opacity-100 flex-1",
            )}
          >
            <div className="w-8 h-8 rounded-md bg-white/15 flex items-center justify-center border border-white/25 group-hover:bg-white/25 transition-colors shrink-0">
              <EqualizerIcon className="text-white" sx={{ fontSize: 18 }} />
            </div>
            {/* Always mounted — only its width/opacity animate. Conditionally
                unmounting this on collapse made it vanish the instant state
                flipped, a frame before the sidebar itself had even started
                shrinking; this keeps the text and the box collapsing together
                instead of the text popping out ahead of it. */}
            <span
              className={clsx(
                "text-lg font-semibold tracking-tight text-white whitespace-nowrap overflow-hidden transition-[max-width,opacity] duration-300",
                isSidebarCollapsed ? "max-w-0 opacity-0" : "max-w-[160px] opacity-100",
              )}
            >
              DSNL Analytics
            </span>
          </Link>

          {/* The collapse control, beside the title. When collapsed the brand
              block above has shrunk to zero width, so this is the only thing
              left in the row and centres itself — which also guarantees the
              control that expands the panel is always the visible one. */}
          <button
            type="button"
            onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
            aria-label={isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="p-2 rounded-lg shrink-0 text-white/80 hover:text-white hover:bg-white/15 transition-colors"
          >
            {isSidebarCollapsed ? (
              <PanelLeftOpen className="w-5 h-5" />
            ) : (
              <PanelLeftClose className="w-5 h-5" />
            )}
          </button>
        </div>

        {/* Nav, then the empty space below it — which is itself a collapse
            control, alongside the explicit icon beside the title. A real
            <button> rather than a click handler on a div, so it is reachable by
            Tab and operable with Enter/Space; the hint only surfaces on
            hover/focus, which is what keeps the column clean. */}
        <div
          className={clsx(
            'flex-1 flex flex-col min-h-0',
            // In chat mode the list scrolls itself, so that "New chat" and the
            // section heading stay put while the threads move under them.
            // Scrolling here instead would carry the whole column away.
            !isAiChat && 'overflow-y-auto',
          )}
        >
          {/* Same column, same styling vocabulary — while the chat is open it
              lists conversations instead of analytics destinations, which is
              what that column is for on that screen. */}
          {isAiChat ? (
            <ConversationList isCollapsed={isSidebarCollapsed} />
          ) : (
            <nav className="py-6 px-3 space-y-1">
              {NAV.map((node) => (
                <NavRow
                  key={node.path}
                  node={node}
                  depth={0}
                  isCollapsed={isSidebarCollapsed}
                  openSections={openSections}
                  toggle={toggleSection}
                  isActivePath={isActivePath}
                />
              ))}
            </nav>
          )}

          {/* Only in analytics mode: there the nav leaves empty space below it,
              which this turns into a collapse target. The conversation list
              fills its column and leaves none, so this would be squeezed to
              nothing — the explicit control beside the title still covers it. */}
          <button
            type="button"
            hidden={isAiChat}
            onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
            aria-label={isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className={clsx(
              'flex-1 min-h-[72px] w-full group flex items-start justify-center pt-2 cursor-pointer focus:outline-none',
              isAiChat && 'hidden',
            )}
          >
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium text-white/60 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 group-hover:bg-white/15 transition-all duration-200">
              {isSidebarCollapsed ? (
                <ChevronRight className="w-3.5 h-3.5" />
              ) : (
                <>
                  <ChevronLeft className="w-3.5 h-3.5" />
                  Collapse
                </>
              )}
            </span>
          </button>
        </div>

        {/* Footer: identity + sign out */}
        <div className="p-3 space-y-1 shrink-0">
          {/* The way back. Only while the chat is open — on the analytics
              pages the floating button in the corner is the way in, and a
              permanent pair of toggles would be one control too many. */}
          {isAiChat && (
            <Link
              to={lastAnalyticsPath.current}
              title={isSidebarCollapsed ? 'Back to analytics' : undefined}
              className={clsx(
                'w-full flex items-center gap-3 py-2.5 rounded-xl text-sm font-medium',
                'text-white/90 hover:text-white hover:bg-white/15 transition-colors',
                isSidebarCollapsed ? 'justify-center px-0' : 'px-3',
              )}
            >
              <LayoutGrid className="w-5 h-5 shrink-0" />
              {!isSidebarCollapsed && (
                <span className="whitespace-nowrap">Analytics</span>
              )}
            </Link>
          )}

          {!isSidebarCollapsed && username && (
            <div className="px-3 pb-2 text-xs text-white/75 truncate">Signed in as <span className="font-medium text-white">{username}</span></div>
          )}
          <button
            onClick={handleLogout}
            disabled={isLoggingOut}
            title={isSidebarCollapsed ? "Logout" : undefined}
            className={clsx(
              // Red text on the brand blue. red-300 is the step that still
              // reads clearly red rather than pink; it is only 1.45:1 by
              // luminance, so the weight is bumped to semibold and the hover
              // adds a red wash to give it more to sit on.
              "w-full flex items-center gap-3 py-2.5 rounded-xl text-sm font-semibold text-red-300 hover:text-red-200 hover:bg-red-500/20 transition-colors",
              isSidebarCollapsed ? "justify-center px-0" : "px-3"
            )}
          >
            <LogOut className="w-5 h-5 shrink-0" />
            {!isSidebarCollapsed && <span className="whitespace-nowrap">Logout</span>}
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
          <div
            ref={setHeaderSlot}
            className="flex-1 min-w-0 flex items-center py-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          />
          {/* The AI chat carries no date control: the range is part of the
              question, and the assistant names the one it used in its answer.
              A picker here would imply it narrowed the query, which it did not. */}
          {isAiChat ? null : location.pathname.startsWith('/campaign-metrics') ? (
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
            'flex-1 overflow-y-auto relative transition-opacity duration-300',
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

      {/* Floating action button — the way into the chat from anywhere in the
          analytics pages. Hidden on the chat itself, where the sidebar's
          "Analytics" control is the way back out.

          Inside the panel wrapper's sibling, positioned against the viewport,
          and faded out during the logout collapse along with everything else. */}
      <Link
        to={isAiChat ? lastAnalyticsPath.current : '/ai-chat'}
        title={isAiChat ? 'Back to analytics' : 'Ask the AI assistant'}
        aria-label={isAiChat ? 'Back to analytics' : 'Ask the AI assistant'}
        className={clsx(
          'fixed bottom-6 right-6 z-30 h-14 w-14 rounded-full',
          'flex items-center justify-center',
          'shadow-lg shadow-black/25 transition-all hover:scale-105',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70',
          // One button, one appearance, in both directions — the corner always
          // means "switch to the other side of the app", and giving the two
          // directions different weight made it read as two different controls.
          'bg-blue-600 hover:bg-blue-500 text-white',
          isLoggingOut && 'opacity-0 pointer-events-none',
        )}
      >
        {isAiChat ? <LayoutGrid className="w-6 h-6" /> : <Sparkles className="w-6 h-6" />}
      </Link>
    </div>
  );
}
