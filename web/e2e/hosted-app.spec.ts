import { expect, test } from '@playwright/test';

const syntheticTaskPath = 'tasks/active/t-draft-method-note.md';

test('exercises every configured module with the synthetic vault', async ({ page }) => {
  const browserErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text());
  });
  page.on('pageerror', (error) => browserErrors.push(error.message));

  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto('/');
  await expect(page).toHaveTitle('Research Workbench');
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();

  const configResponse = await page.request.get('/api/config');
  expect(configResponse.ok()).toBeTruthy();
  const config = await configResponse.json() as {
    application_name: string;
    owner_aliases: string[];
    modules: Record<string, { enabled: boolean; label: string }>;
  };
  expect(config.application_name).toBe('Research Workbench');
  expect(config.owner_aliases).toEqual(['Owner', 'me', 'self']);
  expect(config.modules.github_sync.enabled).toBe(false);

  const sidebar = page.locator('.sidebar');
  const modules = [
    { button: 'Tasks', heading: 'Open Tasks', expected: 'Draft the example methods note' },
    { button: 'Projects', heading: 'Projects', expected: 'Harbor Flows' },
    { button: 'Calendar', heading: 'Calendar', expected: 'Agenda' },
    { button: 'Time Plan', heading: 'Time Plan', expected: 'Daily Plan' },
    { button: 'Admin Center', heading: 'Admin Center', expected: 'Submit the fictional annual form' },
    { button: 'Performance Review', heading: 'Performance Evaluation', expected: 'Harbor Flows methods note' },
    { button: 'Travel Center', heading: 'Travel Center', expected: 'Methods Summit' },
    { button: 'Collaborators', heading: 'Collaborators', expected: 'Avery Example' },
    { button: 'Wellness', heading: 'Wellness', expected: 'Redacted wellness summary is on.' },
    { button: 'Library', heading: 'Library', expected: 'Avery Example assignment' },
  ];

  for (const module of modules) {
    const button = sidebar.getByRole('button', { name: module.button, exact: true });
    await button.scrollIntoViewIfNeeded();
    await button.click();
    await expect(page.getByRole('heading', { name: module.heading, exact: true })).toBeVisible();
    await expect(page.getByText(module.expected, { exact: false }).first()).toBeVisible();
  }

  const staticResponse = await page.request.get('/dashboard/projects/harbor-flows.html');
  expect(staticResponse.ok()).toBeTruthy();
  expect(await staticResponse.text()).toContain('Harbor Flows');
  const collaboratorResponse = await page.request.get('/dashboard/collaborators/avery-example.html');
  expect(collaboratorResponse.ok()).toBeTruthy();
  expect(await collaboratorResponse.text()).toContain('Avery Example');

  const manifestResponse = await page.request.get('/manifest.webmanifest');
  expect(manifestResponse.ok()).toBeTruthy();
  const manifest = await manifestResponse.json() as { name: string; display: string };
  expect(manifest).toMatchObject({ name: 'Research Workbench', display: 'standalone' });
  expect(browserErrors).toEqual([]);
});

test('edits a Markdown task and reloads the persisted content', async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 800 });
  await page.goto('/');
  await page.locator('.sidebar').getByRole('button', { name: 'Tasks', exact: true }).click();
  await page.getByRole('button', { name: 'List', exact: true }).click();
  await page.locator('.task-open-button').filter({ hasText: 'Draft the example methods note' }).click();
  await expect(page.locator('header').getByRole('heading', { name: 'Draft the example methods note' })).toBeVisible();

  const originalResponse = await page.request.get(`/api/vault/file?path=${syntheticTaskPath}`);
  expect(originalResponse.ok()).toBeTruthy();
  const original = await originalResponse.json() as { content: string };

  await page.getByRole('button', { name: 'Split', exact: true }).click();
  const editor = page.locator('.cm-content');
  await editor.fill(`${original.content}\n\nPlaywright persisted this synthetic edit.\n`);
  await page.getByRole('button', { name: /^Save$/ }).click();
  await expect(page.getByRole('button', { name: 'Saved' })).toBeVisible();

  await page.reload();
  const savedResponse = await page.request.get(`/api/vault/file?path=${syntheticTaskPath}`);
  const saved = await savedResponse.json() as { content: string };
  expect(saved.content).toContain('Playwright persisted this synthetic edit.');
});

test('keeps private wellness content redacted until the display filter is changed', async ({ page }) => {
  await page.goto('/');
  await page.locator('.sidebar').getByRole('button', { name: 'Wellness', exact: true }).click();
  await expect(page.getByText('Redacted wellness summary is on.')).toBeVisible();
  await expect(page.getByText('Complete the weekly wellness review')).toHaveCount(0);

  await page.getByRole('button', { name: /Private hidden in this view/ }).click();
  await expect(page.getByText('Private wellness details are visible.')).toBeVisible();
  await expect(page.getByText('Complete the weekly wellness review').first()).toBeVisible();
});

test('has labeled controls and no horizontal overflow on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
  for (const label of ['Overview', 'Tasks', 'Time', 'New', 'More']) {
    await expect(page.locator('.mobile-bottom-bar').getByRole('button', { name: label })).toBeVisible();
  }

  const unlabeledControls = await page.evaluate(() => (
    [...document.querySelectorAll('button, a, input, select, textarea')]
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
      })
      .filter((element) => {
        const text = (element.textContent || '').trim();
        const aria = element.getAttribute('aria-label') || element.getAttribute('aria-labelledby') || '';
        const title = element.getAttribute('title') || '';
        const placeholder = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement ? element.placeholder : '';
        return !(text || aria || title || placeholder);
      })
      .map((element) => element.outerHTML)
      .slice(0, 10)
  ));
  expect(unlabeledControls).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2)).toBe(false);
});

test('renders useful empty states against an empty vault', async ({ page }) => {
  await page.goto('http://127.0.0.1:18766/');
  await expect(page).toHaveTitle('Research Workbench');
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
  await expect(page.getByText('No focus tasks.')).toBeVisible();

  await page.locator('.sidebar').getByRole('button', { name: 'Tasks', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Open Tasks' })).toBeVisible();
  await expect(page.getByText('No open tasks match these filters.').first()).toBeVisible();

  await page.locator('.sidebar').getByRole('button', { name: 'Projects', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();
  await page.locator('.sidebar').getByRole('button', { name: 'Calendar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Calendar' })).toBeVisible();
});
