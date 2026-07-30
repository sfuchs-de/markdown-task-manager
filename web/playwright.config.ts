import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 8_000 },
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:18765',
    ...devices['Desktop Chrome'],
  },
  webServer: [
    {
      command: 'cd .. && PY=python3; if [ -x .venv/bin/python ]; then PY=.venv/bin/python; fi; PM_VAULT_ROOT=web/.tmp/playwright-vault PM_OUTPUT_ROOT=web/.tmp/playwright-vault/.generated $PY -m uvicorn server.app:app --host 127.0.0.1 --port 18765',
      url: 'http://127.0.0.1:18765/api/health',
      reuseExistingServer: false,
      timeout: 20_000,
    },
    {
      command: 'cd .. && PY=python3; if [ -x .venv/bin/python ]; then PY=.venv/bin/python; fi; PM_VAULT_ROOT=web/.tmp/playwright-empty-vault PM_OUTPUT_ROOT=web/.tmp/playwright-empty-vault/.generated $PY -m uvicorn server.app:app --host 127.0.0.1 --port 18766',
      url: 'http://127.0.0.1:18766/api/health',
      reuseExistingServer: false,
      timeout: 20_000,
    },
  ],
});
