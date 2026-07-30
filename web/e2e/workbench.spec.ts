import { expect, test } from '@playwright/test';

test('opens the fictional vault and follows a wiki link', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Your work, in plain files.' })).toBeVisible();
  await expect(page.getByText('2', { exact: true }).first()).toBeVisible();

  await page.getByRole('button', { name: /Example research project/ }).first().click();
  await expect(page.getByRole('heading', { name: 'Example research project' })).toBeVisible();
  await page.getByRole('link', { name: 't-draft-method-note' }).click();
  await expect(page.getByRole('heading', { name: 'Draft the example methods note' })).toBeVisible();
});

test('edits and saves a Markdown note', async ({ page }) => {
  await page.goto('/');
  if (await page.getByRole('button', { name: 'Open navigation' }).isVisible()) {
    await page.getByRole('button', { name: 'Open navigation' }).click();
  }
  await page.getByRole('button', { name: 'Library' }).click();
  await page.getByRole('button', { name: /Example design note/ }).click();
  await page.getByRole('button', { name: 'Edit' }).click();
  const editor = page.getByLabel('Markdown source');
  await editor.fill(`${await editor.inputValue()}\n\nSaved by the fictional E2E test.\n`);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('button', { name: 'Saved' })).toBeDisabled();
});

test('mobile layout does not create page-level horizontal overflow', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile');
  await page.goto('/');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
});
