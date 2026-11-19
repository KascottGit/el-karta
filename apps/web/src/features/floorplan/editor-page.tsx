import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { useLoadedProject } from '@/features/projects/use-loaded-project';
import { FloorEditor } from './floor-editor';

export function EditorPage() {
  const { t } = useTranslation();
  const { projectId = '', floorId = '' } = useParams();
  const { model, failed } = useLoadedProject(projectId);

  if (failed) return <p className="text-destructive">{t('project.notFound')}</p>;
  if (!model) return <p className="text-muted-foreground">{t('common.loading')}</p>;
  return <FloorEditor floorId={floorId} backTo={`/projects/${projectId}`} />;
}
