import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(webRoot);
const localPython = path.join(root, '.venv', 'bin', 'python');
const python = process.env.PM_TEST_PYTHON || (existsSync(localPython) ? localPython : 'python');

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['iPhone 13'] } },
  ],
  webServer: [
    {
      command: `"${python}" -m uvicorn server.app:app --host 127.0.0.1 --port 8765`,
      cwd: root,
      env: {
        ...process.env,
        PM_VAULT_ROOT: path.join(webRoot, '.tmp', 'e2e-vault'),
      },
      url: 'http://127.0.0.1:8765/api/health',
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: 'npm run dev -- --port 4173',
      cwd: webRoot,
      url: 'http://127.0.0.1:4173',
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
});
