import type { Session } from '@supabase/supabase-js';
import { createContext, use } from 'react';

export interface SessionState {
  session: Session | null;
  loading: boolean;
}

export const SessionContext = createContext<SessionState>({ session: null, loading: true });

export const useSession = () => use(SessionContext);
