import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { repository } from '@/features/projects/queries';
import { useLoadedProject } from '@/features/projects/use-loaded-project';
import { FloorEditor } from './floor-editor';
import { AutosaveProvider } from './save/autosave-provider';

export function EditorPage() {
  const { t } = useTranslation();
  const { projectId = '', floorId = '' } = useParams();
  const { model, failed } = useLoadedProject(projectId);

  if (failed) return <p className="text-destructive">{t('project.notFound')}</p>;
  if (!model) return <p className="text-muted-foreground">{t('common.loading')}</p>;
  return (
    <AutosaveProvider repository={repository} flushOn={floorId}>
      <FloorEditor floorId={floorId} backTo={`/projects/${projectId}`} />
    </AutosaveProvider>
  );
}
