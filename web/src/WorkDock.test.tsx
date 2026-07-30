import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkDock } from './App';
import type { OverviewData } from './lib/overview';
import type { CalendarItem, WorkbenchData } from './lib/workbench';
import type { EntryFilters, GitHubSyncStatus, VaultEntry } from './types';

const task: VaultEntry = {
  path: 'tasks/active/t-journal-a.md',
  filename: 't-journal-a.md',
  title: 'Finish Journal A referee report',
  kind: 'task',
  status: 'open',
  priority: '1',
  due: '2026-05-13',
  project: 'referee-reports',
  private: false,
};

const eventEntry: VaultEntry = {
  path: 'dates/2026-05-18-bcn-meeting.md',
  filename: '2026-05-18-bcn-meeting.md',
  title: 'BCN meeting',
  kind: 'event',
  date: '2026-05-18',
  project: 'harbor-flows',
  private: false,
};

const calendarItem: CalendarItem = {
  entry: eventEntry,
  date: '2026-05-18',
  daysFromToday: 5,
  lane: 'Meetings',
  kind: 'event',
  highlight: 'meeting',
  highlightLabel: 'Meeting',
  highlightShortLabel: 'Meet',
  importance: 'normal',
};

const overviewData = {
  visibleEntries: [task, eventEntry],
  openTasks: [task],
  coauthorTasks: [],
  mustNotSlip: [task],
  priorityStack: { '1': [task], '2': [], '3': [] },
  projectReview: [],
  projectPulse: [],
  triage: { now: [task], next: [], waiting: [], review: [] },
  taskGroups: [],
  upcomingTravel: [],
  travelSummary: {
    nextTrip: null,
    urgentBlocker: null,
    approvalNeeded: 0,
    bookedUpcoming: 0,
    reimbursementItems: 0,
    totalEstimate: 0,
    totalActual: 0,
    unreimbursedActual: 0,
    grossActualUsd: 0,
    reimbursedUsd: 0,
    outOfPocketUsd: 0,
    expectedNetUsd: 0,
    pendingExpectedReimbursementUsd: 0,
    ytdActualUsd: 0,
    ytdReimbursedUsd: 0,
    ytdOutOfPocketUsd: 0,
    plannedUsd: 0,
    plannedReimbursableUsd: 0,
    ytdPlusPlannedUsd: 0,
    researchAccountLimitUsd: 12000,
    researchAccountYtdActualUsd: 0,
    researchAccountYtdReimbursedUsd: 0,
    researchAccountYtdPendingUsd: 0,
    researchAccountPlannedUsd: 0,
    researchAccountYtdPlusPlannedUsd: 0,
    researchAccountRemainingAfterPlannedUsd: 12000,
    researchAccountOverPlannedUsd: 0,
    researchAccountUsedPct: 0,
  },
  upcomingDeadlines: [],
  upcomingDates: [eventEntry],
  recentActivity: [],
  submissions: [],
  refereeReports: [],
  activityHeatmap: {
    startDate: '2026-02-15',
    endDate: '2026-05-18',
    days: [],
    totalEdits: 0,
    totalCompleted: 0,
    activeDays: 0,
    maxTotal: 0,
  },
} satisfies OverviewData;

const data = {
  visibleEntries: [task, eventEntry],
  filteredEntries: [task, eventEntry],
  openTasks: [task],
  taskBoard: [],
  taskTimeline: [],
  activeTasks: [task],
  taskQueue: [],
  projectReview: [],
  typeGroups: [],
  domainGroups: [],
  collectionGroups: [],
  noteRoleGroups: [],
  adminCenter: {} as WorkbenchData['adminCenter'],
  performanceEvaluation: {} as WorkbenchData['performanceEvaluation'],
  raManagement: {} as WorkbenchData['raManagement'],
  travelCenter: {} as WorkbenchData['travelCenter'],
  codexBacklog: {} as WorkbenchData['codexBacklog'],
  calendarItems: [calendarItem],
  calendarMonth: {} as WorkbenchData['calendarMonth'],
  recentEntries: [task, eventEntry],
} satisfies WorkbenchData;

const filters = {
  lens: 'all',
  query: '',
  domain: '',
  privateMode: true,
  collection: '',
  entryProject: '',
  noteRole: '',
  taskStatus: '',
  taskPriority: '',
  taskProject: '',
} satisfies EntryFilters;

const syncStatus = {
  enabled: true,
  configured: true,
  repo: 'example-org/private-vault',
  branch: 'main',
  token_configured: true,
  author_name: 'Research Workbench Automation',
  author_email: 'workbench-automation@example.invalid',
  remote: 'example-org/private-vault',
  sparse_dirs: ['projects', 'tasks'],
  vault_root: '/app/vault',
  git_available: true,
  vault_file_count: 123,
  remote_head: 'abcdef1234567890',
  errors: [],
} satisfies GitHubSyncStatus;

function renderDock(overrides: Partial<Parameters<typeof WorkDock>[0]> = {}) {
  const props = {
    activeView: 'overview' as const,
    data,
    overviewData,
    selectedEntry: null,
    selectedProjectPath: '',
    dirty: false,
    saving: false,
    filters,
    setFilters: vi.fn(),
    syncStatus,
    syncResult: null,
    syncChecking: false,
    onCheckSync: vi.fn(),
    onOpenSync: vi.fn(),
    onCreate: vi.fn(),
    onOpenPalette: vi.fn(),
    onSave: vi.fn(),
    ...overrides,
  };
  render(<WorkDock {...props} />);
  return props;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('WorkDock', () => {
  it('renders context without crowded focus or status controls', () => {
    renderDock();

    expect(screen.getByLabelText('Persistent dashboard actions')).toBeVisible();
    expect(screen.getByLabelText('Vault sync status')).toBeVisible();
    expect(screen.getByText('Overview')).toBeVisible();
    expect(screen.getByText('1 open tasks')).toBeVisible();
    expect(screen.queryByRole('button', { name: /Finish Journal A referee report/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /BCN meeting/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Plan' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Brief' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reload vault' })).not.toBeInTheDocument();
  });

  it('keeps only essential actions visible and groups creation in a menu', () => {
    const props = renderDock();

    fireEvent.click(screen.getByRole('button', { name: /Sync ready/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Open Sync panel' }));
    fireEvent.click(screen.getByRole('button', { name: 'New' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Task/ }));
    fireEvent.click(screen.getByRole('button', { name: 'New' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Note/ }));
    fireEvent.click(screen.getByRole('button', { name: 'New' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Project/ }));
    const privateToggle = screen.getByRole('button', { name: 'Private hidden in this view' });
    expect(privateToggle).toHaveAttribute('title', 'Display filter only: this does not encrypt files or remove private data from the loaded vault.');
    fireEvent.click(privateToggle);
    fireEvent.click(screen.getByRole('button', { name: 'Cmd' }));

    expect(props.onCreate).toHaveBeenCalledWith('task');
    expect(props.onCreate).toHaveBeenCalledWith('note');
    expect(props.onCreate).toHaveBeenCalledWith('project');
    expect(props.onCheckSync).toHaveBeenCalled();
    expect(props.onOpenSync).toHaveBeenCalled();
    expect(props.setFilters).toHaveBeenCalled();
    expect(props.onOpenPalette).toHaveBeenCalled();
  });

  it('summarizes dry-run sync results in the dock', () => {
    renderDock({
      syncResult: {
        ok: true,
        dry_run: true,
        changed: [{ status: 'M', path: 'tasks/active/a.md' }],
        copied: 123,
        deleted: 0,
        missing_from_vault: ['projects/old/README.md'],
        committed: false,
        pushed: false,
      },
    });

    expect(screen.getByText('2 pending')).toBeVisible();
    expect(screen.getByText('1 changed · 1 remote extras')).toBeVisible();
  });

  it('shows save only for dirty editor work', () => {
    const props = renderDock({ activeView: 'editor', dirty: true, selectedEntry: task });

    expect(screen.getByText('Finish Journal A referee report')).toBeVisible();
    expect(screen.getByText('task · tasks/active/t-journal-a.md')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Save draft from dock' }));
    expect(props.onSave).toHaveBeenCalled();
  });
});
