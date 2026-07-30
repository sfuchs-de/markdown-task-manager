import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, '..');
const appRoot = resolve(webRoot, '..');
const syntheticVault = resolve(webRoot, '.tmp', 'playwright-vault');
const emptyVault = resolve(webRoot, '.tmp', 'playwright-empty-vault');
const python = existsSync(resolve(appRoot, '.venv', 'bin', 'python'))
  ? resolve(appRoot, '.venv', 'bin', 'python')
  : 'python3';

function run(args, env = {}) {
  const result = spawnSync(python, args, {
    cwd: appRoot,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    throw new Error(`${python} ${args.join(' ')} failed with status ${result.status}`);
  }
}

rmSync(syntheticVault, { recursive: true, force: true });
rmSync(emptyVault, { recursive: true, force: true });
mkdirSync(emptyVault, { recursive: true });

run([
  resolve(appRoot, 'scripts', 'bootstrap_demo.py'),
  '--source',
  resolve(appRoot, 'example-vault'),
  '--target',
  syntheticVault,
  '--today',
  '2026-07-30',
]);

const renderEnv = {
  PM_VAULT_ROOT: syntheticVault,
  PM_OUTPUT_ROOT: resolve(syntheticVault, '.generated'),
  PM_RENDER_TIMESTAMP: '2026-07-30T12:00:00Z',
};
run([resolve(appRoot, 'scripts', 'sync_markdown.py')], renderEnv);
run([resolve(appRoot, 'scripts', 'render_static.py')], renderEnv);
