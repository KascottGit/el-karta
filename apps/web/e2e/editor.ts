import { expect, type Page } from '@playwright/test';
import { worldToPage } from './app-modules';
import { signIn } from './auth';

/** Opens a synthetic project in the editor and returns the plan-to-page conversion of its first view. */
export async function openSynthetic(page: Page, size: 'small' | 'medium' | 'large', query = '') {
  await page.goto(`/dev/synthetic/${size}${query}`);
  await expect(page.getByTestId('floor-editor-canvas').locator('canvas').first()).toBeVisible();
  return worldToPage(page);
}

/** Signs in as a new user, creates a project and opens its first floor in the editor. */
export async function openNewProjectEditor(page: Page, user: { email: string; project: string }) {
  await signIn(page, user.email);
  await page.getByLabel('Namn').fill(user.project);
  await page.getByRole('button', { name: 'Skapa projekt' }).click();
  await page.getByRole('link', { name: /Plan 1/ }).click();
  await expect(page.getByTestId('floor-editor-canvas').locator('canvas').first()).toBeVisible();
}
