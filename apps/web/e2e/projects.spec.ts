import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { magicLinkFor } from './mailpit';

async function signIn(page: Page, email: string) {
  await page.goto('/');
  await expect(page).toHaveURL(/\/sign-in$/);
  await page.getByLabel('E-post').fill(email);
  await page.getByRole('button', { name: 'Skicka inloggningslänk' }).click();
  await expect(page.getByRole('status')).toContainText(email);
  await page.goto(await magicLinkFor(email));
  await expect(page.getByRole('heading', { name: 'Projekt', exact: true })).toBeVisible();
  await expect(page).not.toHaveURL(/code=/);
}

test('two people sign in with magic links, and a shared project shows up for the second one', async ({
  browser,
}) => {
  const run = randomUUID().slice(0, 8);
  const ownerEmail = `owner-${run}@test.local`;
  const editorEmail = `editor-${run}@test.local`;
  const projectName = `E2E-villa ${run}`;

  const owner = await (await browser.newContext()).newPage();
  const editor = await (
    await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    })
  ).newPage();

  await signIn(owner, ownerEmail);
  await signIn(editor, editorEmail);
  await expect(editor.getByText('Inga projekt ännu.')).toBeVisible();

  await owner.getByLabel('Namn').fill(projectName);
  await owner.getByLabel('Typ av byggnad').selectOption('home');
  await owner.getByRole('button', { name: 'Skapa projekt' }).click();
  await expect(owner.getByRole('heading', { name: projectName })).toBeVisible();
  await expect(owner.getByText('Plan 1')).toBeVisible();
  await expect(owner.getByText('0 enheter')).toBeVisible();

  const shareEmail = owner.getByLabel('E-post till den du vill dela med');
  await shareEmail.fill(`nobody-${run}@test.local`);
  await owner.getByRole('button', { name: 'Dela' }).click();
  await expect(
    owner.getByText('Ingen användare med den e-postadressen har loggat in ännu.'),
  ).toBeVisible();
  await shareEmail.fill(editorEmail);
  await owner.getByRole('button', { name: 'Dela' }).click();
  await expect(owner.getByRole('status')).toHaveText('Projektet är delat.');

  await editor.reload();
  await editor.getByRole('link', { name: new RegExp(projectName) }).click();
  await expect(editor.getByRole('heading', { name: projectName })).toBeVisible();
  await expect(editor.getByText('Plan 1')).toBeVisible();
  await editor.reload();
  await expect(editor.getByRole('heading', { name: projectName })).toBeVisible();
});
