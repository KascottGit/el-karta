import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link, Outlet } from 'react-router';
import { supabase } from '@/app/supabase';
import { useSession } from '@/features/auth/session-context';
import { Button } from '@/ui/button';

export function AppLayout() {
  const { t } = useTranslation();
  const { session } = useSession();
  const queryClient = useQueryClient();

  const signOut = async () => {
    await supabase.auth.signOut();
    queryClient.clear();
  };

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center gap-4 border-b px-4 py-3">
        <Link to="/" className="font-semibold">
          {t('app.name')}
        </Link>
        {session && (
          <nav className="text-sm text-muted-foreground">
            <Link to="/">{t('nav.projects')}</Link>
          </nav>
        )}
        {session && (
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden text-sm text-muted-foreground sm:inline">
              {session.user.email}
            </span>
            <Button variant="outline" size="sm" onClick={() => void signOut()}>
              {t('auth.signOut')}
            </Button>
          </div>
        )}
      </header>
      <main className="flex-1 p-4">
        <Outlet />
      </main>
      <footer className="border-t px-4 py-2 text-xs text-muted-foreground">
        {t('app.safetyNote')}
      </footer>
    </div>
  );
}
