import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CalendarView } from './App';
import { buildWorkbenchData } from './lib/workbench';
import type { EntryFilters, VaultEntry } from './types';

const today = new Date(2026, 4, 6);

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
  { path: 'tasks/active/p1.md', filename: 'p1.md', title: 'P1', kind: 'task', status: 'open', priority: '1', due: '2026-05-08', project: 'alpha', private: false },
  { path: 'dates/conference.md', filename: 'conference.md', title: 'Conference', kind: 'event', project: 'travel', start_date: '2026-06-09', end_date: '2026-06-11', private: false },
];

function renderCalendar(sourceEntries: VaultEntry[] = entries) {
  return render(
    <CalendarView
      data={buildWorkbenchData(sourceEntries, filters, today)}
      onOpen={vi.fn()}
      onPatchTaskMetadata={vi.fn()}
      patchingTaskPath=""
    />,
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(today);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('CalendarView', () => {
  it('navigates month, week, and year views', () => {
    renderCalendar();

    expect(screen.getByRole('heading', { name: 'May 2026' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Next calendar range' }));
    expect(screen.getByRole('heading', { name: 'June 2026' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Previous calendar range' }));
    expect(screen.getByRole('heading', { name: 'May 2026' })).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Today' }));
    fireEvent.click(screen.getByRole('button', { name: 'Week' }));
    expect(screen.getByRole('heading', { name: 'May 3 - May 9, 2026' })).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Year' }));
    expect(screen.getByRole('heading', { name: '2026' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Open June 2026 month view' }));
    expect(screen.getByRole('heading', { name: 'June 2026' })).toBeVisible();
  });

  it('shows multi-day ranges in the calendar and deduped agenda', () => {
    renderCalendar();

    fireEvent.click(screen.getByRole('button', { name: 'Next calendar range' }));

    expect(screen.getAllByText('Conf')[0]).toBeVisible();
    expect(screen.getAllByText('Conference')[0]).toBeVisible();
    expect(screen.getByText('start')).toBeVisible();
    expect(screen.getByText('middle')).toBeVisible();
    expect(screen.getByText('end')).toBeVisible();
    expect(screen.getByText(/travel · 2026-06-09 - 2026-06-11/)).toBeVisible();
  });

  it('surfaces hard deadlines in the default event-focused scope', () => {
    renderCalendar([
      ...entries,
      { path: 'tasks/active/referee.md', filename: 'referee.md', title: 'Submit referee report', kind: 'task', status: 'open', priority: '1', due: '2026-05-08', deadline_type: 'hard', project: 'reports', private: false },
      { path: 'tasks/active/soft-admin.md', filename: 'soft-admin.md', title: 'Soft admin task', kind: 'task', status: 'open', priority: '2', due: '2026-05-08', deadline_type: 'soft', project: 'admin', private: false },
    ]);

    expect(screen.getAllByText('Submit referee report')[0]).toBeVisible();
    expect(screen.getAllByText('Hard deadline')[0]).toBeVisible();
    expect(screen.queryByText('Soft admin task')).not.toBeInTheDocument();
  });

  it('keeps the selected lane when switching calendar views', () => {
    renderCalendar([
      ...entries,
      { path: 'dates/workshop.md', filename: 'workshop.md', title: 'Workshop', kind: 'event', project: 'travel', date: '2026-05-08', private: false },
    ]);

    fireEvent.click(screen.getByText('Lanes'));
    fireEvent.click(screen.getByRole('button', { name: 'travel' }));

    expect(screen.getAllByText('Workshop')[0]).toBeVisible();
    expect(screen.queryByText('P1')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Week' }));
    expect(screen.getAllByText('Workshop')[0]).toBeVisible();
    expect(screen.queryByText('P1')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Year' }));
    expect(screen.getByRole('heading', { name: '2026' })).toBeVisible();
    expect(screen.getAllByText('Workshop')[0]).toBeVisible();
    expect(screen.queryByText('P1')).not.toBeInTheDocument();
  });

  it('defaults to an event-first calendar scope and can reveal all tasks', () => {
    renderCalendar([
      ...entries,
      { path: 'tasks/active/routine.md', filename: 'routine.md', title: 'Routine admin', kind: 'task', status: 'open', priority: '4', due: '2026-05-20', project: 'alpha', private: false },
    ]);

    expect(screen.queryByText('P1')).not.toBeInTheDocument();
    expect(screen.queryByText('Routine admin')).not.toBeInTheDocument();
    expect(screen.getAllByText('1 task hidden')[0]).toBeVisible();
    expect(screen.getByText(/2 routine tasks collapsed/)).toBeVisible();

    fireEvent.click(within(screen.getByLabelText('Calendar density')).getByRole('button', { name: 'Focus' }));
    expect(screen.getAllByText('P1')[0]).toBeVisible();

    fireEvent.click(within(screen.getByLabelText('Calendar density')).getByRole('button', { name: 'All' }));
    expect(screen.getAllByText('Routine admin')[0]).toBeVisible();
    expect(screen.queryByText('1 task hidden')).not.toBeInTheDocument();
  });
});
