import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link, Outlet } from 'react-router';
import { supabase } from '@/app/supabase';
import { useSession } from '@/features/auth/session-context';
import { whenIdle } from '@/features/floorplan/save/autosave';
import { repository } from '@/features/projects/queries';
import { hasUnsavedChanges, modelStore } from '@/model/store';
import { Button } from '@/ui/button';

export function AppLayout() {
  const { t } = useTranslation();
  const { session } = useSession();
  const queryClient = useQueryClient();

  const signOut = async () => {
    // Autosave cannot run once the session is gone, so save what is queued first.
    while (modelStore.getState().saving) await whenIdle(modelStore);
    if (hasUnsavedChanges(modelStore.getState())) {
      await modelStore
        .getState()
        .save(repository)
        .catch(() => undefined);
    }
    if (hasUnsavedChanges(modelStore.getState()) && !window.confirm(t('auth.signOutUnsaved'))) {
      return;
    }
    await supabase.auth.signOut();
    modelStore.getState().clear();
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
