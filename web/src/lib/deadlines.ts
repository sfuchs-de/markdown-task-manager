import type { VaultEntry } from '../types';

export type DeadlineType = 'hard' | 'soft';

function normalizedDeadlineType(value: unknown): DeadlineType | null {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'hard') return 'hard';
  if (normalized === 'soft') return 'soft';
  return null;
}

export function deadlineType(entry: VaultEntry): DeadlineType | null {
  const explicit = normalizedDeadlineType(entry.deadline_type || entry.properties?.deadline_type);
  if (explicit) return explicit;
  const kind = String(entry.kind || entry.type || '').toLowerCase();
  const path = String(entry.path || '');
  const isDeadlineManaged = kind === 'task' || kind === 'project' || path.startsWith('tasks/') || /^projects\/[^/]+\/README\.md$/.test(path);
  if (!isDeadlineManaged) return null;
  if (!(entry.due || entry.deadline || entry.date || entry.start_date)) return null;

  return 'soft';
}

export function deadlineTypeLabel(entry: VaultEntry): DeadlineType {
  return deadlineType(entry) || 'soft';
}

export function isHardDeadline(entry: VaultEntry): boolean {
  return deadlineType(entry) === 'hard';
}

export function isSoftDeadline(entry: VaultEntry): boolean {
  return deadlineType(entry) === 'soft';
}

export function nextDeadlineType(entry: VaultEntry): DeadlineType {
  return isHardDeadline(entry) ? 'soft' : 'hard';
}
