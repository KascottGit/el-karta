import { expect, type Page } from '@playwright/test';
import { magicLinkFor } from './mailpit';

/** Signs in with a magic link read from the local mail server and lands on the project list. */
export async function signIn(page: Page, email: string) {
  await page.goto('/');
  await expect(page).toHaveURL(/\/sign-in$/);
  await page.getByLabel('E-post').fill(email);
  await page.getByRole('button', { name: 'Skicka inloggningslänk' }).click();
  await expect(page.getByRole('status')).toContainText(email);
  await page.goto(await magicLinkFor(email));
  await expect(page.getByRole('heading', { name: 'Projekt', exact: true })).toBeVisible();
  await expect(page).not.toHaveURL(/code=/);
}
