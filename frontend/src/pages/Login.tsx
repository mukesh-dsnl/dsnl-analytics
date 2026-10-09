import { useEffect, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Eye, EyeOff, Loader2, Lock, PhoneCall, PhoneForwarded, User, Users } from 'lucide-react';
import clsx from 'clsx';
import { api } from '../services/api';
import { useAuthStore, useUIStore } from '../store';

/** The sign-in input — the same control as RunDesk's sign-in page. */
const INPUT_CLASS =
  'w-full h-12 pl-11 rounded-lg text-[15px] border bg-white dark:bg-[#0a0f1d] border-zinc-300 dark:border-zinc-700 ' +
  'text-zinc-900 dark:text-white placeholder:text-zinc-400 dark:placeholder:text-zinc-500 ' +
  'focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 outline-none transition-colors';

/**
 * How long the card takes to grow into the content panel, and therefore how
 * long the route is held open after a successful sign-in. Kept in one place
 * because the CSS duration and the timeout have to agree — navigating early
 * unmounts the card mid-flight and the transition just disappears.
 */
const EXPAND_MS = 550;

/** Bar heights for the chart motif, as percentages. Decorative — no data is implied. */
const MOTIF_BARS = [35, 55, 40, 80, 60, 45, 70, 50, 90, 65, 42, 75, 55, 85, 48, 62, 38, 72];

/**
 * The three services, with the icons the sidebar gives them — so the names
 * here and the nav rows a moment later are visibly the same three things.
 */
const SERVICES = [
  { label: 'Voicedrop', icon: PhoneCall },
  { label: 'Conference', icon: Users },
  { label: 'Multicall', icon: PhoneForwarded },
];

/**
 * Sign-in.
 *
 * Two regions, and only one of them floats. The left is the app's own sidebar
 * field — the same textured ground and the same scrim, flush to all three
 * edges, carrying the brand mark and an analytics motif. The right is the
 * floating card, 60% of the width, inset by the same gutter Layout puts around
 * its content panel.
 *
 * That split is what makes the exit animation mean something: on success the
 * card grows left to the content panel's own footprint while the left region's
 * content fades, leaving the bare field the sidebar is about to occupy. The
 * route only changes once that has finished, so the panel you are looking at
 * is the panel the app opens with.
 */
export function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  /** Set the moment auth succeeds: the card is expanding and the route is about to change. */
  const [isLeaving, setIsLeaving] = useState(false);
  /**
   * False for the first painted frame, so the left region fades in rather than
   * appearing at once. That is the receiving half of Logout's collapse: the
   * panel shrinks to this card's footprint with the sidebar already faded out,
   * so arriving here with the hero fully drawn would pop. It reads as a gentle
   * open on a cold visit too.
   */
  const [hasEntered, setHasEntered] = useState(false);
  const signedIn = useAuthStore((s) => s.signedIn);
  const theme = useUIStore((s) => s.theme);
  const navigate = useNavigate();
  const location = useLocation();
  const expandTimer = useRef<number | undefined>(undefined);

  // Layout applies this class for the rest of the app, but Layout isn't mounted
  // on this route — so a fresh load straight onto /login rendered light while
  // the store said dark, and the theme only caught up once you were inside.
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  useEffect(() => () => window.clearTimeout(expandTimer.current), []);

  // A frame's delay, not an effect on its own: the class has to change *after*
  // the browser has painted the opacity-0 state, or there is no transition to
  // run and the region simply appears.
  useEffect(() => {
    const frame = requestAnimationFrame(() => setHasEntered(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      // Succeeds only if the server set a session cookie; from here on the
      // browser carries it automatically and nothing about the signed-in state
      // is this code's to remember.
      const result = await api.login(username.trim(), password);
      const redirectTo = (location.state as { from?: string } | null)?.from || '/';
      // The store write is what flips RequireAuth, so it is held back until the
      // navigation itself — setting it now would re-render this route as
      // authenticated and could bounce us off the page mid-animation.
      setIsLeaving(true);
      expandTimer.current = window.setTimeout(() => {
        signedIn(result.username, result.ai_permission);
        navigate(redirectTo, { replace: true });
      }, EXPAND_MS);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
      setIsSubmitting(false);
    }
  };

  // Disabled through the expansion too, not just the request: the form is on
  // its way out and a second submit would fire another login.
  const isBusy = isSubmitting || isLeaving;

  return (
    // Full bleed: the left region is the ground itself, not something floating
    // on it. The card below carries the only gutter on this page.
    <div className="app-ground app-ground-hero relative h-full w-full overflow-hidden">
      {/* ── Left: brand hero ─────────────────────────────────────────────
          40% of the width, dark ink on the brand ground (white in dark mode).
          Its content fades in on arrival and out on the way into the app,
          leaving the bare field the sidebar arrives on. Hidden below lg. */}
      <div
        className={clsx(
          'absolute inset-y-0 left-0 w-[40%] hidden lg:flex flex-col px-14 py-10',
          'text-indigo-deep dark:text-white transition-opacity duration-500',
          isLeaving || !hasEntered ? 'opacity-0' : 'opacity-100',
        )}
      >
        {/* Brand mark — the same logo block as the sidebar */}
        <div className="flex items-center gap-3 shrink-0">
          <div className="w-10 h-10 rounded-lg bg-white flex items-center justify-center shrink-0 overflow-hidden shadow-sm">
            <img src="/DSNL.png" alt="DSNL" className="w-full h-full object-cover" />
          </div>
          <span className="text-base font-bold tracking-tight">DSNL Analytics</span>
        </div>

        {/* Headline, services, pitch and bar motif, centred in the free height */}
        <div className="flex-1 min-h-0 min-w-0 flex flex-col justify-center py-8">
          <h2 className="text-5xl xl:text-6xl font-extrabold tracking-[-0.035em] leading-[1.02]">
            Every call,
            <br />
            <span className="text-white dark:text-cyan-light">measured.</span>
          </h2>

          {/* The three services, wearing the same icons as the sidebar. */}
          <ul className="mt-7 flex flex-wrap gap-2">
            {SERVICES.map(({ label, icon: Icon }) => (
              <li
                key={label}
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white/25 border border-indigo-deep/10 dark:bg-white/10 dark:border-white/15"
              >
                <Icon className="w-3.5 h-3.5 shrink-0" />
                {label}
              </li>
            ))}
          </ul>

          <p className="mt-6 text-lg leading-relaxed max-w-md opacity-85 dark:text-white/75 dark:opacity-100">
            Analyze your daily call metrics.
          </p>

          {/* The dashboard's own shape, as a motif. Decorative only. */}
          <div aria-hidden="true" className="mt-10 flex items-end gap-2 h-36">
            {MOTIF_BARS.map((height, index) => (
              <div
                key={index}
                className={clsx(
                  'flex-1 rounded-t-md',
                  index % 4 === 3 ? 'bg-indigo-deep/40 dark:bg-hero' : 'bg-black/[0.08] dark:bg-white/10',
                )}
                style={{ height: `${height}%` }}
              />
            ))}
          </div>
        </div>

        <p className="text-xs font-medium opacity-80 dark:text-white/70 dark:opacity-100 shrink-0">
          © {new Date().getFullYear()} DSNL
        </p>
      </div>

      {/* ── Right: the floating card ─────────────────────────────────────
          60% of the width at rest, inset by Layout's 12px gutter. On success
          its left edge slides to 268px — the sidebar (w-64) plus that gutter,
          the content panel's own position — so the two pages share one
          continuous surface. */}
      <div
        className={clsx(
          'absolute top-3 bottom-3 right-3 flex flex-col rounded-2xl overflow-hidden',
          'bg-white dark:bg-surface-dark shadow-2xl shadow-black/25 dark:ring-1 dark:ring-white/5',
          'transition-[left] ease-in-out motion-reduce:transition-none',
          isLeaving ? 'left-3 lg:left-[268px]' : 'left-3 lg:left-[40%]',
        )}
        style={{ transitionDuration: `${EXPAND_MS}ms` }}
      >
        {/* The form fades as the box grows — a form stretched across a full
            panel on the way out would read as a layout bug. */}
        <div
          className={clsx(
            'flex-1 min-h-0 flex flex-col overflow-y-auto transition-opacity duration-300',
            isLeaving ? 'opacity-0' : 'opacity-100',
          )}
        >
          {/* Mobile-only brand mark — below lg the hero side is hidden */}
          <div className="flex lg:hidden items-center gap-3 px-8 pt-8 shrink-0">
            <div className="w-10 h-10 rounded-lg bg-white border border-zinc-200 dark:border-zinc-800 shadow-sm flex items-center justify-center shrink-0 overflow-hidden">
              <img src="/DSNL.png" alt="DSNL" className="w-full h-full object-cover" />
            </div>
            <span className="text-base font-bold tracking-tight text-zinc-900 dark:text-white">
              DSNL Analytics
            </span>
          </div>

          {/* my-auto: centred in the leftover height when there is any, and
              scrolling from the top when the window is too short for it. */}
          <div className="w-full max-w-[400px] mx-auto my-auto px-6 py-10">
            <h1 className="text-[34px] font-bold tracking-[-0.02em] text-zinc-950 dark:text-white">
              Sign In
            </h1>
            <p className="text-[15px] text-zinc-600 dark:text-zinc-400 mt-1.5">
              Sign in to continue to your dashboard.
            </p>

            <form onSubmit={handleSubmit} className="mt-8 space-y-5">
              {error && (
                <div
                  role="alert"
                  className="flex items-start gap-3 px-4 py-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-500/30 text-sm text-red-700 dark:text-red-400"
                >
                  <p className="min-w-0 flex-1 break-words">{error}</p>
                </div>
              )}

              <div>
                <label
                  htmlFor="login-username"
                  className="block text-sm font-semibold text-zinc-900 dark:text-white mb-2"
                >
                  Username
                </label>
                <div className="relative">
                  <User className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500 dark:text-zinc-400 pointer-events-none" />
                  <input
                    id="login-username"
                    type="text"
                    required
                    autoFocus
                    autoComplete="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className={clsx(INPUT_CLASS, 'pr-4')}
                    placeholder="username"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="login-password"
                  className="block text-sm font-semibold text-zinc-900 dark:text-white mb-2"
                >
                  Password
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500 dark:text-zinc-400 pointer-events-none" />
                  <input
                    id="login-password"
                    type={showPassword ? 'text' : 'password'}
                    required
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className={clsx(INPUT_CLASS, 'pr-12')}
                    placeholder="••••••••"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    title={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-md text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white transition-colors"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={isBusy}
                className="w-full h-12 !mt-7 flex items-center justify-center gap-2 rounded-lg bg-action hover:bg-action-hover disabled:opacity-60 disabled:pointer-events-none text-on-action text-[15px] font-semibold shadow-sm transition-colors"
              >
                {isBusy && <Loader2 className="w-4 h-4 animate-spin" />}
                Sign In
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
