import type { Id } from '@el-karta/core';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate, useParams } from 'react-router';
import { useLoadedProject } from '@/features/projects/use-loaded-project';
import { UnsavedProjectNotice } from '@/features/projects/unsaved-project-notice';
import { FloorEditor } from './floor-editor';
import { useFlushOn } from './save/autosave-context';

export function EditorPage() {
  const { t } = useTranslation();
  const { projectId = '', floorId = '' } = useParams();
  const project = useLoadedProject(projectId);
  const { model, failed } = project;
  const navigate = useNavigate();
  const { search } = useLocation();
  const openFloor = useCallback(
    (id: Id) => void navigate({ pathname: `/projects/${projectId}/floors/${id}`, search }),
    [navigate, projectId, search],
  );
  useFlushOn(floorId);

  if (failed) return <p className="p-4 text-destructive">{t('project.notFound')}</p>;
  if (project.blockedBy) {
    return (
      <div className="p-4">
        <UnsavedProjectNotice project={project} />
      </div>
    );
  }
  if (!model) return <p className="p-4 text-muted-foreground">{t('common.loading')}</p>;
  return (
    <FloorEditor floorId={floorId} backTo={`/projects/${projectId}`} onOpenFloor={openFloor} />
  );
}
