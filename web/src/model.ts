import type { VaultEntry, View } from './types';

export function entryKind(entry: VaultEntry): string {
  return String(entry.kind || entry.type || '').toLowerCase();
}

export function isTask(entry: VaultEntry): boolean {
  return entryKind(entry) === 'task' || entry.path.startsWith('tasks/');
}

export function isProject(entry: VaultEntry): boolean {
  return entryKind(entry) === 'project' || /^projects\/[^/]+\/README\.md$/.test(entry.path);
}

export function visibleEntries(entries: VaultEntry[], view: View, query: string): VaultEntry[] {
  const normalized = query.trim().toLowerCase();
  return entries.filter((entry) => {
    if (view === 'tasks' && !isTask(entry)) return false;
    if (view === 'projects' && !isProject(entry)) return false;
    if (view === 'calendar' && !(entry.due || entryKind(entry) === 'event')) return false;
    if (view === 'overview') return false;
    if (!normalized) return true;
    return [entry.title, entry.path, entry.project, entry.status, entry.snippet]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(normalized));
  });
}

export function counts(entries: VaultEntry[]) {
  const tasks = entries.filter(isTask);
  const openTasks = tasks.filter((entry) => !['done', 'cancelled', 'archived'].includes(String(entry.status)));
  return {
    projects: entries.filter(isProject).length,
    tasks: openTasks.length,
    waiting: openTasks.filter((entry) => entry.status === 'waiting' || entry.status === 'blocked').length,
    notes: entries.length - tasks.length - entries.filter(isProject).length,
  };
}

export function wikiToMarkdown(source: string): string {
  return source.replace(
    /\[\[([^\]|#]+)(?:#([^\]|]+))?(?:\|([^\]]+))?\]\]/g,
    (_match, target: string, anchor: string | undefined, label: string | undefined) => {
      const href = `vault:${encodeURIComponent(target.trim())}${anchor ? `#${encodeURIComponent(anchor)}` : ''}`;
      return `[${(label || target).trim()}](${href})`;
    },
  );
}
