import { useTranslation } from 'react-i18next';
import { Link, Outlet } from 'react-router';

export function AppLayout() {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center gap-4 border-b px-4 py-3">
        <Link to="/" className="font-semibold">
          {t('app.name')}
        </Link>
        <nav className="text-sm text-muted-foreground">
          <Link to="/">{t('nav.projects')}</Link>
        </nav>
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
