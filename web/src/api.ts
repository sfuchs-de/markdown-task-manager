import type { AppDiagnostics, AppHealth, GitHubSyncPushResult, GitHubSyncResetResult, GitHubSyncStatus, GitStatus, ScholarStats, TaskMetadataUpdates, TimePlanAgentContext, TimePlanResponse, VaultEntry, VaultFile, VaultMetadataUpdates, WorkbenchConfig } from './types';

const TOKEN_KEY = 'pm_app_token';

class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function getStoredToken(): string {
  return localStorage.getItem(TOKEN_KEY) || '';
}

export function storeToken(token: string): void {
  if (token.trim()) {
    localStorage.setItem(TOKEN_KEY, token.trim());
  } else {
    localStorage.removeItem(TOKEN_KEY);
  }
}

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const token = getStoredToken();
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  const response = await fetch(path, { ...init, headers });
  if (!response.ok) {
    let message = response.statusText;
    try {
      const body = await response.json();
      message = body.detail || message;
    } catch {
      // Keep status text.
    }
    throw new ApiError(response.status, message);
  }
  return response.json() as Promise<T>;
}

export async function getEntries(): Promise<VaultEntry[]> {
  const body = await apiFetch<{ entries: VaultEntry[] }>('/api/vault/entries');
  return body.entries;
}

export async function getHealth(): Promise<AppHealth> {
  return apiFetch<AppHealth>('/api/health');
}

export async function getConfig(): Promise<WorkbenchConfig> {
  return apiFetch<WorkbenchConfig>('/api/config');
}

export async function getScholarStats(): Promise<ScholarStats | null> {
  const stats = await apiFetch<ScholarStats>('/api/scholar');
  return stats.available ? stats : null;
}

export async function getDiagnostics(): Promise<AppDiagnostics> {
  return apiFetch<AppDiagnostics>('/api/diagnostics');
}

export async function getFile(path: string): Promise<VaultFile> {
  return apiFetch<VaultFile>(`/api/vault/file?path=${encodeURIComponent(path)}`);
}

export async function saveFile(path: string, content: string, currentModifiedAt?: number, moveTo?: string): Promise<VaultFile> {
  return apiFetch<VaultFile>('/api/vault/file', {
    method: 'PUT',
    body: JSON.stringify({ path, content, current_modified_at: currentModifiedAt, move_to: moveTo }),
  });
}

export async function patchTaskMetadata(
  path: string,
  updates: TaskMetadataUpdates,
  currentModifiedAt?: number,
): Promise<VaultFile> {
  return apiFetch<VaultFile>('/api/vault/task-metadata', {
    method: 'PATCH',
    body: JSON.stringify({ path, updates, current_modified_at: currentModifiedAt }),
  });
}

export async function patchVaultMetadata(
  path: string,
  updates: VaultMetadataUpdates,
  currentModifiedAt?: number,
): Promise<VaultFile> {
  return apiFetch<VaultFile>('/api/vault/metadata', {
    method: 'PATCH',
    body: JSON.stringify({ path, updates, current_modified_at: currentModifiedAt }),
  });
}

export async function reloadVault(): Promise<VaultEntry[]> {
  const body = await apiFetch<{ entries: VaultEntry[] }>('/api/vault/reload', { method: 'POST' });
  return body.entries;
}

export async function createEntry(kind: string, title: string): Promise<VaultFile> {
  return apiFetch<VaultFile>('/api/vault/create', {
    method: 'POST',
    body: JSON.stringify({ kind, title }),
  });
}

export async function getGitStatus(): Promise<GitStatus> {
  return apiFetch<GitStatus>('/api/git/status');
}

export async function getGitHubSyncStatus(): Promise<GitHubSyncStatus> {
  return apiFetch<GitHubSyncStatus>('/api/github-sync/status');
}

export async function pushGitHubSync({
  commitMessage = '',
  dryRun = true,
  deleteMissing = false,
}: {
  commitMessage?: string;
  dryRun?: boolean;
  deleteMissing?: boolean;
} = {}): Promise<GitHubSyncPushResult> {
  return apiFetch<GitHubSyncPushResult>('/api/github-sync/push', {
    method: 'POST',
    body: JSON.stringify({
      commit_message: commitMessage,
      dry_run: dryRun,
      delete_missing: deleteMissing,
    }),
  });
}

export async function resetGitHubSync({
  dryRun = true,
  backup = true,
  deleteExtra = false,
}: {
  dryRun?: boolean;
  backup?: boolean;
  deleteExtra?: boolean;
} = {}): Promise<GitHubSyncResetResult> {
  return apiFetch<GitHubSyncResetResult>('/api/github-sync/reset-from-github', {
    method: 'POST',
    body: JSON.stringify({
      dry_run: dryRun,
      backup,
      delete_extra: deleteExtra,
    }),
  });
}

export interface TimePlanQuery {
  date?: string;
  weekStart?: string;
  start?: string;
  capacityMinutes?: number;
  weekdays?: number;
  horizonDays?: number;
  adHoc?: string;
  includePrivate?: boolean;
}

function timePlanParams(query: TimePlanQuery = {}): URLSearchParams {
  const params = new URLSearchParams();
  if (query.date) params.set('date', query.date);
  if (query.weekStart) params.set('week_start', query.weekStart);
  if (query.start) params.set('start', query.start);
  if (query.capacityMinutes !== undefined) params.set('capacity_minutes', String(query.capacityMinutes));
  if (query.weekdays !== undefined) params.set('weekdays', String(query.weekdays));
  if (query.horizonDays !== undefined) params.set('horizon_days', String(query.horizonDays));
  if (query.adHoc) params.set('ad_hoc', query.adHoc);
  if (query.includePrivate !== undefined) params.set('include_private', String(query.includePrivate));
  return params;
}

export async function getTimePlan(query: TimePlanQuery = {}): Promise<TimePlanResponse> {
  const params = timePlanParams(query);
  const qs = params.toString();
  return apiFetch<TimePlanResponse>(`/api/time-plan${qs ? `?${qs}` : ''}`);
}

export async function getTimePlanAgentContext(query: TimePlanQuery = {}): Promise<TimePlanAgentContext> {
  const params = timePlanParams(query);
  const qs = params.toString();
  return apiFetch<TimePlanAgentContext>(`/api/time-plan/agent-context${qs ? `?${qs}` : ''}`);
}

export { ApiError };
