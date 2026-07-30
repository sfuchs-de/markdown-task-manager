import { describe, expect, it } from 'vitest';
import { buildCalendarItems, buildCalendarMonth, buildCalendarWeek, buildCalendarYear, buildWorkbenchData } from './workbench';
import { entryDomain } from './domain';
import type { EntryFilters, VaultEntry } from '../types';

const today = new Date(2026, 4, 6);

const filters: EntryFilters = {
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
};

const entries: VaultEntry[] = [
  { path: 'tasks/active/late.md', filename: 'late.md', title: 'Late', kind: 'task', status: 'open', priority: '3', due: '2026-05-01', project: 'alpha', domain: 'research', private: false, modified_at: 20 },
  { path: 'tasks/active/p1.md', filename: 'p1.md', title: 'P1', kind: 'task', status: 'open', priority: '1', due: '2026-05-08', project: 'alpha', domain: 'research', private: false, modified_at: 30 },
  { path: 'tasks/active/done.md', filename: 'done.md', title: 'Done', kind: 'task', status: 'done', priority: '1', due: '2026-05-06', project: 'alpha', domain: 'research', private: false, modified_at: 40 },
  { path: 'tasks/cancelled/cancelled.md', filename: 'cancelled.md', title: 'Cancelled', kind: 'task', status: 'cancelled', priority: '1', due: '2026-05-07', project: 'alpha', domain: 'research', private: false, modified_at: 40 },
  { path: 'tasks/active/private.md', filename: 'private.md', title: 'Private', kind: 'task', status: 'open', priority: '1', due: '2026-05-06', project: 'alpha', domain: 'research', private: true, modified_at: 50 },
  { path: 'projects/alpha/README.md', filename: 'README.md', title: 'Alpha', kind: 'project', id: 'alpha', status: 'active', priority: '1', domain: 'research', private: false, modified_at: today.getTime() / 1000 },
  { path: 'projects/beta/README.md', filename: 'README.md', title: 'Beta', kind: 'project', id: 'beta', status: 'active', priority: '2', domain: 'research', private: false, modified_at: new Date(2026, 3, 1).getTime() / 1000 },
  { path: 'dates/visit.md', filename: 'visit.md', title: 'Visit', kind: 'event', date: '2026-05-10', private: false, modified_at: 10 },
  { path: 'notes/dated-note.md', filename: 'dated-note.md', title: 'Dated note', kind: 'note', date: '2026-05-09', private: false, modified_at: 10 },
];

describe('workbench view derivation', () => {
  it('hides private entries across workbench views', () => {
    const data = buildWorkbenchData(entries, filters, today);
    expect(data.visibleEntries.map((entry) => entry.title)).not.toContain('Private');
    expect(data.openTasks.map((entry) => entry.title)).not.toContain('Private');
    expect(data.recentEntries.map((entry) => entry.title)).not.toContain('Private');
  });

  it('sorts open tasks by priority before due date and excludes closed tasks', () => {
    const data = buildWorkbenchData(entries, { ...filters, privateMode: false }, today);
    expect(data.openTasks.map((entry) => entry.title)).toEqual(['Private', 'P1', 'Late']);
    expect(data.openTasks.map((entry) => entry.title)).not.toContain('Done');
    expect(data.openTasks.map((entry) => entry.title)).not.toContain('Cancelled');
  });

  it('filters open tasks to a single domain (admin view)', () => {
    const mixed: VaultEntry[] = [
      { path: 'tasks/active/referee.md', filename: 'referee.md', title: 'Referee report', kind: 'task', status: 'open', priority: '2', project: 'referee-reports', private: false },
      { path: 'tasks/active/travel.md', filename: 'travel.md', title: 'Book travel', kind: 'task', status: 'open', priority: '2', project: 'operations', private: false },
      { path: 'tasks/active/fs.md', filename: 'fs.md', title: 'Harbor Flows model', kind: 'task', status: 'open', priority: '2', project: 'harbor-flows', private: false, properties: { domain: 'research' } },
    ];
    const all = buildWorkbenchData(mixed, { ...filters, privateMode: false }, today).openTasks;
    const adminOnly = buildWorkbenchData(mixed, { ...filters, privateMode: false, domain: 'admin' }, today).openTasks;
    expect(all.some((task) => entryDomain(task) !== 'admin')).toBe(true);
    expect(adminOnly.every((task) => entryDomain(task) === 'admin')).toBe(true);
    expect(adminOnly.length).toBeLessThan(all.length);
  });

  it('buckets open tasks into Kanban columns', () => {
    const data = buildWorkbenchData([
      ...entries,
      { path: 'tasks/active/next.md', filename: 'next.md', title: 'Next', kind: 'task', status: 'open', priority: '3', due: '2026-05-15', private: false },
      { path: 'tasks/active/waiting.md', filename: 'waiting.md', title: 'Waiting', kind: 'task', status: 'waiting', priority: '2', due: '2026-05-07', private: false },
      { path: 'tasks/active/scheduled.md', filename: 'scheduled.md', title: 'Scheduled', kind: 'task', status: 'open', priority: '2', due: '2026-06-10', private: false },
      { path: 'tasks/active/later.md', filename: 'later.md', title: 'Later', kind: 'task', status: 'open', priority: '4', private: false },
    ], { ...filters, privateMode: false }, today);
    expect(data.taskBoard.find((column) => column.id === 'now')?.tasks.map((entry) => entry.title)).toEqual(['Private', 'P1', 'Late']);
    expect(data.taskBoard.find((column) => column.id === 'next')?.tasks.map((entry) => entry.title)).toEqual(['Next']);
    expect(data.taskBoard.find((column) => column.id === 'waiting')?.tasks.map((entry) => entry.title)).toEqual(['Waiting']);
    expect(data.taskBoard.find((column) => column.id === 'scheduled')?.tasks.map((entry) => entry.title)).toEqual(['Scheduled']);
    expect(data.taskBoard.find((column) => column.id === 'later')?.tasks.map((entry) => entry.title)).toEqual(['Later']);
  });

  it('builds open task runway, active, and queue views', () => {
    const data = buildWorkbenchData([
      ...entries,
      { path: 'tasks/active/next.md', filename: 'next.md', title: 'Next', kind: 'task', status: 'open', priority: '3', due: '2026-05-15', private: false },
      { path: 'tasks/active/week-three.md', filename: 'week-three.md', title: 'Week Three', kind: 'task', status: 'open', priority: '3', due: '2026-05-22', private: false },
      { path: 'tasks/active/week-four.md', filename: 'week-four.md', title: 'Week Four', kind: 'task', status: 'open', priority: '3', due: '2026-05-30', private: false },
      { path: 'tasks/active/waiting.md', filename: 'waiting.md', title: 'Waiting', kind: 'task', status: 'waiting', priority: '2', due: '2026-05-07', private: false },
      { path: 'tasks/active/scheduled.md', filename: 'scheduled.md', title: 'Scheduled', kind: 'task', status: 'open', priority: '2', due: '2026-06-10', private: false },
      { path: 'tasks/active/later.md', filename: 'later.md', title: 'Later', kind: 'task', status: 'open', priority: '4', private: false },
    ], { ...filters, privateMode: false }, today);

    expect(data.taskTimeline.find((group) => group.id === 'overdue')?.tasks.map((entry) => entry.title)).toEqual(['Late']);
    expect(data.taskTimeline.find((group) => group.id === 'week-1')?.tasks.map((entry) => entry.title)).toEqual(['Private', 'P1', 'Waiting']);
    expect(data.taskTimeline.find((group) => group.id === 'week-2')?.tasks.map((entry) => entry.title)).toEqual(['Next']);
    expect(data.taskTimeline.find((group) => group.id === 'week-3')?.tasks.map((entry) => entry.title)).toEqual(['Week Three']);
    expect(data.taskTimeline.find((group) => group.id === 'week-4')?.tasks.map((entry) => entry.title)).toEqual(['Week Four']);
    expect(data.taskTimeline.find((group) => group.id === 'later')?.tasks.map((entry) => entry.title)).toEqual(['Scheduled']);
    expect(data.taskTimeline.find((group) => group.id === 'undated')?.tasks.map((entry) => entry.title)).toEqual(['Later']);

    expect(data.activeTasks.map((entry) => entry.title)).toEqual(['Private', 'P1', 'Late', 'Next']);
    expect(data.taskQueue.find((group) => group.id === 'active')?.tasks.map((entry) => entry.title)).toEqual(['Private', 'P1', 'Late', 'Next']);
    expect(data.taskQueue.find((group) => group.id === 'queue')?.tasks.map((entry) => entry.title)).toEqual(['Later']);
    expect(data.taskQueue.find((group) => group.id === 'waiting')?.tasks.map((entry) => entry.title)).toEqual(['Waiting']);
    expect(data.taskQueue.find((group) => group.id === 'scheduled')?.tasks.map((entry) => entry.title)).toEqual(['Scheduled', 'Week Three', 'Week Four']);
  });

  it('groups types and marks stale projects', () => {
    const data = buildWorkbenchData(entries, filters, today);
    expect(data.typeGroups.find((group) => group.lens === 'task')?.count).toBe(4);
    expect(data.domainGroups.find((group) => group.lens === 'research')?.count).toBeGreaterThan(0);
    expect(data.typeGroups.find((group) => group.lens === 'project')?.count).toBe(2);
    expect(data.projectReview.find((item) => item.project.title === 'Alpha')?.openTaskCount).toBe(2);
    expect(data.projectReview.find((item) => item.project.title === 'Beta')?.stale).toBe(true);
  });

  it('orders calendar items chronologically and excludes closed tasks', () => {
    const data = buildWorkbenchData(entries, filters, today);
    expect(data.calendarItems.map((item) => item.entry.title).slice(0, 3)).toEqual(['Late', 'P1', 'Visit']);
    expect(data.calendarItems.map((item) => item.entry.title)).not.toContain('Done');
    expect(data.calendarItems.map((item) => item.entry.title)).not.toContain('Cancelled');
    expect(data.calendarItems.map((item) => item.entry.title)).not.toContain('Dated note');
  });

  it('excludes finished tasks from the calendar by folder even with a stale/open status', () => {
    const items = buildCalendarItems([
      { path: 'tasks/active/live.md', filename: 'live.md', title: 'Live task', kind: 'task', status: 'open', priority: '2', due: '2026-05-09', private: false },
      { path: 'tasks/done/stale-status.md', filename: 'stale-status.md', title: 'Done in folder, open status', kind: 'task', status: 'open', priority: '2', due: '2026-05-09', private: false },
      { path: 'tasks/cancelled/no-status.md', filename: 'no-status.md', title: 'Cancelled folder, no status', kind: 'task', priority: '2', due: '2026-05-09', private: false },
    ], today);
    const titles = items.map((item) => item.entry.title);
    expect(titles).toContain('Live task');
    expect(titles).not.toContain('Done in folder, open status');
    expect(titles).not.toContain('Cancelled folder, no status');
  });

  it('builds calendar months from an anchor date', () => {
    const items = buildCalendarItems(entries, today);
    const june = buildCalendarMonth(items, new Date(2026, 5, 15), today);

    expect(june.label).toBe('June 2026');
    expect(june.weeks).toHaveLength(6);
    expect(june.weeks[0][0].iso).toBe('2026-05-31');
  });

  it('builds calendar weeks starting on Sunday', () => {
    const items = buildCalendarItems(entries, today);
    const week = buildCalendarWeek(items, today, today);

    expect(week.start).toBe('2026-05-03');
    expect(week.end).toBe('2026-05-09');
    expect(week.days.map((day) => day.iso)).toEqual([
      '2026-05-03',
      '2026-05-04',
      '2026-05-05',
      '2026-05-06',
      '2026-05-07',
      '2026-05-08',
      '2026-05-09',
    ]);
  });

  it('expands multi-day calendar ranges across covered dates', () => {
    const rangeItems = buildCalendarItems([
      { path: 'dates/conference.md', filename: 'conference.md', title: 'Conference', kind: 'event', project: 'travel', start_date: '2026-06-09', end_date: '2026-06-11', private: false },
    ], today);

    expect(rangeItems.map((item) => item.date)).toEqual(['2026-06-09', '2026-06-10', '2026-06-11']);
    expect(rangeItems.map((item) => item.rangePosition)).toEqual(['start', 'middle', 'end']);
    expect(rangeItems[0].highlight).toBe('conference');
    expect(rangeItems[0].importance).toBe('major');
    expect(rangeItems[0].rangeStart).toBe('2026-06-09');
    expect(rangeItems[0].rangeEnd).toBe('2026-06-11');
  });

  it('classifies hard deadlines and travel items for calendar highlighting', () => {
    const highlightedItems = buildCalendarItems([
      { path: 'tasks/active/referee.md', filename: 'referee.md', title: 'Submit referee report', kind: 'task', status: 'open', priority: '1', due: '2026-05-12', deadline_type: 'hard', project: 'reports', private: false },
      { path: 'tasks/active/lakeside.md', filename: 'lakeside.md', title: 'Book Lakeside travel', kind: 'task', status: 'open', priority: '2', due: '2026-05-20', deadline_type: 'soft', project: 'operations', private: false },
    ], today);

    const hardDeadline = highlightedItems.find((item) => item.entry.title === 'Submit referee report');
    const travel = highlightedItems.find((item) => item.entry.title === 'Book Lakeside travel');

    expect(hardDeadline?.highlight).toBe('hard-deadline');
    expect(hardDeadline?.highlightLabel).toBe('Hard deadline');
    expect(hardDeadline?.importance).toBe('hard-deadline');
    expect(travel?.highlight).toBe('travel');
    expect(travel?.highlightShortLabel).toBe('Trip');
    expect(travel?.importance).toBe('major');
  });

  it('builds a lane-filtered calendar year', () => {
    const items = buildCalendarItems([
      ...entries,
      { path: 'dates/conference.md', filename: 'conference.md', title: 'Conference', kind: 'event', project: 'travel', start_date: '2026-06-09', end_date: '2026-06-11', private: false },
    ], today);
    const year = buildCalendarYear(items.filter((item) => item.lane === 'travel'), new Date(2026, 0, 1), today);

    expect(year.label).toBe('2026');
    expect(year.months).toHaveLength(12);
    expect(year.months[5].label).toBe('June 2026');
    expect(year.months[5].total_items).toBe(3);
    expect(year.total_items).toBe(3);
  });

  it('pushes noisy type groups below primary lenses', () => {
    const data = buildWorkbenchData([
      { path: 'notes/a.md', filename: 'a.md', title: 'A', private: false },
      { path: 'notes/b.md', filename: 'b.md', title: 'B', private: false },
      { path: 'tasks/active/c.md', filename: 'c.md', title: 'C', kind: 'task', status: 'open', private: false },
    ], filters, today);
    expect(data.typeGroups.map((group) => group.lens)).toEqual(['task', 'untyped']);
  });

  it('builds codex backlog from visible task instructions', () => {
    const data = buildWorkbenchData([
      {
        path: 'tasks/active/codex.md',
        filename: 'codex.md',
        title: 'Codex task',
        kind: 'task',
        status: 'open',
        private: false,
        codex_instructions: [{ status: 'queued', date: '2026-05-26', text: 'Update this task.' }],
      },
      {
        path: 'tasks/active/private-codex.md',
        filename: 'private-codex.md',
        title: 'Private Codex task',
        kind: 'task',
        status: 'open',
        private: true,
        codex_instructions: [{ status: 'queued', text: 'Hidden in private mode.' }],
      },
    ], filters, today);

    expect(data.codexBacklog.counts.queued).toBe(1);
    expect(data.codexBacklog.lanes[0].items[0].task.title).toBe('Codex task');
  });
});
