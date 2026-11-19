import { zodResolver } from '@hookform/resolvers/zod';
import { ProjectKind } from '@el-karta/core';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { z } from 'zod';
import { Button } from '@/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/card';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { useCreateProject, useProjects } from './queries';

const NewProjectForm = z.object({ name: z.string().trim().min(1), kind: ProjectKind });
type NewProjectForm = z.infer<typeof NewProjectForm>;

export function ProjectListPage() {
  const { t } = useTranslation();
  const projects = useProjects();

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <section className="space-y-2">
        <h1 className="text-xl font-semibold">{t('projects.title')}</h1>
        {projects.isPending && <p className="text-muted-foreground">{t('common.loading')}</p>}
        {projects.isError && <p className="text-destructive">{t('common.loadFailed')}</p>}
        {projects.data?.length === 0 && (
          <p className="text-muted-foreground">{t('projects.empty')}</p>
        )}
        <ul className="divide-y rounded-lg border">
          {projects.data?.map((project) => (
            <li key={project.id}>
              <Link
                to={`/projects/${project.id}`}
                className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-muted"
              >
                <span className="font-medium">{project.name}</span>
                <span className="text-sm text-muted-foreground">
                  {t(`projectKind.${project.kind}`)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
      <NewProject />
    </div>
  );
}

function NewProject() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const create = useCreateProject();
  const form = useForm<NewProjectForm>({
    resolver: zodResolver(NewProjectForm),
    defaultValues: { name: '', kind: 'home' },
  });

  const onSubmit = async ({ name, kind }: NewProjectForm) => {
    const model = await create.mutateAsync({
      name,
      kind,
      buildingName: t('projects.defaultBuilding'),
      floorName: t('projects.defaultFloor'),
    });
    await navigate(`/projects/${model.project.id}`);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('projects.new')}</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-4"
          onSubmit={(event) => void form.handleSubmit(onSubmit)(event)}
          noValidate
        >
          <div className="space-y-2">
            <Label htmlFor="project-name">{t('projects.name')}</Label>
            <Input
              id="project-name"
              aria-invalid={form.formState.errors.name ? true : undefined}
              {...form.register('name')}
            />
            {form.formState.errors.name && (
              <p className="text-sm text-destructive">{t('projects.nameRequired')}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="project-kind">{t('projects.kind')}</Label>
            <select
              id="project-kind"
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
              {...form.register('kind')}
            >
              {ProjectKind.options.map((kind) => (
                <option key={kind} value={kind}>
                  {t(`projectKind.${kind}`)}
                </option>
              ))}
            </select>
          </div>
          {create.isError && (
            <p className="text-sm text-destructive">{t('projects.createFailed')}</p>
          )}
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {t('projects.create')}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
