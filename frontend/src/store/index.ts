import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { api, onUnauthorized } from '../services/api';

/**
 * Whether the caller is signed in.
 *
 * Three states, not two. `unknown` is the one a naive version forgets: on a
 * cold load the app genuinely does not know yet, because the answer lives in
 * an httpOnly cookie it cannot read and has to ask the server for. Treating
 * that as "no" would bounce every refresh to /login and back.
 *
 * Nothing here is authorisation. The session cookie is what authenticates a
 * request; this only decides what to render while the server is being asked.
 * Setting `status: 'authenticated'` by hand in devtools reveals a UI shell
 * whose every request still comes back 401.
 */
export type AuthStatus = 'unknown' | 'authenticated' | 'anonymous';

interface AuthState {
  status: AuthStatus;
  username: string | null;
  /** Ask the server who we are. Called once on boot, and after signing in. */
  check: () => Promise<void>;
  /** Record a successful sign-in. The cookie is already set by then. */
  signedIn: (username: string) => void;
  /** Sign out here and on the server. */
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      status: 'unknown',
      username: null,

      check: async () => {
        try {
          const me = await api.me();
          set({ status: 'authenticated', username: me.username });
        } catch {
          set({ status: 'anonymous', username: null });
        }
      },

      signedIn: (username) => set({ status: 'authenticated', username }),

      logout: async () => {
        await api.logout();
        set({ status: 'anonymous', username: null });
      },
    }),
    {
      // Namespaced. localStorage is scoped per origin, not per path, so a bare
      // 'auth-storage' would be shared with any other app served from the same
      // host — silently overwriting each other's sessions.
      name: 'dsnl-analytics:auth',
      // Only the name is kept, and only so the header does not flash empty
      // while `check()` is in flight. `status` is deliberately NOT persisted:
      // a stored "authenticated" is exactly the stale claim this design
      // replaces, and would recreate the bug it exists to fix.
      partialize: (state) => ({ username: state.username }),
    },
  ),
);

// Any 401, from any endpoint, means the session ended mid-visit. Registered
// here rather than in a component so it survives navigation and cannot be
// mounted twice.
onUnauthorized(() => {
  useAuthStore.setState({ status: 'anonymous', username: null });
});

/**
 * The analytics date range, hoisted out of the page because the control that
 * sets it now lives in the header — above the router outlet, so the two can't
 * share it through props. Every analytics page reads the range from here.
 *
 * Null until seeded: only the backend knows which days the lake actually
 * holds, so the range can't have a sensible literal default. `useDateRange`
 * does the seeding once the status query answers.
 */
interface DateRangeState {
  dateFrom: string | null;
  dateTo: string | null;
  setRange: (from: string, to: string) => void;
}

export const useDateRangeStore = create<DateRangeState>((set) => ({
  dateFrom: null,
  dateTo: null,
  setRange: (dateFrom, dateTo) => set({ dateFrom, dateTo }),
}));

/**
 * The Campaign Metrics single-day selection — its own store, not a field on
 * useDateRangeStore, because Campaign Metrics takes exactly one date rather
 * than a range and its header control lives on a different set of routes.
 * Same null-until-seeded shape as the date range, for the same reason: only
 * the backend's lake status knows which day to open on.
 */
interface CampaignDateState {
  date: string | null;
  setDate: (date: string) => void;
}

export const useCampaignDateStore = create<CampaignDateState>((set) => ({
  date: null,
  setDate: (date) => set({ date }),
}));

/**
 * How the app looks, as opposed to what it shows.
 *
 * Persisted, because a theme that resets on every reload is a preference the
 * app keeps forgetting — the one setting here a user picks deliberately.
 *
 * The setter is pure: it moves the value and nothing else. Applying the class
 * to <html> belongs to whoever is mounted — Layout for the app, Login for the
 * one route outside it — and both already do it in an effect keyed on `theme`,
 * which covers the rehydrated value on load as well as every later toggle.
 * Writing the DOM from in here too meant three copies of one rule, and the
 * copy in the setter was the one that could not see a restored value.
 *
 * First paint is handled earlier still, by the inline script in index.html:
 * React mounts after the page has drawn, so without it a reload flashes the
 * default theme on its way to the saved one.
 */
interface UIState {
  theme: 'light' | 'dark';
  toggleTheme: () => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      theme: 'dark',
      toggleTheme: () =>
        set((state) => ({ theme: state.theme === 'light' ? 'dark' : 'light' })),
    }),
    {
      // Namespaced for the same reason as the auth key above. Changing this
      // means changing the inline script in index.html, which reads it
      // directly — the two are one setting in two places.
      name: 'dsnl-analytics:ui',
      // Only the value is stored. Persisting the whole object would put the
      // action in localStorage too — dropped by JSON today, but a trap for the
      // first non-serializable field anyone adds here later.
      partialize: (state) => ({ theme: state.theme }),
    },
  ),
);
