import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OpenTasksView } from './App';
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
    path: 'tasks/active/slides.md',
    filename: 'slides.md',
    title: 'Prepare slides',
    kind: 'task',
    status: 'open',
    priority: '1',
    urgent: true,
    due: '2026-05-13',
    project: 'harbor-flows',
    estimate_minutes: 45,
    next: 'Turn the current paper into a conference deck and rehearse the core results.',
    private: false,
  },
  {
    path: 'tasks/waiting/forms.md',
    filename: 'forms.md',
    title: 'Wait for forms',
    kind: 'task',
    status: 'waiting',
    priority: '3',
    due: '2026-05-20',
    project: 'operations',
    next: 'Check back after the organizer replies.',
    private: false,
  },
];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(today);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('OpenTasksView', () => {
  it('defaults to grouped task preview cards', () => {
    const onOpen = vi.fn();

    const { container } = render(
      <OpenTasksView
        data={buildWorkbenchData(entries, filters, today)}
        filters={filters}
        setFilters={vi.fn()}
        taskProjects={['operations', 'harbor-flows']}
        onOpen={onOpen}
        onPatchTaskMetadata={vi.fn()}
        patchingTaskPath=""
      />,
    );

    expect(container.querySelector('.open-tasks-view')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Preview' })).toHaveClass('active');
    expect(screen.queryByText('Turn the current paper into a conference deck and rehearse the core results.')).not.toBeInTheDocument();
    expect(screen.queryByText('Check back after the organizer replies.')).not.toBeInTheDocument();
    const essentialPills = screen.getByLabelText('Essential metadata for Prepare slides');
    expect(within(essentialPills).getByText('harbor-flows')).toBeVisible();
    expect(within(essentialPills).getByText('in 2d')).toBeVisible();
    expect(within(essentialPills).getByText('45m')).toBeVisible();
    expect(within(essentialPills).queryByText('manual')).not.toBeInTheDocument();
    screen.queryAllByText('P1').forEach((node) => expect(node).not.toBeVisible());
    const expandControls = screen.getByLabelText('Show more controls for Prepare slides');
    expect(expandControls).toBeVisible();
    expect(screen.queryByText('Metadata')).not.toBeInTheDocument();

    fireEvent.click(expandControls);
    expect(screen.getByText('Metadata')).toBeVisible();
    expect(screen.getByText('Actions')).toBeVisible();

    fireEvent.click(screen.getByText('Prepare slides'));
    expect(onOpen).toHaveBeenCalledWith('tasks/active/slides.md');
  });
});
