import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AuthState {
  username: string | null;
  isAuthenticated: boolean;
  login: (username: string) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      username: null,
      isAuthenticated: false,
      login: (username) => set({ username, isAuthenticated: true }),
      logout: () => set({ username: null, isAuthenticated: false }),
    }),
    { name: 'auth-storage' }
  )
);

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
      name: 'ui-storage',
      // Only the value is stored. Persisting the whole object would put the
      // action in localStorage too — dropped by JSON today, but a trap for the
      // first non-serializable field anyone adds here later.
      partialize: (state) => ({ theme: state.theme }),
    },
  ),
);
