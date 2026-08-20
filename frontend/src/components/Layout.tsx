import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { useUIStore, useAuthStore } from '../store';
import {
  PieChart,
  ChevronLeft,
  ChevronRight,
  LogOut,
  Sun,
  Moon
} from 'lucide-react';
import clsx from 'clsx';
import { useState, useEffect } from 'react';

export function Layout() {
  const { theme, toggleTheme } = useUIStore();
  const { username, logout } = useAuthStore();
  const location = useLocation();
  const navigate = useNavigate();
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  // Ensure theme is applied to document
  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [theme]);

  const navItems = [
    { icon: PieChart, label: 'Analytics', path: '/analytics' },
  ];

  const isSectionActive = (path: string) =>
    path === '/'
      ? location.pathname === '/' || location.pathname === '/analytics'
      : location.pathname === path || location.pathname.startsWith(`${path}/`);

  const handleLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="flex h-screen w-full bg-zinc-50 text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100 overflow-hidden font-sans transition-colors duration-300">

      {/* Left Sidebar */}
      <aside className={clsx(
        "bg-white border-r border-zinc-200 dark:bg-[#09090B] dark:border-zinc-800/60 flex flex-col shrink-0 z-20 transition-all duration-300",
        isSidebarCollapsed ? "w-20" : "w-64"
      )}>
        {/* Logo */}
        <div className={clsx(
          "h-16 flex items-center bg-primary border-b border-black/10",
          isSidebarCollapsed ? "justify-center" : "px-6"
        )}>
          <Link to="/" className="flex items-center gap-3 group">
            <div className="w-8 h-8 rounded-md bg-white/15 flex items-center justify-center border border-white/25 group-hover:bg-white/25 transition-colors shrink-0">
              <span className="text-white font-mono font-bold text-sm">{'>_'}</span>
            </div>
            {!isSidebarCollapsed && (
              <span className="text-lg font-semibold tracking-tight text-white whitespace-nowrap">DSNL Analytics</span>
            )}
          </Link>
        </div>

        {/* Main Nav */}
        <div className="flex-1 overflow-y-auto py-6 px-4 space-y-1">
          {navItems.map((item) => {
            const isActive = isSectionActive(item.path);
            return (
              <div key={item.label} className="space-y-1">
                <Link
                  to={item.path}
                  title={isSidebarCollapsed ? item.label : undefined}
                  className={clsx(
                    "flex items-center gap-3 py-2.5 rounded-md text-sm font-medium transition-colors",
                    isSidebarCollapsed ? "justify-center px-0" : "px-3",
                    isActive
                      ? "bg-blue-50 text-blue-600 border border-blue-200 dark:bg-blue-600/10 dark:text-blue-500 dark:border-blue-500/20"
                      : "text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:text-zinc-200 dark:hover:bg-zinc-800/50"
                  )}
                >
                  <item.icon className="w-5 h-5 shrink-0" />
                  {!isSidebarCollapsed && <span className="whitespace-nowrap">{item.label}</span>}
                </Link>
              </div>
            );
          })}
        </div>

        {/* Footer: Logout + Collapse */}
        <div className="p-4 space-y-1 border-t border-zinc-200 dark:border-zinc-800/60 transition-colors duration-300">
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
          <button
            onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
            title={isSidebarCollapsed ? "Expand Sidebar" : "Collapse Sidebar"}
            className={clsx(
              "w-full flex items-center gap-3 py-2.5 rounded-md text-sm font-medium text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:text-zinc-200 dark:hover:bg-zinc-800/50 transition-colors",
              isSidebarCollapsed ? "justify-center px-0" : "px-3"
            )}
          >
            {isSidebarCollapsed ? <ChevronRight className="w-5 h-5 shrink-0" /> : <ChevronLeft className="w-5 h-5 shrink-0" />}
            {!isSidebarCollapsed && <span className="whitespace-nowrap">Collapse</span>}
          </button>
        </div>
      </aside>

      {/* Main Column */}
      <div className="flex-1 flex flex-col min-w-0 bg-zinc-50 dark:bg-[#111113] relative transition-colors duration-300">
        <header className="h-16 bg-primary border-b border-black/10 flex items-center justify-end px-6 shrink-0 z-10 sticky top-0">
          <div className="flex items-center gap-2">
            <button
              onClick={toggleTheme}
              title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
              className="p-2 rounded-md text-white hover:bg-white/15 transition-colors"
            >
              {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </button>
          </div>
        </header>

        {/* Main Content Area */}
        <main className="flex-1 overflow-y-auto relative">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
