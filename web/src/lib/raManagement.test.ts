import { describe, expect, it } from 'vitest';
import { buildRAManagement } from './raManagement';
import { buildWorkbenchData } from './workbench';
import type { EntryFilters, VaultEntry } from '../types';

const today = new Date(2026, 4, 11);

const filters: EntryFilters = {
  lens: 'all',
  query: '',
  domain: '',
  privateMode: true,
  collection: '',
  entryProject: '',
  noteRole: '',
  taskStatus: '',
  taskPriority: '',
  taskProject: '',
};

const entries: VaultEntry[] = [
  {
    path: 'notes/collaborators/people/avery-example.md',
    filename: 'avery-example.md',
    title: 'Avery Example',
    kind: 'collaborator-status',
    project: 'ra-monitoring',
    status: 'active',
    assignee: 'Avery Example',
    private: false,
    date: '2026-05-11',
    snippet: 'Avery is working on Harbor Flows.',
  },
  {
    path: 'notes/collaborators/assignments/avery-harbor-flows.md',
    filename: 'avery-harbor-flows.md',
    title: 'Avery assignment - Harbor Flows',
    kind: 'collaborator-assignment',
    project: 'ra-monitoring',
    status: 'active',
    assignee: 'Avery Example',
    private: false,
    date: '2026-05-06',
    snippet: 'licensed data and piracy pipeline.',
  },
  {
    path: 'notes/collaborators/checkins/2026-05-05-avery.md',
    filename: '2026-05-05-avery.md',
    title: 'Avery current work',
    kind: 'ra-checkin',
    project: 'ra-monitoring',
    private: false,
    date: '2026-05-05',
  },
  {
    path: 'notes/collaborators/communications/2026-05-11-avery-followup.md',
    filename: '2026-05-11-avery-followup.md',
    title: 'Avery consolidated follow-up draft',
    kind: 'collaborator-communication',
    project: 'ra-monitoring',
    area: 'collaborators',
    status: 'draft',
    private: false,
    properties: { module: 'collaborators' },
    date: '2026-05-11',
  },
  {
    path: 'tasks/active/send-avery.md',
    filename: 'send-avery.md',
    title: 'Send consolidated Avery follow-up',
    kind: 'task',
    project: 'ra-monitoring',
    area: 'collaborators',
    status: 'open',
    priority: '1',
    due: '2026-05-12',
    private: false,
    properties: { module: 'collaborators' },
  },
  {
    path: 'tasks/active/wait-avery.md',
    filename: 'wait-avery.md',
    title: 'Wait for Avery output paths',
    kind: 'task',
    project: 'harbor-flows',
    area: 'collaborators',
    status: 'waiting',
    priority: '3',
    due: '2026-05-24',
    next: 'Wait for Avery to reply with route output paths.',
    private: false,
    properties: { module: 'collaborators' },
  },
  {
    path: 'tasks/active/coauthor.md',
    filename: 'coauthor.md',
    title: 'Ask Casey Example for slides',
    kind: 'task',
    project: 'harbor-flows',
    status: 'open',
    priority: '2',
    due: '2026-05-15',
    assignee: 'Casey Example',
    private: false,
  },
  {
    path: 'notes/collaborators/people/private-ra.md',
    filename: 'private-ra.md',
    title: 'Private RA',
    kind: 'ra-status',
    project: 'ra-monitoring',
    status: 'active',
    private: true,
  },
];

describe('RA management derivation', () => {
  it('detects RA people and groups assignments, check-ins, communications, and matched tasks', () => {
    const data = buildRAManagement(entries, today);
    const avery = data.records.find((record) => record.slug === 'avery-example');

    expect(avery?.name).toBe('Avery Example');
    expect(avery?.assignments.map((assignment) => assignment.entry.title)).toEqual(['Avery assignment - Harbor Flows']);
    expect(avery?.latestCheckin?.title).toBe('Avery current work');
    expect(avery?.currentDraft?.title).toBe('Avery consolidated follow-up draft');
    expect(avery?.tasks.map((task) => task.title)).toEqual(['Send consolidated Avery follow-up', 'Wait for Avery output paths']);
    expect(data.allTasks.map((task) => task.title)).not.toContain('Ask Casey Example for slides');
  });

  it('separates Owner-managed follow-ups from waiting-on-RA tasks', () => {
    const data = buildRAManagement(entries, today);

    expect(data.needsOwner.map((task) => task.title)).toEqual(['Send consolidated Avery follow-up']);
    expect(data.waitingOnRA.map((task) => task.title)).toEqual(['Wait for Avery output paths']);
    expect(data.dueSoon.map((task) => task.title)).toEqual(['Send consolidated Avery follow-up', 'Wait for Avery output paths']);
  });

  it('respects workbench private-mode filtering', () => {
    const data = buildWorkbenchData(entries, filters, today);

    expect(data.raManagement.records.map((record) => record.name)).toEqual(['Avery Example']);
  });
});
