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

interface UIState {
  theme: 'light' | 'dark';
  toggleTheme: () => void;
}

export const useUIStore = create<UIState>((set) => ({
  theme: 'dark',
  toggleTheme: () => set((state) => {
    const newTheme = state.theme === 'light' ? 'dark' : 'light';
    if (newTheme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    return { theme: newTheme };
  }),
}));
