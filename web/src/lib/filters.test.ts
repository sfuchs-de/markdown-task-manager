import { describe, expect, it } from 'vitest';
import { buildCommands } from './commands';
import { filterEntries, groupCounts } from './filters';
import { frontmatterFromContent, frontmatterScalar, replaceFrontmatter, setFrontmatterScalar } from './frontmatter';
import type { EntryFilters, VaultEntry } from '../types';

const entries: VaultEntry[] = [
  { path: 'tasks/active/t-one.md', filename: 't-one.md', title: 'One', kind: 'task', status: 'open', priority: '1', project: 'alpha', private: false },
  { path: 'projects/alpha/README.md', filename: 'README.md', title: 'Alpha', kind: 'project', status: 'active', private: false },
  { path: 'areas/wellness/log.md', filename: 'log.md', title: 'Health', kind: 'task', status: 'open', priority: '2', project: 'health', private: true },
];

const baseFilters: EntryFilters = {
  lens: 'all',
  query: '',
  domain: '',
  privateMode: false,
  collection: '',
  entryProject: '',
  noteRole: '',
  taskStatus: '',
  taskPriority: '',
  taskProject: '',
};

describe('filterEntries', () => {
  it('filters private entries when private mode is enabled', () => {
    expect(filterEntries(entries, { ...baseFilters, privateMode: true }).map((e) => e.title)).toEqual(['One', 'Alpha']);
  });

  it('applies task metadata filters only to task entries', () => {
    expect(filterEntries(entries, { ...baseFilters, lens: 'task', taskPriority: '1' }).map((e) => e.title)).toEqual(['One']);
  });

  it('applies organization filters', () => {
    const organized: VaultEntry[] = [
      ...entries,
      { path: 'projects/beta/modeling/model.md', filename: 'model.md', title: 'Model', kind: 'model-note', collection: 'project', project: 'beta', note_role: 'modeling', private: false },
      { path: 'docs/runbook.md', filename: 'runbook.md', title: 'Runbook', kind: 'documentation', collection: 'docs', note_role: 'documentation', private: false },
      { path: 'settings/time_planning.md', filename: 'time_planning.md', title: 'Time planning', kind: 'documentation', collection: 'settings', domain: 'system', private: false },
    ];
    expect(filterEntries(organized, { ...baseFilters, collection: 'docs' }).map((e) => e.title)).toEqual(['Runbook']);
    expect(filterEntries(organized, { ...baseFilters, entryProject: 'beta' }).map((e) => e.title)).toEqual(['Model']);
    expect(filterEntries(organized, { ...baseFilters, noteRole: 'modeling' }).map((e) => e.title)).toEqual(['Model']);
    expect(filterEntries(organized, { ...baseFilters, domain: 'system' }).map((e) => e.title)).toEqual(['Time planning']);
  });

  it('builds type lens counts', () => {
    expect(groupCounts(entries)).toEqual([
      { lens: 'task', count: 2 },
      { lens: 'project', count: 1 },
    ]);
  });
});

describe('frontmatter helpers', () => {
  it('replaces an existing frontmatter block', () => {
    const updated = replaceFrontmatter('---\nkind: task\n---\n# Old\n', { kind: 'task', status: 'done' });
    expect(updated).toContain('status: done');
    expect(updated).toContain('# Old');
  });

  it('reads and stages scalar frontmatter fields without dropping lists', () => {
    const source = '---\nkind: task\nstatus: open\npriority: 2\nrelated_to:\n  - "[[Sample Project]]"\n---\n# Task\n';
    const withCompleted = setFrontmatterScalar(source, 'completed', '2026-05-08');
    expect(frontmatterScalar(withCompleted, 'completed')).toBe('2026-05-08');
    expect(frontmatterFromContent(withCompleted).related_to).toEqual(['[[Sample Project]]']);
    expect(frontmatterFromContent(withCompleted).priority).toBe(2);
  });
});

describe('commands', () => {
  it('includes action and entry commands', () => {
    const commands = buildCommands(entries);
    expect(commands.some((command) => command.id === 'reload')).toBe(true);
    expect(commands.some((command) => command.id === 'open-overview')).toBe(true);
    expect(commands.some((command) => command.id === 'open-open-tasks')).toBe(true);
    expect(commands.some((command) => command.id === 'open-codex-backlog')).toBe(true);
    expect(commands.some((command) => command.id === 'open-projects')).toBe(true);
    expect(commands.some((command) => command.id === 'open-types')).toBe(true);
    expect(commands.some((command) => command.id === 'open-calendar')).toBe(true);
    expect(commands.some((command) => command.title === 'Open Calendar')).toBe(true);
    expect(commands.some((command) => command.id === 'open-time-plan')).toBe(true);
    expect(commands.some((command) => command.title === 'Open Time Plan')).toBe(true);
    expect(commands.some((command) => command.id === 'open-sync')).toBe(true);
    expect(commands.some((command) => command.id === 'github-sync-status')).toBe(true);
    expect(commands.some((command) => command.id === 'github-sync-push-dry-run')).toBe(true);
    expect(commands.some((command) => command.id === 'open-recent')).toBe(true);
    expect(commands.some((command) => command.id === 'open-library')).toBe(true);
    expect(commands.some((command) => command.id === 'toggle-nav')).toBe(true);
    expect(commands.some((command) => command.id === 'toggle-library')).toBe(true);
    expect(commands.some((command) => command.id === 'toggle-inspector')).toBe(true);
    expect(commands.some((command) => command.id === 'open:tasks/active/t-one.md')).toBe(true);
  });
});
