import { RepositoryError } from '@el-karta/data-supabase';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { z } from 'zod';
import { Button } from '@/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/card';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { useShareProject } from './queries';
import { useLoadedProject } from './use-loaded-project';

export function ProjectPage() {
  const { t } = useTranslation();
  const { projectId = '' } = useParams();
  const { model, failed } = useLoadedProject(projectId);

  if (failed) return <p className="text-destructive">{t('project.notFound')}</p>;
  if (!model) return <p className="text-muted-foreground">{t('common.loading')}</p>;

  const floors = Object.values(model.floors).sort((a, b) => a.sortOrder - b.sortOrder);
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header>
        <h1 className="text-xl font-semibold">{model.project.name}</h1>
        <p className="text-sm text-muted-foreground">{t(`projectKind.${model.project.kind}`)}</p>
      </header>
      <section className="space-y-2">
        <h2 className="font-semibold">{t('project.floors')}</h2>
        <ul className="divide-y rounded-lg border">
          {floors.map((floor) => (
            <li key={floor.id}>
              <Link
                to={`/projects/${projectId}/floors/${floor.id}`}
                className="flex justify-between px-4 py-3 hover:bg-muted"
              >
                <span>{floor.name}</span>
                <span className="text-sm text-muted-foreground">
                  {t('project.deviceCount', { count: Object.keys(floor.data.devices).length })}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
      <ShareProject projectId={projectId} />
    </div>
  );
}

const shareErrorKey = (error: Error) => {
  const code = error instanceof RepositoryError ? error.code : undefined;
  if (code === 'P0002') return 'share.unknownUser' as const;
  if (code === '42501') return 'share.notOwner' as const;
  return 'share.failed' as const;
};

const ShareForm = z.object({ email: z.email() });
type ShareForm = z.infer<typeof ShareForm>;

function ShareProject({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
  const share = useShareProject(projectId);
  const form = useForm<ShareForm>({
    resolver: zodResolver(ShareForm),
    defaultValues: { email: '' },
  });

  const onSubmit = ({ email }: ShareForm) => {
    share.mutate(
      { email, role: 'editor' },
      {
        onSuccess: () => {
          form.reset();
        },
      },
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('share.title')}</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-4"
          onSubmit={(event) => void form.handleSubmit(onSubmit)(event)}
          noValidate
        >
          <div className="space-y-2">
            <Label htmlFor="share-email">{t('share.email')}</Label>
            <Input
              id="share-email"
              type="email"
              inputMode="email"
              aria-invalid={form.formState.errors.email ? true : undefined}
              {...form.register('email')}
            />
            <p className="text-sm text-muted-foreground">{t('share.hint')}</p>
          </div>
          {share.isSuccess && <p role="status">{t('share.done')}</p>}
          {share.isError && (
            <p className="text-sm text-destructive">{t(shareErrorKey(share.error))}</p>
          )}
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {t('share.submit')}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
