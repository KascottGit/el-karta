import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Button } from '@/ui/button';

export function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <section className="space-y-4">
      <h1 className="text-xl font-semibold">{t('notFound.title')}</h1>
      <Button asChild>
        <Link to="/">{t('notFound.back')}</Link>
      </Button>
    </section>
  );
}
