import type { EntryFilters, VaultEntry } from '../types';
import { entryDomain } from './domain';

export function entryLens(entry: VaultEntry): string {
  return entry.kind || entry.type || entry.note_role || entry.collection || 'untyped';
}

export function entryCollection(entry: VaultEntry): string {
  return entry.collection || entry.path.split('/')[0] || 'root';
}

export function isTask(entry: VaultEntry): boolean {
  return entryLens(entry).toLowerCase() === 'task';
}

export function filterEntries(entries: VaultEntry[], filters: EntryFilters): VaultEntry[] {
  const query = filters.query.trim().toLowerCase();
  return entries.filter((entry) => {
    if (filters.privateMode && entry.private) return false;
    const lens = entryLens(entry);
    if (filters.lens !== 'all' && lens !== filters.lens) return false;
    if (filters.domain && entryDomain(entry) !== filters.domain) return false;
    if (filters.collection && entryCollection(entry) !== filters.collection) return false;
    if (filters.entryProject && (entry.project || entry.area || '') !== filters.entryProject) return false;
    if (filters.noteRole && (entry.note_role || '') !== filters.noteRole) return false;
    if (query) {
      const haystack = [
        entry.title,
        entry.path,
        lens,
        entry.status,
        entry.project,
        entry.area,
        entry.collection,
        entry.note_role,
        entry.priority,
        entry.due,
        entry.date,
        entry.snippet,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    if (isTask(entry)) {
      if (filters.taskStatus && entry.status !== filters.taskStatus) return false;
      if (filters.taskPriority && String(entry.priority || '') !== filters.taskPriority) return false;
      if (filters.taskProject && entry.project !== filters.taskProject) return false;
    }
    return true;
  });
}

export function groupCounts(entries: VaultEntry[]): Array<{ lens: string; count: number }> {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    counts.set(entryLens(entry), (counts.get(entryLens(entry)) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([lens, count]) => ({ lens, count }))
    .sort((a, b) => b.count - a.count || a.lens.localeCompare(b.lens));
}

export function fieldCounts(entries: VaultEntry[], field: keyof VaultEntry): Array<{ lens: string; count: number }> {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    const value = entry[field];
    if (!value || Array.isArray(value) || typeof value === 'object') continue;
    counts.set(String(value), (counts.get(String(value)) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([lens, count]) => ({ lens, count }))
    .sort((a, b) => b.count - a.count || a.lens.localeCompare(b.lens));
}
