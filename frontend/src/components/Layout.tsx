import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { useUIStore, useAuthStore } from '../store';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  LayoutGrid,
  LogOut,
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
          className={clsx(
            'flex-1 flex items-center gap-3 py-2.5 rounded-md text-sm font-medium transition-colors min-w-0',
            isCollapsed ? 'justify-center px-0' : 'px-3',
            isActive
              ? 'bg-blue-50 text-blue-600 border border-blue-200 dark:bg-blue-600/10 dark:text-blue-500 dark:border-blue-500/20'
              : 'text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:text-zinc-200 dark:hover:bg-zinc-800/50',
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
            className="p-2 rounded-md text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 dark:hover:text-zinc-200 dark:hover:bg-zinc-800/50 transition-colors shrink-0"
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
    <div className="flex h-screen w-full bg-zinc-50 text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100 overflow-hidden font-sans transition-colors duration-300">

      {/* Left Sidebar */}
      <aside className={clsx(
        // width-only transition: the header/content column beside this is a
        // separate flex-1 sibling with no width transition of its own, so it
        // never animates — it just occupies whatever space this leaves it,
        // frame by frame, as this alone resizes.
        "bg-white dark:bg-[#09090B] flex flex-col shrink-0 z-20 transition-[width] duration-300",
        isSidebarCollapsed ? "w-20" : "w-64"
      )}>
        {/* Logo. The right border lives on the sections *below* this one, not
            on the aside, so the brand band runs unbroken from the logo across
            the header — no seam splitting the two halves of the blue. */}
        <div className={clsx(
          "h-16 flex items-center bg-primary border-b border-black/10 shrink-0",
          isSidebarCollapsed ? "justify-center" : "px-6"
        )}>
          <Link to="/" className="flex items-center gap-3 group">
            <div className="w-8 h-8 rounded-md bg-white/15 flex items-center justify-center border border-white/25 group-hover:bg-white/25 transition-colors shrink-0">
              <EqualizerIcon className="text-white" sx={{ fontSize: 18 }} />
            </div>
            {!isSidebarCollapsed && (
              <span className="text-lg font-semibold tracking-tight text-white whitespace-nowrap">DSNL Analytics</span>
            )}
          </Link>
        </div>

        {/* Nav, then the empty space below it — which is itself the collapse
            control. A real <button> rather than a click handler on a div, so
            it is reachable by Tab and operable with Enter/Space; the hint only
            surfaces on hover/focus, which is what keeps the column clean. */}
        <div className="flex-1 flex flex-col overflow-y-auto border-r border-zinc-200 dark:border-zinc-800/60">
          <nav className="py-6 px-4 space-y-1">
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
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium text-zinc-400 dark:text-zinc-600 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 group-hover:bg-zinc-100 dark:group-hover:bg-zinc-800/50 transition-all duration-200">
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
        <div className="p-4 space-y-1 border-t border-r border-zinc-200 dark:border-zinc-800/60 shrink-0 transition-colors duration-300">
          {!isSidebarCollapsed && username && (
            <div className="px-3 pb-2 text-xs text-zinc-400 dark:text-zinc-500 truncate">Signed in as <span className="font-medium text-zinc-600 dark:text-zinc-300">{username}</span></div>
          )}
          <button
            onClick={handleLogout}
            title={isSidebarCollapsed ? "Logout" : undefined}
            className={clsx(
              "w-full flex items-center gap-3 py-2.5 rounded-md text-sm font-medium text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10 transition-colors",
              isSidebarCollapsed ? "justify-center px-0" : "px-3"
            )}
          >
            <LogOut className="w-5 h-5 shrink-0" />
            {!isSidebarCollapsed && <span className="whitespace-nowrap">Logout</span>}
          </button>
        </div>
      </aside>

      {/* Main Column */}
      <div className="flex-1 flex flex-col min-w-0 bg-zinc-50 dark:bg-[#111113] transition-colors duration-300">
        {/* The date range lives here rather than on the page: it applies to
            every analytics route, so it belongs above the outlet — and it
            fills what was otherwise an empty band. */}
        <header className="h-16 bg-primary border-b border-black/10 flex items-center justify-end gap-3 px-6 shrink-0 z-10 sticky top-0">
          <HeaderDateRange />
          <button
            onClick={toggleTheme}
            title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            className="p-2 rounded-md text-white hover:bg-white/15 transition-colors"
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
  );
}
