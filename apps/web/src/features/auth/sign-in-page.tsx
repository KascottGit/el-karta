import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Navigate } from 'react-router';
import { z } from 'zod';
import { authRedirectUrl, supabase } from '@/app/supabase';
import { Button } from '@/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/ui/card';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { useSession } from './session-context';

const SignInForm = z.object({ email: z.email() });
type SignInForm = z.infer<typeof SignInForm>;

export function SignInPage() {
  const { t } = useTranslation();
  const { session } = useSession();
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const form = useForm<SignInForm>({
    resolver: zodResolver(SignInForm),
    defaultValues: { email: '' },
  });

  if (session) return <Navigate to="/" replace />;

  const onSubmit = async ({ email }: SignInForm) => {
    setFailed(false);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: authRedirectUrl() },
    });
    if (error) setFailed(true);
    else setSentTo(email);
  };

  return (
    <Card className="mx-auto w-full max-w-sm">
      <CardHeader>
        <CardTitle>{t('auth.title')}</CardTitle>
        <CardDescription>{t('auth.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        {sentTo ? (
          <p role="status">{t('auth.sent', { email: sentTo })}</p>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(event) => void form.handleSubmit(onSubmit)(event)}
            noValidate
          >
            <div className="space-y-2">
              <Label htmlFor="email">{t('auth.email')}</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                inputMode="email"
                aria-invalid={form.formState.errors.email ? true : undefined}
                {...form.register('email')}
              />
              {form.formState.errors.email && (
                <p className="text-sm text-destructive">{t('auth.invalidEmail')}</p>
              )}
            </div>
            {failed && <p className="text-sm text-destructive">{t('auth.failed')}</p>}
            <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
              {t('auth.submit')}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
