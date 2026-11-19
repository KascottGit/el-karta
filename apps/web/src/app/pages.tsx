import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { Button } from '@/ui/button';

export function ProjectListPage() {
  const { t } = useTranslation();
  return (
    <section className="space-y-2">
      <h1 className="text-xl font-semibold">{t('projects.title')}</h1>
      <p className="text-muted-foreground">{t('projects.empty')}</p>
    </section>
  );
}

export function ProjectPage() {
  const { t } = useTranslation();
  const { projectId = '' } = useParams();
  return <h1 className="text-xl font-semibold">{t('project.title', { projectId })}</h1>;
}

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
