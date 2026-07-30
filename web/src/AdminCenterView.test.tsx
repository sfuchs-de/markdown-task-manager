import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminCenterView } from './App';
import { buildAdminCenter } from './lib/adminCenter';
import type { VaultEntry } from './types';

const today = new Date(2026, 4, 15);

const entries: VaultEntry[] = [
  { path: 'tasks/active/evaluation.md', filename: 'evaluation.md', title: 'Complete annual example form', kind: 'task', status: 'open', priority: '1', due: '2026-05-18', project: 'operations-admin', domain: 'admin', properties: { admin_category: 'forms-approvals' }, private: false },
  { path: 'tasks/active/policy.md', filename: 'policy.md', title: 'Prepare Supply Chain Pressure Index policy slides', kind: 'task', status: 'active', priority: '2', due: '2026-05-28', project: 'policy', domain: 'admin', properties: { admin_category: 'policy-service' }, private: false },
  { path: 'tasks/waiting/event.md', filename: 'event.md', title: 'Wait for Lakeside event venue reply', kind: 'task', status: 'waiting', priority: '3', due: '2026-07-01', project: 'personal-event', domain: 'admin', properties: { admin_category: 'life-admin' }, private: false },
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

describe('AdminCenterView', () => {
  it('renders metrics, lanes, and task quick actions', () => {
    const onOpen = vi.fn();
    const onPatch = vi.fn();
    const data = buildAdminCenter(entries, today);

    render(
      <AdminCenterView
        data={data}
        onOpen={onOpen}
        onPatchTaskMetadata={onPatch}
        patchingTaskPath=""
      />,
    );

    expect(screen.getByRole('heading', { name: 'Admin Center' })).toBeVisible();
    expect(screen.getByText('Urgent admin')).toBeVisible();
    expect(screen.getAllByText('Forms / approvals')[0]).toBeVisible();
    expect(screen.getByText('Policy + service')).toBeVisible();
    expect(screen.getAllByText('Life admin')[0]).toBeVisible();
    expect(screen.getByText('Complete annual example form')).toBeVisible();
    expect(screen.getByText('Prepare Supply Chain Pressure Index policy slides')).toBeVisible();

    fireEvent.click(screen.getByText('Prepare Supply Chain Pressure Index policy slides'));
    expect(onOpen).toHaveBeenCalledWith('tasks/active/policy.md');

    const taskCard = screen.getByText('Complete annual example form').closest('article') as HTMLElement;
    fireEvent.click(within(taskCard).getByText('More'));
    fireEvent.click(within(taskCard).getByRole('button', { name: 'Done' }));
    expect(onPatch).toHaveBeenCalledWith('tasks/active/evaluation.md', { status: 'done' });
  });
});
