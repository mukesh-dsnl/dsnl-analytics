import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { useUIStore, useAuthStore } from '../store';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  LayoutGrid,
  LogOut,
  Megaphone,
  Moon,
  PhoneCall,
  PhoneForwarded,
  Sun,
  Users,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import EqualizerIcon from '@mui/icons-material/Equalizer';
import clsx from 'clsx';
import { useEffect, useState } from 'react';
import { HeaderDateRange } from '../features/cdr-dashboard/components/HeaderDateRange';
import { HeaderCampaignDate } from '../features/campaign-metrics/components/HeaderCampaignDate';

interface NavNode {
  label: string;
  path: string;
  icon?: LucideIcon;
  children?: NavNode[];
}

const NAV: NavNode[] = [
  { label: 'All', path: '/analytics/all', icon: LayoutGrid },
  { label: 'Voicedrop', path: '/analytics/voicedrop', icon: PhoneCall },
  { label: 'Conference', path: '/analytics/conference', icon: Users },
  { label: 'Multicall', path: '/analytics/multicall', icon: PhoneForwarded },
  {
    label: 'Campaign Metrics',
    // Same path as its first child — clicking the parent label itself is how
    // it "defaults to routing to the Voicedrop view".
    path: '/campaign-metrics/voicedrop',
    icon: Megaphone,
    children: [
      { label: 'Voicedrop', path: '/campaign-metrics/voicedrop' },
      { label: 'Conference', path: '/campaign-metrics/conference' },
      { label: 'Multicall', path: '/campaign-metrics/multicall' },
    ],
  },
];

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
  // A parent reads as active whenever the current route is anywhere under it,
  // not only on its own exact path — Analytics stays highlighted from every
  // service tab, and Voicedrop stays highlighted on its Blast Details page.
  const isActive = collectPaths(node).some(isActivePath);

  return (
    <div>
      <div className="flex items-center gap-0.5">
        <Link
          to={node.path}
          title={isCollapsed ? node.label : undefined}
          style={isCollapsed ? undefined : { paddingLeft: 12 + depth * 16 }}
          // Sits on the glass panel, so identity comes from translucent white
          // rather than the zinc/blue ramp the content panel uses — a light
          // surface tint would punch a hole in the blur.
          className={clsx(
            'flex-1 flex items-center gap-3 py-2.5 rounded-xl text-sm font-medium transition-colors min-w-0',
            isCollapsed ? 'justify-center px-0' : 'px-3',
            isActive
              ? 'bg-white/25 text-white border border-white/30 shadow-sm'
              // Pure white, not a tint: white on the brand blue is already only
              // 2.75:1, so there is no contrast to spend on softening it.
              : 'text-white hover:bg-white/15 border border-transparent',
          )}
        >
          {node.icon ? (
            <node.icon className="w-5 h-5 shrink-0" />
          ) : (
            !isCollapsed && <span className="w-5 h-5 shrink-0" />
          )}
          {!isCollapsed && <span className="whitespace-nowrap truncate">{node.label}</span>}
        </Link>

        {hasChildren && !isCollapsed && (
          <button
            type="button"
            onClick={() => toggle(node.label)}
            aria-label={isOpen ? `Collapse ${node.label}` : `Expand ${node.label}`}
            aria-expanded={isOpen}
            className="p-2 rounded-lg text-white/60 hover:text-white hover:bg-white/12 transition-colors shrink-0"
          >
            {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </button>
        )}
      </div>

      {hasChildren && !isCollapsed && isOpen && (
        <div className="mt-1 space-y-1">
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

  const handleLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

  return (
    // The ground is the same brand blue as the sidebar, so the gutter around
    // the content panel reads as a continuation of it rather than as a separate
    // surface — the sidebar and the margin are one field of colour with the
    // panel inset into it.
    //
    // Flat rather than a gradient, and that matters: any gradient would drift
    // away from the sidebar's flat fill somewhere along its length and put a
    // visible seam exactly where the two are supposed to be continuous.
    <div className="flex h-screen w-full overflow-hidden font-sans text-zinc-900 dark:text-zinc-100 bg-primary">

      {/* Left Sidebar — flush to the edge, full height, solid brand blue */}
      <aside className={clsx(
        // width-only transition: the content column beside this is a separate
        // flex-1 sibling with no width transition of its own, so it never
        // animates — it just occupies whatever space this leaves it, frame by
        // frame, as this alone resizes.
        "flex flex-col shrink-0 z-20 bg-primary transition-[width] duration-300",
        isSidebarCollapsed ? "w-20" : "w-64"
      )}>
        {/* Logo. No divider under it — the panel is one unbroken field of
            brand blue, and spacing alone separates the regions. */}
        <div className={clsx(
          "h-16 flex items-center shrink-0",
          isSidebarCollapsed ? "justify-center" : "px-6"
        )}>
          <Link to="/" className="flex items-center gap-3 group overflow-hidden">
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
        </div>

        {/* Nav, then the empty space below it — which is itself the collapse
            control. A real <button> rather than a click handler on a div, so
            it is reachable by Tab and operable with Enter/Space; the hint only
            surfaces on hover/focus, which is what keeps the column clean. */}
        <div className="flex-1 flex flex-col overflow-y-auto">
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

          <button
            type="button"
            onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
            aria-label={isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="flex-1 min-h-[72px] w-full group flex items-start justify-center pt-2 cursor-pointer focus:outline-none"
          >
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium text-white/60 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 group-hover:bg-white/12 transition-all duration-200">
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
          {!isSidebarCollapsed && username && (
            <div className="px-3 pb-2 text-xs text-white/75 truncate">Signed in as <span className="font-medium text-white">{username}</span></div>
          )}
          <button
            onClick={handleLogout}
            title={isSidebarCollapsed ? "Logout" : undefined}
            className={clsx(
              // Rose rather than the content panel's red-600: a saturated red
              // on translucent glass over a blue gradient goes muddy.
              "w-full flex items-center gap-3 py-2.5 rounded-xl text-sm font-medium text-rose-100 hover:bg-rose-500/25 transition-colors",
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
      <div className="flex-1 min-w-0 p-3">
      {/* No border: against the brand blue the panel edge is already a hard
          value change, and a light hairline there would read as a halo. */}
      <div className="h-full flex flex-col rounded-2xl overflow-hidden
                      shadow-lg shadow-black/10
                      bg-zinc-50 dark:bg-[#111113]">
        {/* The date control lives here rather than on the page: it applies to
            every route in its module, so it belongs above the outlet. Campaign
            Metrics gets its own single-date control instead of the analytics
            date range, since the two modules read the lake differently (one day
            vs a range) and hold their selections in separate stores. */}
        <header className="h-16 flex items-center justify-end gap-3 px-6 shrink-0 z-10
                           bg-white dark:bg-[#09090B] border-b border-zinc-200 dark:border-zinc-800/60">
          {location.pathname.startsWith('/campaign-metrics') ? <HeaderCampaignDate /> : <HeaderDateRange />}
          <button
            onClick={toggleTheme}
            title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            className="p-2 rounded-lg text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:text-zinc-200 dark:hover:bg-zinc-800/50 transition-colors"
          >
            {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
          </button>
        </header>

        {/* Main Content Area */}
        <main className="flex-1 overflow-y-auto relative">
          <Outlet />
        </main>
      </div>
      </div>
    </div>
  );
}
