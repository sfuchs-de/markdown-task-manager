import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RAManagementView } from './App';
import { buildWorkbenchData } from './lib/workbench';
import type { EntryFilters, VaultEntry } from './types';

const today = new Date(2026, 4, 11);

const filters: EntryFilters = {
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
];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(today);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('RAManagementView', () => {
  it('renders collaborator workload and opens the standalone collaborator page', () => {
    const onPatch = vi.fn();
    const openSpy = vi.spyOn(window, 'open').mockReturnValue({ focus: vi.fn() } as unknown as Window);
    const data = buildWorkbenchData(entries, filters, today).raManagement;

    render(
      <RAManagementView
        data={data}
        onOpen={vi.fn()}
        onPatchTaskMetadata={onPatch}
        patchingTaskPath=""
      />,
    );

    expect(screen.getByText('Collaborators')).toBeVisible();
    expect(screen.getAllByText('Avery Example')[0]).toBeVisible();
    // Deliverable QA detail is now collapsed into a drawer; the draft title still
    // surfaces in the always-visible "Current draft" link.
    expect(screen.getByText('Deliverable QA')).toBeVisible();
    const draftLink = screen.getByText('Current draft').closest('button') as HTMLElement;
    expect(within(draftLink).getByText('Avery consolidated follow-up draft')).toBeVisible();
    expect(screen.getAllByText('Send consolidated Avery follow-up')[0]).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Collaborator page' }));
    expect(openSpy).toHaveBeenCalledWith('/dashboard/collaborators/avery-example.html', '_blank');

    const taskCard = screen.getAllByText('Send consolidated Avery follow-up')[0].closest('article') as HTMLElement;
    fireEvent.click(within(taskCard).getByText('More'));
    fireEvent.click(within(taskCard).getByRole('button', { name: 'Done' }));
    expect(onPatch).toHaveBeenCalledWith('tasks/active/send-avery.md', { status: 'done' });
  });
});
