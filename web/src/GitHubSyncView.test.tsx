import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GitHubSyncView } from './App';
import { getDiagnostics, getGitHubSyncStatus, pushGitHubSync, resetGitHubSync } from './api';
import type { AppDiagnostics, GitHubSyncStatus } from './types';

vi.mock('./api', async () => {
  const actual = await vi.importActual<typeof import('./api')>('./api');
  return {
    ...actual,
    getDiagnostics: vi.fn(),
    getGitHubSyncStatus: vi.fn(),
    pushGitHubSync: vi.fn(),
    resetGitHubSync: vi.fn(),
  };
});

const status: GitHubSyncStatus = {
  enabled: true,
  configured: true,
  repo: 'example-org/private-vault',
  branch: 'main',
  token_configured: true,
  author_name: 'Research Workbench Automation',
  author_email: 'workbench-automation@example.invalid',
  remote: 'example-org/private-vault',
  sparse_dirs: ['projects', 'tasks'],
  vault_root: '/app/vault',
  git_available: true,
  vault_file_count: 123,
  remote_head: 'abcdef1234567890',
  actions: {
    enabled: true,
    configured: true,
    token_configured: true,
    repo: 'example-org/private-vault',
    branch: 'main',
    latest: {
      id: 42,
      name: 'Vault QA',
      workflow_name: 'Vault QA',
      status: 'completed',
      conclusion: 'success',
      event: 'push',
      head_branch: 'main',
      head_sha: '1234567890abcdef',
      created_at: '2026-06-06T12:00:00Z',
      updated_at: '2026-06-06T12:04:00Z',
      html_url: 'https://github.com/example-org/private-vault/actions/runs/42',
    },
    runs: [],
    errors: [],
  },
  errors: [],
};

const diagnostics: AppDiagnostics = {
  app_commit: 'feedface12345678',
  vault_root: '/app/vault',
  vault_hash: {
    algorithm: 'sha256',
    value: 'deadbeef1234567890',
    file_count: 123,
  },
  entry_counts: {
    entries: 321,
    tasks: 178,
    projects: 23,
  },
  last_vault_scan_at: '2026-06-16T12:01:00Z',
  last_markdown_save_at: '2026-06-16T12:02:00Z',
  seed: {
    exists: true,
    path: '/app/vault/.vault_seed_manifest.json',
    generated_at: '2026-06-16T11:59:00Z',
    mode: 'copy-missing',
    seed_source: '/app',
    app_commit: 'feedface12345678',
    counts: { copied: 1 },
    error: '',
  },
  generated_cache: {
    fresh: true,
    source_file_count: 123,
    newest_source_modified_at: 1780000000,
    files: [
      { path: 'data/vault_entries.json', exists: true, modified_at: 1780000100, fresh: true },
      { path: 'dashboard/index.html', exists: true, modified_at: 1780000100, fresh: true },
    ],
  },
  hosted_service: {
    configured: true,
    url: 'https://research-workbench.onrender.com/api/health',
    checked_at: '2026-06-16T12:00:00Z',
    ok: true,
    status_code: 200,
    last_success_at: '2026-06-16T12:00:00Z',
    error: '',
  },
  github_sync: {
    enabled: true,
    configured: true,
    token_configured: true,
    git_available: true,
    repo: 'example-org/private-vault',
    branch: 'main',
    remote_head: 'abcdef1234567890',
    vault_file_count: 123,
    errors: [],
  },
  actions: {
    latest: status.actions?.latest ?? null,
    errors: [],
  },
};

const mockedDiagnostics = vi.mocked(getDiagnostics);
const mockedStatus = vi.mocked(getGitHubSyncStatus);
const mockedPush = vi.mocked(pushGitHubSync);
const mockedReset = vi.mocked(resetGitHubSync);

beforeEach(() => {
  mockedDiagnostics.mockResolvedValue(diagnostics);
  mockedStatus.mockResolvedValue(status);
  mockedPush.mockResolvedValue({
    ok: true,
    dry_run: true,
    changed: [{ status: 'M', path: 'tasks/active/a.md' }],
    copied: 123,
    deleted: 0,
    missing_from_vault: ['docs/old.md'],
    committed: false,
    pushed: false,
  });
  mockedReset.mockResolvedValue({
    ok: true,
    dry_run: true,
    missing: ['projects/new/README.md'],
    changed: ['tasks/active/a.md'],
    extra: [],
    copied: 0,
    deleted: 0,
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('GitHubSyncView', () => {
  it('renders hosted sync status and keeps real push disabled before dry-run', async () => {
    render(<GitHubSyncView />);

    expect(await screen.findByRole('heading', { name: 'Sync' })).toBeVisible();
    expect(screen.getByText('example-org/private-vault · main · 123 vault files')).toBeVisible();
    expect(screen.getAllByText('abcdef12').length).toBeGreaterThan(0);
    expect(screen.getByText('GitHub Actions')).toBeVisible();
    expect(screen.getByText('Diagnostics')).toBeVisible();
    expect(screen.getAllByText('feedface').length).toBeGreaterThan(0);
    expect(screen.getByText('deadbeef')).toBeVisible();
    expect(screen.getByText('321')).toBeVisible();
    expect(screen.getByText('178')).toBeVisible();
    expect(screen.getByText('23')).toBeVisible();
    expect(screen.getByText('2026-06-16T12:01:00Z')).toBeVisible();
    expect(screen.getByText('2026-06-16T12:02:00Z')).toBeVisible();
    expect(screen.getByText('2026-06-16T11:59:00Z · /app')).toBeVisible();
    expect(screen.getByText('fresh')).toBeVisible();
    expect(screen.getByText('copy-missing')).toBeVisible();
    expect(screen.getByText('online')).toBeVisible();
    expect(screen.getByText('https://research-workbench.onrender.com/api/health')).toBeVisible();
    expect(screen.getAllByText('main').length).toBeGreaterThan(0);
    expect(screen.getAllByText('success').length).toBeGreaterThan(0);
    expect(screen.getByText('Vault QA')).toBeVisible();
    expect(screen.getAllByText('12345678').length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: 'Open Actions run' })).toHaveAttribute('href', 'https://github.com/example-org/private-vault/actions/runs/42');
    expect(screen.getByRole('button', { name: /Push to GitHub/ })).toBeDisabled();
  });

  it('enables real push after a successful push dry-run', async () => {
    render(<GitHubSyncView />);
    await screen.findByText('example-org/private-vault · main · 123 vault files');

    fireEvent.click(screen.getByRole('button', { name: /Push dry-run/ }));

    await waitFor(() => expect(mockedPush).toHaveBeenCalledWith(expect.objectContaining({ dryRun: true })));
    expect(screen.getByText('Changed files · 1')).toBeVisible();
    expect(screen.getByRole('button', { name: /Push to GitHub/ })).toBeEnabled();

    mockedPush.mockResolvedValueOnce({
      ok: true,
      dry_run: false,
      changed: [{ status: 'M', path: 'tasks/active/a.md' }],
      copied: 123,
      deleted: 0,
      missing_from_vault: [],
      committed: true,
      pushed: true,
      head: '1234567890abcdef',
    });

    fireEvent.click(screen.getByRole('button', { name: /Push to GitHub/ }));
    await waitFor(() => expect(mockedPush).toHaveBeenCalledWith(expect.objectContaining({ dryRun: false })));
  });

  it('runs pull dry-run before enabling pull with backup', async () => {
    const onReloadVault = vi.fn();
    render(<GitHubSyncView onReloadVault={onReloadVault} />);
    await screen.findByText('example-org/private-vault · main · 123 vault files');

    expect(screen.getByRole('button', { name: /Pull with backup/ })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /Pull dry-run/ }));

    await waitFor(() => expect(mockedReset).toHaveBeenCalledWith(expect.objectContaining({ dryRun: true })));
    expect(screen.getByText('Missing locally · 1')).toBeVisible();
    expect(screen.getByRole('button', { name: /Pull with backup/ })).toBeEnabled();

    mockedReset.mockResolvedValueOnce({
      ok: true,
      dry_run: false,
      missing: [],
      changed: ['tasks/active/a.md'],
      extra: [],
      copied: 123,
      deleted: 0,
      backup: '.backups/github-sync-20260526-120000',
    });
    fireEvent.click(screen.getByRole('button', { name: /Pull with backup/ }));
    await waitFor(() => expect(onReloadVault).toHaveBeenCalled());
  });

  it('shows status errors without leaking token values', async () => {
    mockedStatus.mockRejectedValueOnce(new Error('Set PM_GITHUB_TOKEN before using GitHub sync'));

    render(<GitHubSyncView />);

    expect(await screen.findByText('Set PM_GITHUB_TOKEN before using GitHub sync')).toBeVisible();
    expect(screen.queryByText(/ghp_/)).not.toBeInTheDocument();
  });
});
