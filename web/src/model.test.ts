import { describe, expect, it } from 'vitest';
import { counts, visibleEntries, wikiToMarkdown } from './model';
import type { VaultEntry } from './types';

const entries: VaultEntry[] = [
  { path: 'projects/demo/README.md', filename: 'README.md', title: 'Demo', kind: 'project' },
  { path: 'tasks/active/a.md', filename: 'a.md', title: 'Draft note', kind: 'task', status: 'active' },
  { path: 'tasks/waiting/b.md', filename: 'b.md', title: 'Review checks', kind: 'task', status: 'waiting' },
  { path: 'notes/c.md', filename: 'c.md', title: 'Background', kind: 'note' },
];

describe('workbench model', () => {
  it('computes exact overview counts', () => {
    expect(counts(entries)).toEqual({ projects: 1, tasks: 2, waiting: 1, notes: 1 });
  });

  it('filters task search results', () => {
    expect(visibleEntries(entries, 'tasks', 'review').map((entry) => entry.title)).toEqual(['Review checks']);
  });

  it('turns wiki links into safe internal links', () => {
    expect(wikiToMarkdown('Open [[demo|the project]].')).toBe('Open [the project](vault:demo).');
  });
});
