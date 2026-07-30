import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Overview, activityDayCountForWidth } from './App';
import { buildAdminCenter } from './lib/adminCenter';
import { buildOverview } from './lib/overview';
import { buildPerformanceEvaluation } from './lib/performanceEvaluation';
import type { ScholarStats, VaultEntry } from './types';

const today = new Date(2026, 4, 15);

const scholarFixture: ScholarStats = {
  available: true,
  name: 'Example Researcher',
  affiliation: 'Example Policy Lab',
  profile_url: 'https://scholar.google.com/citations?user=gvwsmeUAAAAJ&hl=en',
  updated: '2026-06-17',
  recent_since_year: 2021,
  metrics: {
    citations: { all: 124, recent: 120 },
    h_index: { all: 4, recent: 4 },
    i10_index: { all: 2, recent: 2 },
  },
  citations_by_year: { '2024': 47, '2025': 23 },
  top_publications: [{ title: 'Urban welfare: Tourism in Harbor City', year: 2021, citations: 61 }],
};

const entries: VaultEntry[] = [
  { path: 'tasks/active/admin.md', filename: 'admin.md', title: 'Complete annual example form', kind: 'task', status: 'open', priority: '1', due: '2026-05-18', project: 'operations-admin', domain: 'admin', properties: { admin_category: 'forms-approvals' }, private: false, modified_at: new Date(2026, 4, 15, 10).getTime() / 1000 },
  { path: 'tasks/active/admin-next.md', filename: 'admin-next.md', title: 'Send admin update', kind: 'task', status: 'open', priority: '2', due: '2026-05-20', project: 'operations-admin', domain: 'admin', properties: { admin_category: 'forms-approvals' }, private: false, modified_at: new Date(2026, 4, 15, 9).getTime() / 1000 },
  { path: 'tasks/active/research.md', filename: 'research.md', title: 'Prepare inequality slides', kind: 'task', status: 'active', priority: '1', due: '2026-05-16', project: 'harbor-flows', domain: 'research', private: false, modified_at: new Date(2026, 4, 14, 10).getTime() / 1000 },
  { path: 'tasks/active/research-next.md', filename: 'research-next.md', title: 'Review research appendix', kind: 'task', status: 'open', priority: '2', due: '2026-05-20', project: 'harbor-flows', domain: 'research', private: false, modified_at: new Date(2026, 4, 15, 8).getTime() / 1000 },
  { path: 'tasks/done/slides.md', filename: 'slides.md', title: 'Slides done', kind: 'task', status: 'done', priority: '1', due: '2026-05-15', project: 'harbor-flows', domain: 'research', private: false, modified_at: new Date(2026, 4, 15, 12).getTime() / 1000, properties: { completed: '2026-05-15' } },
];

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Overview Admin Center shortcut', () => {
  it('caps activity heatmap days to the available width', () => {
    expect(activityDayCountForWidth(120, 98)).toBe(19);
    expect(activityDayCountForWidth(420, 98)).toBe(69);
    expect(activityDayCountForWidth(0, 98)).toBe(56);
    expect(activityDayCountForWidth(30, 8)).toBe(8);
  });

  it('opens the Admin Center from the shortcut row', () => {
    const onOpenView = vi.fn();

    render(
      <Overview
        data={buildOverview(entries, true, today)}
        adminCenter={buildAdminCenter(entries, today)}
        performanceEvaluation={buildPerformanceEvaluation(entries)}
        scholar={null}
        focus="overview"
        loading={false}
        error=""
        privateMode
        onOpen={vi.fn()}
        onOpenProject={vi.fn()}
        onCreate={vi.fn()}
        onOpenPalette={vi.fn()}
        onOpenView={onOpenView}
        onPatchTaskMetadata={vi.fn()}
        patchingTaskPath=""
      />,
    );

    const shortcuts = screen.getByLabelText('Planning shortcuts');
    expect(screen.getByLabelText('Task activity heatmap')).toHaveTextContent('1 cleared');
    expect(screen.getByLabelText('Task activity heatmap')).toHaveTextContent('5 edited');
    expect(screen.getByLabelText('Task activity heatmap')).toHaveTextContent(/active days/);
    expect(within(screen.getByLabelText('Task activity heatmap')).getByRole('img', { name: /Recent activity from/ })).toBeVisible();
    fireEvent.click(within(shortcuts).getByRole('button', { name: /Admin risk/i }));
    expect(onOpenView).toHaveBeenCalledWith('admin-center');
  });

  it('renders the Google Scholar research-impact card from a snapshot', () => {
    render(
      <Overview
        data={buildOverview(entries, true, today)}
        adminCenter={buildAdminCenter(entries, today)}
        performanceEvaluation={buildPerformanceEvaluation(entries)}
        scholar={scholarFixture}
        focus="overview"
        loading={false}
        error=""
        privateMode
        onOpen={vi.fn()}
        onOpenProject={vi.fn()}
        onCreate={vi.fn()}
        onOpenPalette={vi.fn()}
        onOpenView={vi.fn()}
        onPatchTaskMetadata={vi.fn()}
        patchingTaskPath=""
      />,
    );

    const card = screen.getByLabelText('Research impact');
    expect(card).toHaveTextContent('124');
    expect(card).toHaveTextContent('h-index');
    expect(card).toHaveTextContent('Urban welfare: Tourism in Harbor City (2021)');
    expect(within(card).getByRole('link', { name: /View profile/i })).toHaveAttribute('href', scholarFixture.profile_url);
  });

  it('omits the Scholar card when no snapshot is available', () => {
    render(
      <Overview
        data={buildOverview(entries, true, today)}
        adminCenter={buildAdminCenter(entries, today)}
        performanceEvaluation={buildPerformanceEvaluation(entries)}
        scholar={null}
        focus="overview"
        loading={false}
        error=""
        privateMode
        onOpen={vi.fn()}
        onOpenProject={vi.fn()}
        onCreate={vi.fn()}
        onOpenPalette={vi.fn()}
        onOpenView={vi.fn()}
        onPatchTaskMetadata={vi.fn()}
        patchingTaskPath=""
      />,
    );

    expect(screen.queryByLabelText('Research impact')).not.toBeInTheDocument();
  });

  it('surfaces planning shortcuts, cross-lane summary, and switches the consolidated work queue', () => {
    const onOpen = vi.fn();
    render(
      <Overview
        data={buildOverview(entries, true, today)}
        adminCenter={buildAdminCenter(entries, today)}
        performanceEvaluation={buildPerformanceEvaluation(entries)}
        scholar={null}
        focus="overview"
        loading={false}
        error=""
        privateMode
        onOpen={onOpen}
        onOpenProject={vi.fn()}
        onCreate={vi.fn()}
        onOpenPalette={vi.fn()}
        onOpenView={vi.fn()}
        onPatchTaskMetadata={vi.fn()}
        patchingTaskPath=""
      />,
    );

    const activity = screen.getByLabelText('Task activity heatmap');
    const planningShortcuts = screen.getByLabelText('Planning shortcuts');
    const focusTasks = screen.getByLabelText('Focus tasks');
    const queue = screen.getByLabelText('Work Queue');
    expect(Boolean(activity.compareDocumentPosition(focusTasks) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    expect(Boolean(focusTasks.compareDocumentPosition(planningShortcuts) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    expect(Boolean(planningShortcuts.compareDocumentPosition(queue) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    expect(planningShortcuts).toHaveTextContent('Travel');
    expect(planningShortcuts).toHaveTextContent('Calendar');
    expect(planningShortcuts).toHaveTextContent('Time Plan');
    expect(planningShortcuts).toHaveTextContent('Admin risk');
    expect(screen.queryByLabelText('Key dashboard objects')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Centers')).not.toBeInTheDocument();
    const summary = within(queue).getByLabelText('Cross-lane work summary');
    expect(summary).toHaveTextContent('Research anchor');
    expect(summary).toHaveTextContent('Hard deadlines');
    expect(summary).toHaveTextContent('Admin bottleneck');
    expect(summary).toHaveTextContent('Waiting on others');
    fireEvent.click(within(summary).getByRole('button', { name: /Research anchor/i }));
    expect(onOpen).toHaveBeenCalledWith('tasks/active/research-next.md');
    const queueTabsSummary = within(queue).getByText('Queue tabs');
    expect(queueTabsSummary.closest('details')).not.toHaveAttribute('open');
    fireEvent.click(queueTabsSummary);
    expect(queueTabsSummary.closest('details')).toHaveAttribute('open');
    expect(within(queue).getByRole('tab', { name: /Research/i })).toHaveAttribute('aria-selected', 'true');
    expect(within(queue).getAllByText('Review research appendix')[0]).toBeVisible();

    fireEvent.click(within(queue).getByRole('tab', { name: /Admin/i }));
    expect(within(queue).getByRole('tab', { name: /Admin/i })).toHaveAttribute('aria-selected', 'true');
    expect(within(queue).getAllByText('Send admin update')[0]).toBeVisible();
  });
});
