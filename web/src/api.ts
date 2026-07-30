import type { VaultEntry, VaultFile } from './types';

const TOKEN_KEY = 'markdown-task-manager:token';

export function getToken(): string {
  return window.localStorage.getItem(TOKEN_KEY) || '';
}

export function setToken(token: string): void {
  if (token) window.localStorage.setItem(TOKEN_KEY, token);
  else window.localStorage.removeItem(TOKEN_KEY);
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch(path, { ...init, headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(String(payload.detail || `Request failed (${response.status})`));
    Object.assign(error, { status: response.status });
    throw error;
  }
  return payload as T;
}

export async function loadEntries(force = false): Promise<VaultEntry[]> {
  if (force) {
    const result = await request<{ entries: VaultEntry[] }>('/api/vault/reload', { method: 'POST' });
    return result.entries;
  }
  const result = await request<{ entries: VaultEntry[] }>('/api/vault/entries');
  return result.entries;
}

export function loadFile(path: string): Promise<VaultFile> {
  return request(`/api/vault/file?path=${encodeURIComponent(path)}`);
}

export function saveFile(file: VaultFile, content: string): Promise<VaultFile> {
  return request('/api/vault/file', {
    method: 'PUT',
    body: JSON.stringify({
      path: file.path,
      content,
      current_modified_at: file.modified_at,
    }),
  });
}

export function patchTask(
  file: VaultFile,
  updates: Record<string, unknown>,
): Promise<VaultFile> {
  return request('/api/vault/task-metadata', {
    method: 'PATCH',
    body: JSON.stringify({
      path: file.path,
      updates,
      current_modified_at: file.modified_at,
    }),
  });
}

export function createFile(kind: string, title: string): Promise<VaultFile> {
  return request('/api/vault/create', {
    method: 'POST',
    body: JSON.stringify({ kind, title }),
  });
}
