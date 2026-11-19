import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { signIn } from './auth';

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
  await expect(owner.getByRole('status').filter({ hasText: 'Projektet är delat.' })).toBeVisible();

  await editor.reload();
  await editor.getByRole('link', { name: new RegExp(projectName) }).click();
  await expect(editor.getByRole('heading', { name: projectName })).toBeVisible();
  await expect(editor.getByText('Plan 1')).toBeVisible();
  await editor.reload();
  await expect(editor.getByRole('heading', { name: projectName })).toBeVisible();
});
