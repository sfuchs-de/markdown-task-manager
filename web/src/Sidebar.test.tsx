import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Sidebar } from './App';
import type { VaultEntry } from './types';

const urgentTasks: VaultEntry[] = [
  { path: 'tasks/active/a.md', filename: 'a.md', title: 'Finish referee report', kind: 'task', status: 'open', priority: '1', due: '2026-05-15', deadline_type: 'hard', domain: 'research', private: false },
  { path: 'tasks/active/b.md', filename: 'b.md', title: 'Prepare inequality slides', kind: 'task', status: 'active', priority: '1', due: '2026-05-16', deadline_type: 'hard', domain: 'research', private: false },
  { path: 'tasks/active/c.md', filename: 'c.md', title: 'Send travel approval', kind: 'task', status: 'waiting', priority: '2', due: '2026-05-17', deadline_type: 'hard', domain: 'admin', area: 'travel', properties: { module: 'travel', trip_key: 'example-trip' }, private: false },
  { path: 'tasks/active/d.md', filename: 'd.md', title: 'Hidden fourth urgent task', kind: 'task', status: 'open', priority: '2', due: '2026-05-18', deadline_type: 'hard', domain: 'admin', private: false },
];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 4, 15));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('Sidebar focus tasks', () => {
  it('hides focus tasks on the overview to avoid duplicating Focus tasks', () => {
    render(
      <Sidebar
        activeView="overview"
        onView={vi.fn()}
        urgentTasks={urgentTasks}
        onOpen={vi.fn()}
      />,
    );

    expect(screen.queryByLabelText('Focus tasks')).not.toBeInTheDocument();
  });

  it('renders up to three focus tasks outside overview and opens tasks from the bottom section', () => {
    const onView = vi.fn();
    const onOpen = vi.fn();

    render(
      <Sidebar
        activeView="projects"
        onView={onView}
        urgentTasks={urgentTasks}
        onOpen={onOpen}
      />,
    );

    expect(screen.getByLabelText('Focus tasks')).toBeVisible();
    expect(screen.getByText('Finish referee report')).toBeVisible();
    expect(screen.getByText('due today')).toBeVisible();
    expect(screen.getByText('Prepare inequality slides')).toBeVisible();
    expect(screen.getByText('Send travel approval')).toBeVisible();
    expect(screen.queryByText('Hidden fourth urgent task')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Finish referee report/ }));
    expect(onOpen).toHaveBeenCalledWith('tasks/active/a.md');

    fireEvent.click(within(screen.getByLabelText('Focus tasks')).getByRole('button', { name: 'All tasks' }));
    expect(onView).toHaveBeenCalledWith('open-tasks');

  });

  it('shows a quiet empty state when there are no focus tasks', () => {
    render(
      <Sidebar
        activeView="projects"
        onView={vi.fn()}
        urgentTasks={[]}
        onOpen={vi.fn()}
      />,
    );

    expect(screen.getByText('No focus tasks.')).toBeVisible();
  });
});
