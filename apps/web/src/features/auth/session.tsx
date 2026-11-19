import { useEffect, useState, type ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';
import { supabase } from '@/app/supabase';
import { SessionContext, useSession, type SessionState } from './session-context';

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ session: null, loading: true });

  useEffect(() => {
    // getSession waits for supabase-js to exchange a PKCE `?code=` from a magic link, if present.
    void supabase.auth.getSession().then(({ data }) => {
      setState({ session: data.session, loading: false });
    });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setState({ session, loading: false });
    });
    return () => {
      data.subscription.unsubscribe();
    };
  }, []);

  return <SessionContext value={state}>{children}</SessionContext>;
}

export function RequireSession() {
  const { session, loading } = useSession();
  const location = useLocation();
  if (loading) return null;
  if (!session) return <Navigate to="/sign-in" replace state={{ from: location.pathname }} />;
  return <Outlet />;
}
