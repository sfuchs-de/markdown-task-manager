import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyTaskMetadataUpdates, TaskQuickEdit, taskQuickEditFromEntry } from './TaskQuickEdit';
import type { VaultEntry } from './types';

const entry: VaultEntry = {
  path: 'tasks/active/t-sample.md',
  filename: 't-sample.md',
  title: 'Sample task',
  kind: 'task',
  status: 'open',
  priority: '1',
  due: '2026-05-10',
  deadline_type: 'hard',
  project: 'alpha',
  properties: { estimate_minutes: 60, assignee: 'Owner' },
  modified_at: 10,
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('TaskQuickEdit', () => {
  it('emits core metadata patches from quick controls', () => {
    const onPatch = vi.fn();

    render(<TaskQuickEdit task={taskQuickEditFromEntry(entry)} projectOptions={['alpha', 'beta']} onPatch={onPatch} />);

    fireEvent.change(screen.getByLabelText('Sample task status'), { target: { value: 'waiting' } });
    fireEvent.change(screen.getByLabelText('Sample task priority'), { target: { value: '2' } });
    fireEvent.click(screen.getByLabelText('Sample task urgent'));
    fireEvent.change(screen.getByLabelText('Sample task deadline type'), { target: { value: 'soft' } });
    fireEvent.change(screen.getByLabelText('Sample task due'), { target: { value: '2026-05-12' } });
    fireEvent.change(screen.getByLabelText('Sample task project'), { target: { value: 'beta' } });
    fireEvent.blur(screen.getByLabelText('Sample task project'));
    fireEvent.change(screen.getByLabelText('Sample task estimate minutes'), { target: { value: '90' } });
    fireEvent.blur(screen.getByLabelText('Sample task estimate minutes'));
    fireEvent.change(screen.getByLabelText('Sample task assignee'), { target: { value: 'Avery' } });
    fireEvent.blur(screen.getByLabelText('Sample task assignee'));

    expect(onPatch).toHaveBeenCalledWith('tasks/active/t-sample.md', { status: 'waiting' }, 10);
    expect(onPatch).toHaveBeenCalledWith('tasks/active/t-sample.md', { priority: '2' }, 10);
    expect(onPatch).toHaveBeenCalledWith('tasks/active/t-sample.md', { urgent: true }, 10);
    expect(onPatch).toHaveBeenCalledWith('tasks/active/t-sample.md', { deadline_type: 'soft' }, 10);
    expect(onPatch).toHaveBeenCalledWith('tasks/active/t-sample.md', { due: '2026-05-12' }, 10);
    expect(onPatch).toHaveBeenCalledWith('tasks/active/t-sample.md', { project: 'beta' }, 10);
    expect(onPatch).toHaveBeenCalledWith('tasks/active/t-sample.md', { estimate_minutes: '90' }, 10);
    expect(onPatch).toHaveBeenCalledWith('tasks/active/t-sample.md', { assignee: 'Avery' }, 10);
  });

  it('applies draft metadata updates without leaving cleared optional fields', () => {
    const next = applyTaskMetadataUpdates(
      { kind: 'task', status: 'open', priority: 1, urgent: true, due: '2026-05-10', deadline_type: 'hard', estimate_minutes: 60, assignee: 'Avery' },
      { status: 'done', priority: '', urgent: false, due: '', deadline_type: '', estimate_minutes: '', assignee: '' },
    );

    expect(next).toEqual({ kind: 'task', status: 'done' });
  });
});
