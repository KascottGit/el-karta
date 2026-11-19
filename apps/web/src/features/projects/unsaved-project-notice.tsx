import { useTranslation } from 'react-i18next';
import { Button } from '@/ui/button';
import type { LoadedProject } from './use-loaded-project';

/** Shown instead of a project while another open project still has changes that could not be saved. */
export function UnsavedProjectNotice({ project }: { project: LoadedProject }) {
  const { t } = useTranslation();
  if (!project.blockedBy) return null;
  return (
    <section role="alert" className="mx-auto max-w-2xl space-y-3 rounded-lg border p-4">
      <p>{t('unsavedProject.message', { name: project.blockedBy })}</p>
      <div className="flex flex-wrap gap-2">
        <Button onClick={project.retry}>{t('unsavedProject.retry')}</Button>
        <Button variant="outline" onClick={project.discardOther}>
          {t('unsavedProject.discard')}
        </Button>
      </div>
    </section>
  );
}
