import { useEffect, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  AlertTriangle,
  Loader2,
  Lock,
  PhoneCall,
  PhoneForwarded,
  User,
  Users,
} from 'lucide-react';
import EqualizerIcon from '@mui/icons-material/Equalizer';
import clsx from 'clsx';
import { api } from '../services/api';
import { useAuthStore, useUIStore } from '../store';

/** The app's own input, lifted from ServiceFilterBar so the two read as one control. */
const INPUT_CLASS =
  'w-full h-11 pl-10 pr-3 rounded-lg border bg-white dark:bg-surface-dark border-zinc-200 dark:border-zinc-800 ' +
  'text-zinc-900 dark:text-white text-sm placeholder:text-zinc-400 ' +
  'focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-shadow';

/**
 * How long the card takes to grow into the content panel, and therefore how
 * long the route is held open after a successful sign-in. Kept in one place
 * because the CSS duration and the timeout have to agree — navigating early
 * unmounts the card mid-flight and the transition just disappears.
 */
const EXPAND_MS = 550;

/** Bar heights for the chart motif, as percentages. Decorative — no data is implied. */
const MOTIF_BARS = [38, 62, 46, 88, 54, 72, 41, 66, 95, 58, 34, 78];

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
  const login = useAuthStore((s) => s.login);
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
      const result = await api.login(username.trim(), password);
      const redirectTo = (location.state as { from?: string } | null)?.from || '/';
      // The store write is what flips RequireAuth, so it is held back until the
      // navigation itself — setting it now would re-render this route as
      // authenticated and could bounce us off the page mid-animation.
      setIsLeaving(true);
      expandTimer.current = window.setTimeout(() => {
        login(result.username);
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
    // Full bleed, no gutter of its own: the left region is the ground itself,
    // not something floating on it, so nothing insets it from the edges. The
    // card below carries the only gutter on this page.
    <div className="app-ground app-ground-hero relative h-full w-full overflow-hidden">
      {/* ── Left: the sidebar field ──────────────────────────────────────
          Exactly what the app's sidebar is — the textured ground plus the
          scrim that fades out toward its right edge. No fill, no border and no
          radius of its own, because it is not a panel. Its content fades on
          the way out, leaving the bare field the sidebar arrives on.

          Hidden below lg, where the card takes the full width and all that
          remains of this is the gutter around it. */}
      <div
        className={clsx(
          'app-sidebar-scrim absolute inset-y-0 left-0 w-[40%] hidden lg:flex flex-col justify-between',
          'p-10 transition-opacity duration-500',
          isLeaving || !hasEntered ? 'opacity-0' : 'opacity-100',
        )}
      >
        {/* The sidebar's own brand block, at the same size and in the same
            corner it will be in a moment. */}
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-md bg-white/15 border border-white/25 flex items-center justify-center shrink-0">
            <EqualizerIcon className="text-white" sx={{ fontSize: 18 }} />
          </div>
          <span className="text-lg font-semibold tracking-tight text-white">DSNL Analytics</span>
        </div>

        <div className="min-w-0">
          <h2 className="text-4xl xl:text-5xl font-semibold tracking-tight text-white leading-[1.05]">
            Every call,
            <br />
            measured.
          </h2>
          {/* The three services, directly under the headline and wearing the
              sidebar's own pill: same white wash, same border, same icons. So
              they read as the nav they are about to become rather than as
              decoration, and the sentence below no longer has to list them. */}
          <ul className="mt-6 flex flex-wrap gap-2">
            {SERVICES.map(({ label, icon: Icon }) => (
              <li
                key={label}
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/15 border border-white/25 text-xs font-medium text-white"
              >
                <Icon className="w-3.5 h-3.5 shrink-0" />
                {label}
              </li>
            ))}
          </ul>

          <p className="mt-5 text-sm text-white/70 max-w-sm">
            Analyze your daily call metrics.
          </p>

          {/* The dashboard's own shape, as a motif. Decorative only. */}
          <div aria-hidden="true" className="mt-10 flex items-end gap-1.5 h-24">
            {MOTIF_BARS.map((height, index) => (
              <div
                key={index}
                className={clsx(
                  'flex-1 rounded-t-sm',
                  index % 4 === 3 ? 'bg-white/50' : 'bg-white/15 backdrop-blur-sm',
                )}
                style={{ height: `${height}%` }}
              />
            ))}
          </div>
        </div>

        <p className="text-xs text-white/50">© {new Date().getFullYear()} DSNL</p>
      </div>

      {/* ── Right: the floating card ─────────────────────────────────────
          60% of the width, inset by the same 12px gutter Layout puts around
          its content panel. Its left edge is the one thing that animates. */}
      <div
        className={clsx(
          'absolute top-3 bottom-3 right-3 flex flex-col rounded-2xl overflow-hidden',
          'bg-white dark:bg-surface-dark shadow-2xl shadow-black/25',
          'transition-[left] ease-in-out motion-reduce:transition-none',
          // 40% in, so the card is the remaining 60% of the width. On the way
          // out it goes to 268px: the dashboard's sidebar (w-64) plus Layout's
          // 12px gutter — the content panel's own left edge, not a number
          // picked by eye. Both are lg-only; below that the card is full width
          // in either state and there is nothing to animate.
          isLeaving ? 'left-3 lg:left-[268px]' : 'left-3 lg:left-[40%]',
        )}
        style={{ transitionDuration: `${EXPAND_MS}ms` }}
      >
        {/* Everything inside fades as the box grows — a form stretched across
            a full-width panel on the way out reads as a layout bug. */}
        <div
          className={clsx(
            'flex-1 min-h-0 flex flex-col overflow-y-auto transition-opacity duration-300',
            isLeaving ? 'opacity-0' : 'opacity-100',
          )}
        >
          {/* Only below lg, where the left region — and with it the brand mark
              — is not on screen at all. */}
          <div className="flex lg:hidden items-center gap-3 px-8 pt-8 shrink-0">
            <div className="w-9 h-9 rounded-md bg-primary flex items-center justify-center shrink-0">
              <EqualizerIcon className="text-white" sx={{ fontSize: 20 }} />
            </div>
            <span className="text-base font-semibold tracking-tight text-zinc-900 dark:text-white">
              DSNL Analytics
            </span>
          </div>

          {/* my-auto rather than justify-center: the form centres in the
              leftover height when there is any, and simply scrolls from the
              top when the window is too short for it. */}
          <div className="w-full max-w-sm mx-auto my-auto px-8 lg:px-12 py-10">
            <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-white">
              Sign In
            </h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1.5">
              Sign in to continue to your dashboard.
            </p>

            <form onSubmit={handleSubmit} className="mt-8 space-y-4">
              {/* The same banner the dashboard raises when the lake is
                  unreadable, down to the icon — one shape for "something went
                  wrong", wherever it happens. */}
              {error && (
                <div
                  role="alert"
                  className="flex items-start gap-3 px-4 py-3 rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-500/30 text-sm text-red-700 dark:text-red-400"
                >
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <p className="min-w-0 flex-1 break-words">{error}</p>
                </div>
              )}

              <div>
                <label
                  htmlFor="login-username"
                  className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1.5"
                >
                  Username
                </label>
                <div className="relative">
                  <User className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
                  <input
                    id="login-username"
                    type="text"
                    required
                    autoFocus
                    autoComplete="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className={INPUT_CLASS}
                    placeholder="username"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="login-password"
                  className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1.5"
                >
                  Password
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
                  <input
                    id="login-password"
                    type="password"
                    required
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className={INPUT_CLASS}
                    placeholder="••••••••"
                  />
                </div>
              </div>

              {/* blue-600 into blue-500 on hover: the same pairing the rest of
                  the app's accents use. */}
              <button
                type="submit"
                disabled={isBusy}
                className="w-full h-11 flex items-center justify-center gap-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-60 disabled:pointer-events-none text-white text-sm font-semibold transition-colors"
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
