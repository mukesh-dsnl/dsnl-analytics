import { useEffect } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useAuthStore } from '../store';

/**
 * The gate every route inside the app sits behind.
 *
 * The important case is the middle one. On a cold load the answer to "is this
 * person signed in" is not `false` — it is *not yet known*, because it lives in
 * an httpOnly cookie this code cannot read and has to ask the server about.
 * Rendering a redirect during that window would send every refresh to /login
 * and then back again, which looks like a flicker and loses the page you were
 * on.
 *
 * This is the same shape as a bug fixed elsewhere in this codebase: an initial
 * value that asserts something the code has not verified yet. Here it is
 * handled by having a state for "asking".
 */
export function RequireAuth() {
  const status = useAuthStore((s) => s.status);
  const check = useAuthStore((s) => s.check);
  const location = useLocation();

  // Runs once per mount while the answer is still unknown — including after a
  // 401 has reset the status, which is what re-verifies rather than trusting
  // the reset.
  useEffect(() => {
    if (status === 'unknown') void check();
  }, [status, check]);

  if (status === 'unknown') {
    return (
      <div className="h-full w-full flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-white/70" />
      </div>
    );
  }

  if (status === 'anonymous') {
    // `from` carries the page being attempted, so signing in returns there
    // instead of dumping everyone on the default dashboard.
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <Outlet />;
}
