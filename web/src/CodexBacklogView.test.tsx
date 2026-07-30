import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CodexBacklogView } from './App';
import { buildCodexBacklog } from './lib/codexInstructions';
import type { VaultEntry } from './types';

afterEach(() => {
  cleanup();
});

describe('CodexBacklogView', () => {
  it('renders queued task-local instructions and opens the source task', () => {
    const onOpen = vi.fn();
    const task: VaultEntry = {
      path: 'tasks/active/t-demo.md',
      filename: 't-demo.md',
      title: 'Review source task',
      kind: 'task',
      status: 'open',
      project: 'alpha',
      codex_instructions: [
        { status: 'queued', date: '2026-05-26', text: 'Pull the latest evidence and update next action.' },
      ],
    };

    render(<CodexBacklogView data={buildCodexBacklog([task])} onOpen={onOpen} />);

    expect(screen.getByRole('heading', { name: 'Codex Backlog' })).toBeVisible();
    expect(screen.getByText('Pull the latest evidence and update next action.')).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: /Review source task/i }));
    expect(onOpen).toHaveBeenCalledWith('tasks/active/t-demo.md');
  });
});
