import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { useLoadedProject } from '@/features/projects/use-loaded-project';
import { UnsavedProjectNotice } from '@/features/projects/unsaved-project-notice';
import { FloorEditor } from './floor-editor';
import { useFlushOn } from './save/autosave-context';

export function EditorPage() {
  const { t } = useTranslation();
  const { projectId = '', floorId = '' } = useParams();
  const project = useLoadedProject(projectId);
  const { model, failed } = project;
  useFlushOn(floorId);

  if (failed) return <p className="text-destructive">{t('project.notFound')}</p>;
  if (project.blockedBy) return <UnsavedProjectNotice project={project} />;
  if (!model) return <p className="text-muted-foreground">{t('common.loading')}</p>;
  return <FloorEditor floorId={floorId} backTo={`/projects/${projectId}`} />;
}
