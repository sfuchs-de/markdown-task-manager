import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectTaskCard } from './App';
import type { VaultEntry } from './types';

const task: VaultEntry = {
  path: 'tasks/active/model.md',
  filename: 'model.md',
  title: 'Review model assumptions',
  kind: 'task',
  status: 'waiting',
  priority: '2',
  due: '2026-05-20',
  deadline_type: 'soft',
  project: 'harbor-flows',
  estimate_minutes: 90,
  assignee: 'Sample Assignee',
  modified_at: 99,
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 4, 18));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('ProjectTaskCard', () => {
  it('keeps project task cards minimal until metadata controls are expanded', () => {
    const onPatch = vi.fn();
    render(<ProjectTaskCard entry={task} onOpen={vi.fn()} onPatch={onPatch} disabled={false} />);

    expect(screen.getByText('Review model assumptions')).toBeVisible();
    expect(screen.getByText('harbor-flows')).toBeVisible();
    expect(screen.getByText('in 2d')).toBeVisible();
    expect(screen.getByText('1h 30m')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'waiting' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'P2' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('More'));
    fireEvent.click(screen.getByRole('button', { name: 'P2' }));
    expect(onPatch).toHaveBeenCalledWith(task.path, { priority: '3' }, 99);
  });
});
