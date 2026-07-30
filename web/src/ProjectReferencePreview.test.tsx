import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProjectUpdateBoard, type ProjectUpdateGroup } from './App';
import type { VaultEntry } from './types';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const groups: ProjectUpdateGroup[] = [];

const references: VaultEntry[] = [
  {
    path: 'projects/harbor-flows/next.md',
    filename: 'next.md',
    title: 'Harbor Flows Next',
    kind: 'project-note',
    project: 'harbor-flows',
    snippet: 'Review theory for the sufficient statistic, then clean the quantitative results.',
    private: false,
  },
  {
    path: 'projects/harbor-flows/progress.md',
    filename: 'progress.md',
    title: 'Harbor Flows Progress',
    kind: 'project-note',
    project: 'harbor-flows',
    snippet: 'June 16 sync: Methods Forum and Regional Methods checks are done; Avery is cleaning the repo.',
    private: false,
  },
];

describe('ProjectUpdateBoard reference previews', () => {
  it('shows project reference snippets and opens the selected file', () => {
    const onOpen = vi.fn();
    render(<ProjectUpdateBoard groups={groups} references={references} onOpen={onOpen} />);

    fireEvent.click(screen.getByText('Reference files'));

    expect(screen.getByText('Harbor Flows Next')).toBeVisible();
    expect(screen.getByText(/Review theory for the sufficient statistic/)).toBeVisible();
    expect(screen.getByText('Harbor Flows Progress')).toBeVisible();
    expect(screen.getByText(/Avery is cleaning the repo/)).toBeVisible();

    const progressCard = screen.getByText('Harbor Flows Progress').closest('article');
    expect(progressCard).not.toBeNull();
    fireEvent.click(within(progressCard as HTMLElement).getByRole('button', { name: 'Open' }));
    expect(onOpen).toHaveBeenCalledWith('projects/harbor-flows/progress.md');
  });
});
