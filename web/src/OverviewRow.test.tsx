import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OverviewRow } from './App';
import type { VaultEntry } from './types';

const task: VaultEntry = {
  path: 'tasks/active/slides.md',
  filename: 'slides.md',
  title: 'Prepare slides',
  kind: 'task',
  status: 'open',
  priority: '1',
  due: '2026-05-13',
  deadline_type: 'hard',
  project: 'harbor-flows',
  estimate_minutes: 180,
  modified_at: 42,
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 4, 11));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('OverviewRow', () => {
  it('shows only essential metadata by default and edits details from the drawer', () => {
    const onPatch = vi.fn();
    render(<OverviewRow entry={task} onOpen={vi.fn()} onPatch={onPatch} disabled={false} />);

    expect(screen.getByText('harbor-flows')).toBeVisible();
    expect(screen.getByText('in 2d')).toBeVisible();
    expect(screen.getByText('3h')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'P1' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'open' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('More'));

    fireEvent.click(screen.getByRole('button', { name: 'P1' }));
    expect(onPatch).toHaveBeenCalledWith(task.path, { priority: '2' }, 42);

    fireEvent.click(screen.getByRole('button', { name: 'Focus' }));
    expect(onPatch).toHaveBeenCalledWith(task.path, { urgent: true }, 42);

    fireEvent.click(screen.getByRole('button', { name: 'hard' }));
    expect(onPatch).toHaveBeenCalledWith(task.path, { deadline_type: 'soft' }, 42);

    fireEvent.click(screen.getByRole('button', { name: 'open' }));
    expect(onPatch).toHaveBeenCalledWith(task.path, { status: 'active' }, 42);

    vi.spyOn(window, 'prompt').mockReturnValue('2026-05-20');
    fireEvent.click(screen.getByRole('button', { name: 'in 2d' }));
    expect(onPatch).toHaveBeenCalledWith(task.path, { due: '2026-05-20' }, 42);
  });
});
