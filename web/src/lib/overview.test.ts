import { describe, expect, it } from 'vitest';
import { buildActivityHeatmap, buildOverview, buildProjectReview, buildUpcomingDeadlines, focusReason, isOpenTask, sortUrgentTasks } from './overview';
import type { VaultEntry } from '../types';

const today = new Date(2026, 4, 6);

const entries: VaultEntry[] = [
  { path: 'tasks/active/overdue.md', filename: 'overdue.md', title: 'Overdue', kind: 'task', status: 'open', priority: '3', due: '2026-05-01', deadline_type: 'hard', project: 'alpha', private: false, modified_at: 1 },
  { path: 'tasks/active/today.md', filename: 'today.md', title: 'Today Due', kind: 'task', status: 'open', priority: '2', due: '2026-05-06', deadline_type: 'hard', project: 'alpha', private: false, modified_at: 1 },
  { path: 'tasks/active/p1.md', filename: 'p1.md', title: 'P1 No Date', kind: 'task', status: 'open', priority: '1', project: 'alpha', private: false, modified_at: 2 },
  { path: 'tasks/active/next.md', filename: 'next.md', title: 'Next Week', kind: 'task', status: 'open', priority: '2', due: '2026-05-13', project: 'alpha', private: false, modified_at: 2 },
  { path: 'tasks/active/waiting.md', filename: 'waiting.md', title: 'Waiting Reply', kind: 'task', status: 'waiting', priority: '1', due: '2026-05-06', project: 'alpha', private: false, modified_at: 2 },
  { path: 'tasks/active/private.md', filename: 'private.md', title: 'Private', kind: 'task', status: 'open', priority: '1', due: '2026-05-06', project: 'alpha', private: true, modified_at: 3 },
  { path: 'tasks/active/done.md', filename: 'done.md', title: 'Done', kind: 'task', status: 'done', priority: '1', due: '2026-05-06', project: 'alpha', private: false, modified_at: 4 },
  { path: 'tasks/active/archived-waiting.md', filename: 'archived-waiting.md', title: 'Archived Waiting', kind: 'task', status: 'archived', priority: '1', due: '2026-05-06', project: 'alpha', private: false, modified_at: 4 },
  { path: 'projects/alpha/README.md', filename: 'README.md', title: 'Alpha', kind: 'project', id: 'alpha', status: 'active', priority: '1', private: false, modified_at: today.getTime() / 1000 },
  { path: 'projects/beta/README.md', filename: 'README.md', title: 'Beta', kind: 'project', id: 'beta', status: 'active', priority: '2', private: false, modified_at: new Date(2026, 3, 1).getTime() / 1000 },
];

describe('overview helpers', () => {
  it('sorts urgent tasks by priority before due date', () => {
    const sorted = sortUrgentTasks(entries.filter(isOpenTask), today);
    expect(sorted.map((entry) => entry.title).slice(0, 3)).toEqual(['Private', 'Waiting Reply', 'P1 No Date']);
  });

  it('sorts explicit focus tasks before regular urgent tasks in shared urgent lists', () => {
    const sorted = sortUrgentTasks([
      { path: 'tasks/active/p1.md', filename: 'p1.md', title: 'P1 regular', kind: 'task', status: 'open', priority: '1', due: '2026-05-06', project: 'alpha', private: false },
      { path: 'tasks/active/focus-two.md', filename: 'focus-two.md', title: 'Focus rank two', kind: 'task', status: 'open', priority: '4', focus_rank: 2, project: 'alpha', private: false },
      { path: 'tasks/active/focus-one.md', filename: 'focus-one.md', title: 'Focus rank one', kind: 'task', status: 'open', priority: '4', properties: { focus_rank: 1 }, project: 'alpha', private: false },
      { path: 'tasks/active/manual.md', filename: 'manual.md', title: 'Manual focus', kind: 'task', status: 'open', priority: '3', urgent: true, project: 'alpha', private: false },
    ], today);

    expect(sorted.map((entry) => entry.title)).toEqual(['Focus rank one', 'Focus rank two', 'Manual focus', 'P1 regular']);
  });

  it('hides private entries from overview data in private mode', () => {
    const overview = buildOverview(entries, true, today);
    expect(overview.mustNotSlip.map((entry) => entry.title)).not.toContain('Private');
    expect(overview.triage.now.map((entry) => entry.title)).not.toContain('Private');
  });

  it('still surfaces manually urgent private tasks in Focus when private mode is hidden', () => {
    const overview = buildOverview([
      ...entries,
      {
        path: 'tasks/active/private-urgent.md',
        filename: 'private-urgent.md',
        title: 'Private urgent referee report',
        kind: 'task',
        status: 'open',
        priority: '1',
        urgent: true,
        due: '2026-05-07',
        deadline_type: 'hard',
        project: 'referee-reports',
        private: true,
        modified_at: 5,
      },
    ], true, today);

    expect(overview.visibleEntries.map((entry) => entry.title)).not.toContain('Private urgent referee report');
    expect(overview.triage.now.map((entry) => entry.title)).not.toContain('Private urgent referee report');
    expect(overview.mustNotSlip.map((entry) => entry.title)).toContain('Private urgent referee report');
  });

  it('keeps the top focus rail to actionable near-term tasks', () => {
    const overview = buildOverview([
      ...entries,
      { path: 'tasks/active/future-hard.md', filename: 'future-hard.md', title: 'Future Hard', kind: 'task', status: 'open', priority: '2', due: '2026-05-20', deadline_type: 'hard', project: 'alpha', private: false, modified_at: 5 },
    ], false, today);

    expect(overview.mustNotSlip.map((entry) => entry.title)).toEqual([
      'Private',
      'Today Due',
      'Overdue',
    ]);
    expect(overview.mustNotSlip.map((entry) => entry.title)).not.toContain('P1 No Date');
    expect(overview.mustNotSlip.map((entry) => entry.title)).not.toContain('Waiting Reply');
    expect(overview.mustNotSlip.map((entry) => entry.title)).not.toContain('Future Hard');
  });

  it('prioritizes ranked focus tasks and caps the focus rail at six', () => {
    const ranked: VaultEntry[] = [1, 2, 3, 4, 5, 6, 7].map((n): VaultEntry => ({
      path: `tasks/active/focus-${n}.md`,
      filename: `focus-${n}.md`,
      title: `Focus rank ${n}`,
      kind: 'task',
      status: 'open',
      priority: '3',
      properties: { focus_rank: n },
      project: 'alpha',
      private: false,
      modified_at: 10 + n,
    }));
    const overview = buildOverview([...entries, ...ranked], false, today);

    expect(overview.mustNotSlip).toHaveLength(6);
    expect(overview.mustNotSlip.map((entry) => entry.title).slice(0, 2)).toEqual(['Focus rank 1', 'Focus rank 2']);
    expect(overview.mustNotSlip.map((entry) => entry.title)).not.toContain('Focus rank 7');
  });

  it('supports explicit focus ranks and exposes a focus reason', () => {
    const overview = buildOverview([
      ...entries,
      { path: 'tasks/active/focus-two.md', filename: 'focus-two.md', title: 'Focus rank two', kind: 'task', status: 'open', priority: '4', focus_rank: 2, project: 'alpha', private: false, modified_at: 5 },
      { path: 'tasks/active/focus-one.md', filename: 'focus-one.md', title: 'Focus rank one', kind: 'task', status: 'open', priority: '4', properties: { focus_rank: 1 }, project: 'alpha', private: false, modified_at: 6 },
    ], false, today);

    expect(overview.mustNotSlip.map((entry) => entry.title).slice(0, 2)).toEqual(['Focus rank one', 'Focus rank two']);
    expect(focusReason(overview.mustNotSlip[0], today)).toBe('focus #1');
    expect(focusReason(entries[1], today)).toBe('due today');
  });

  it('shows calendar-blocked and stale focus reasons', () => {
    expect(focusReason({
      path: 'tasks/active/calendar.md',
      filename: 'calendar.md',
      title: 'Calendar blocked',
      kind: 'task',
      status: 'open',
      priority: '3',
      block_day: '2026-05-06',
      project: 'alpha',
      private: false,
    }, today)).toBe('calendar blocked');
    expect(focusReason({
      path: 'tasks/active/stale.md',
      filename: 'stale.md',
      title: 'Stale soft task',
      kind: 'task',
      status: 'open',
      priority: '2',
      due: '2026-04-20',
      deadline_type: 'soft',
      project: 'alpha',
      private: false,
    }, today)).toBe('stale');
  });

  it('keeps P4 hard-deadline tasks out of default focus lanes unless explicitly focused', () => {
    const overview = buildOverview([
      ...entries,
      { path: 'tasks/active/parked-hard.md', filename: 'parked-hard.md', title: 'Parked Hard Deadline', kind: 'task', status: 'open', priority: '4', due: '2026-05-06', deadline_type: 'hard', project: 'alpha', private: false, modified_at: 5 },
      { path: 'tasks/active/focused-p4.md', filename: 'focused-p4.md', title: 'Focused P4', kind: 'task', status: 'open', priority: '4', focus_rank: 1, due: '2026-05-20', deadline_type: 'hard', project: 'alpha', private: false, modified_at: 6 },
    ], false, today);

    expect(overview.mustNotSlip.map((entry) => entry.title)).toContain('Focused P4');
    expect(overview.mustNotSlip.map((entry) => entry.title)).not.toContain('Parked Hard Deadline');
    expect(overview.triage.now.map((entry) => entry.title)).not.toContain('Parked Hard Deadline');
    expect(overview.triage.next.map((entry) => entry.title)).not.toContain('Parked Hard Deadline');
    expect(overview.upcomingDates.map((entry) => entry.title)).not.toContain('Parked Hard Deadline');
  });

  it('builds an upcoming-deadlines radar, excluding conference submissions (their own panel)', () => {
    const deadlineEntries: VaultEntry[] = [
      ...entries,
      // Conference submission deadline — now excluded from the radar (it has its own panel).
      { path: 'dates/2026-05-21-regional-submission-deadline.md', filename: '2026-05-21-regional-submission-deadline.md', title: 'Regional Methods Meeting submission deadline', kind: 'date', due: '2026-05-21', private: false, modified_at: 1 },
      // Non-submission deadline date file — still appears.
      { path: 'dates/2026-05-19-summer-conference-registration.md', filename: '2026-05-19-summer-conference-registration.md', title: 'Summer Conference registration deadline', kind: 'date', due: '2026-05-19', private: false, modified_at: 1 },
      { path: 'dates/2026-05-10-team-meeting.md', filename: '2026-05-10-team-meeting.md', title: 'Team meeting', kind: 'date', date: '2026-05-10', private: false, modified_at: 1 },
      { path: 'tasks/active/far-hard.md', filename: 'far-hard.md', title: 'Far Hard Task', kind: 'task', status: 'open', priority: '2', due: '2026-06-30', deadline_type: 'hard', project: 'alpha', private: false, modified_at: 1 },
      { path: 'tasks/cancelled/cancelled-hard.md', filename: 'cancelled-hard.md', title: 'Cancelled Hard', kind: 'task', status: 'cancelled', priority: '1', due: '2026-05-12', deadline_type: 'hard', project: 'alpha', private: false, modified_at: 1 },
      // Project page whose only date is in `deadline` (no due/date) — would render as "no date".
      { path: 'projects/referee-reports/README.md', filename: 'README.md', title: 'Referee Reports', kind: 'project', id: 'referee-reports', deadline: '2026-05-20', private: false, modified_at: 1 },
      // Task whose only date is in the `deadline` field, not due/date/start_date.
      { path: 'tasks/active/deadline-field-only.md', filename: 'deadline-field-only.md', title: 'Deadline Field Only', kind: 'task', status: 'open', priority: '1', deadline: '2026-05-19', deadline_type: 'hard', project: 'alpha', private: false, modified_at: 1 },
    ];

    const deadlines = buildUpcomingDeadlines(deadlineEntries, today);
    const titles = deadlines.map((entry) => entry.title);

    // Due-today hard task, then the registration deadline; the conference
    // submission deadline is excluded (it lives in the Conference submissions panel).
    expect(titles).toEqual(['Today Due', 'Summer Conference registration deadline']);
    expect(titles).not.toContain('Regional Methods Meeting submission deadline');
    // Non-deadline date file, already-overdue, far-future, and cancelled items are excluded.
    expect(titles).not.toContain('Team meeting');
    expect(titles).not.toContain('Overdue');
    expect(titles).not.toContain('Far Hard Task');
    expect(titles).not.toContain('Cancelled Hard');
    // Only entries with a real, displayable date (due/date/start_date) appear: no
    // project pages and nothing whose only date is the `deadline` field ("no date").
    expect(titles).not.toContain('Referee Reports');
    expect(titles).not.toContain('Deadline Field Only');

    // The radar is also exposed on the overview and de-duplicated from upcomingDates.
    const overview = buildOverview(deadlineEntries, false, today);
    expect(overview.upcomingDeadlines.map((entry) => entry.title)).toContain('Summer Conference registration deadline');
    expect(overview.upcomingDeadlines.map((entry) => entry.title)).not.toContain('Regional Methods Meeting submission deadline');
    expect(overview.upcomingDates.map((entry) => entry.title)).not.toContain('Summer Conference registration deadline');
  });

  it('de-duplicates a deadline that appears as both a task and a date file', () => {
    const dupes: VaultEntry[] = [
      { path: 'tasks/active/reg-task.md', filename: 'reg-task.md', title: 'Summer Conference conference registration', kind: 'task', id: 't-summer-conference-registration', status: 'open', priority: '2', due: '2026-05-25', deadline_type: 'hard', project: 'alpha', private: false, modified_at: 1 },
      { path: 'dates/2026-05-25-summer-conference-registration.md', filename: '2026-05-25-summer-conference-registration.md', title: 'Summer Conference registration deadline', kind: 'date', date: '2026-05-25', project: 'alpha', private: false, modified_at: 1 },
    ];
    const out = buildUpcomingDeadlines(dupes, today);
    expect(out).toHaveLength(1);
    expect(out[0].path).toBe('tasks/active/reg-task.md'); // prefer the actionable task
  });

  it('keeps conference submissions (task and its date file) out of the deadline radar', () => {
    const subs: VaultEntry[] = [
      { path: 'tasks/active/t-harbor-flows-junior-methods-submission.md', filename: 't-harbor-flows-junior-methods-submission.md', title: 'Submit Harbor Flows to Junior Methods Conference', kind: 'task', id: 't-harbor-flows-junior-methods-submission', status: 'open', priority: '2', due: '2026-05-25', deadline_type: 'hard', project: 'harbor-flows', private: false, modified_at: 1 },
      { path: 'dates/2026-05-25-junior-methods-submission-deadline.md', filename: '2026-05-25-junior-methods-submission-deadline.md', title: 'Junior Methods Conference submission deadline', kind: 'date', date: '2026-05-25', project: 'harbor-flows', private: false, modified_at: 1 },
    ];
    expect(buildUpcomingDeadlines(subs, today)).toHaveLength(0);
  });

  it('builds a GitHub-style activity heatmap from edits and cleared tasks', () => {
    const heatmap = buildActivityHeatmap([
      {
        path: 'tasks/done/closed.md',
        filename: 'closed.md',
        title: 'Closed task',
        kind: 'task',
        status: 'done',
        private: false,
        modified_at: new Date(2026, 4, 5, 9).getTime() / 1000,
        properties: { completed: '2026-05-04' },
      },
      {
        path: 'notes/edit.md',
        filename: 'edit.md',
        title: 'Edited note',
        kind: 'note',
        private: false,
        modified_at: new Date(2026, 4, 4, 11).getTime() / 1000,
      },
    ], today, 2);

    const may4 = heatmap.days.find((day) => day.date === '2026-05-04');
    const may5 = heatmap.days.find((day) => day.date === '2026-05-05');
    expect(may4?.completed).toBe(1);
    expect(may4?.edits).toBe(1);
    expect(may4?.level).toBe(2);
    expect(may5?.edits).toBe(1);
    expect(heatmap.totalCompleted).toBe(1);
    expect(heatmap.totalEdits).toBe(2);
  });

  it('counts open tasks and marks stale projects', () => {
    const review = buildProjectReview([
      ...entries,
      { path: 'projects/alpha/code-runs/README.md', filename: 'README.md', title: 'Code run logs', kind: 'documentation', project: 'alpha', private: false, modified_at: 1 },
      { path: 'areas/alpha/README.md', filename: 'README.md', title: 'Alpha Area', kind: 'project', id: 'alpha', private: false, modified_at: 1 },
    ], buildOverview(entries, false, today).openTasks, today);
    const alpha = review.find((item) => item.project.title === 'Alpha');
    const beta = review.find((item) => item.project.title === 'Beta');
    expect(review.filter((item) => item.project.id === 'alpha').length).toBe(1);
    expect(alpha?.project.path).toBe('projects/alpha/README.md');
    expect(alpha?.openTaskCount).toBe(6);
    expect(alpha?.stale).toBe(false);
    expect(beta?.openTaskCount).toBe(0);
    expect(beta?.stale).toBe(true);
    expect(review.map((item) => item.project.title)).not.toContain('Code run logs');
  });

  it('summarises project activity and the next deadline', () => {
    const review = buildProjectReview(entries, buildOverview(entries, false, today).openTasks, today);
    const alpha = review.find((item) => item.project.title === 'Alpha');
    // No done task in the fixture carries a completed/date field, so none counts as recent.
    expect(alpha?.recentCompletionCount).toBe(0);
    // Soonest open-task due drives the next deadline (the project has none of its own).
    expect(alpha?.nextDeadline).toMatchObject({ date: '2026-05-01', source: 'task', type: 'hard' });
    // Overdue + due-today are within the one-week urgency window.
    expect(alpha?.urgentTaskCount).toBeGreaterThanOrEqual(2);
  });

  it('marks projects stale when progress.md or notes are old even if the project file changed recently', () => {
    const review = buildProjectReview([
      ...entries,
      { path: 'projects/alpha/progress.md', filename: 'progress.md', title: 'Progress', kind: 'project-progress', project: 'alpha', private: false, modified_at: new Date(2026, 3, 1).getTime() / 1000 },
      { path: 'projects/alpha/notes/recent.md', filename: 'recent.md', title: 'Recent note', kind: 'note', project: 'alpha', private: false, modified_at: new Date(2026, 4, 5).getTime() / 1000 },
    ], buildOverview(entries, false, today).openTasks, today);

    const alpha = review.find((item) => item.project.title === 'Alpha');
    expect(alpha?.stale).toBe(true);
    expect(alpha?.staleReason).toBe('progress.md stale 35d');
  });

  it('builds a capped Now lane from due and P1 tasks sorted by urgency', () => {
    const overview = buildOverview(entries, false, today);
    expect(overview.triage.now.map((entry) => entry.title)).toEqual([
      'Private',
      'P1 No Date',
      'Today Due',
      'Overdue',
    ]);
    expect(overview.triage.now.length).toBeLessThanOrEqual(5);
  });

  it('keeps soft target dates out of Now unless they are materially overdue', () => {
    const overview = buildOverview([
      ...entries,
      { path: 'tasks/active/soft-today.md', filename: 'soft-today.md', title: 'Soft Today', kind: 'task', status: 'open', priority: '3', due: '2026-05-06', deadline_type: 'soft', project: 'alpha', private: false, modified_at: 5 },
      { path: 'tasks/active/soft-stale.md', filename: 'soft-stale.md', title: 'Soft Stale', kind: 'task', status: 'open', priority: '2', due: '2026-04-20', deadline_type: 'soft', project: 'alpha', private: false, modified_at: 5 },
      { path: 'tasks/waiting/soft-waiting-stale.md', filename: 'soft-waiting-stale.md', title: 'Soft Waiting Stale', kind: 'task', status: 'waiting', priority: '2', due: '2026-04-20', deadline_type: 'soft', project: 'alpha', private: false, modified_at: 5 },
    ], false, today);

    expect(overview.triage.now.map((entry) => entry.title)).not.toContain('Soft Today');
    expect(overview.triage.now.map((entry) => entry.title)).toContain('Soft Stale');
    expect(overview.triage.now.map((entry) => entry.title)).not.toContain('Soft Waiting Stale');
  });

  it('keeps waiting and blocked tasks in the Waiting lane only', () => {
    const overview = buildOverview(entries, false, today);
    expect(overview.triage.waiting.map((entry) => entry.title)).toEqual(['Waiting Reply']);
    expect(overview.triage.now.map((entry) => entry.title)).not.toContain('Waiting Reply');
    expect(overview.triage.waiting.map((entry) => entry.title)).not.toContain('Archived Waiting');
  });

  it('keeps distant P2 tasks out of the urgent Next lane', () => {
    const overview = buildOverview([
      ...entries,
      { path: 'tasks/active/tomorrow-p3.md', filename: 'tomorrow-p3.md', title: 'Tomorrow P3', kind: 'task', status: 'open', priority: '3', due: '2026-05-07', deadline_type: 'soft', project: 'alpha', private: false, modified_at: 5 },
      { path: 'tasks/active/day-eight-p2.md', filename: 'day-eight-p2.md', title: 'Day Eight P2', kind: 'task', status: 'open', priority: '2', due: '2026-05-14', deadline_type: 'soft', project: 'alpha', private: false, modified_at: 5 },
      { path: 'tasks/active/distant-p2.md', filename: 'distant-p2.md', title: 'Distant P2', kind: 'task', status: 'open', priority: '2', due: '2026-06-15', deadline_type: 'soft', project: 'alpha', private: false, modified_at: 5 },
    ], false, today);

    expect(overview.triage.next.map((entry) => entry.title)).toContain('Next Week');
    expect(overview.triage.next.map((entry) => entry.title)).not.toContain('Tomorrow P3');
    expect(overview.triage.next.map((entry) => entry.title)).not.toContain('Day Eight P2');
    expect(overview.triage.next.map((entry) => entry.title)).not.toContain('Distant P2');
  });

  it('splits overview task triage into research and other work', () => {
    const overview = buildOverview([
      ...entries,
      { path: 'tasks/active/research.md', filename: 'research.md', title: 'Research Push', kind: 'task', status: 'open', priority: '1', due: '2026-05-06', project: 'harbor-flows', domain: 'research', private: false, modified_at: 5 },
      { path: 'tasks/active/project-research.md', filename: 'project-research.md', title: 'Project Research Push', kind: 'task', status: 'open', priority: '1', due: '2026-05-06', project: 'harbor-flows', domain: 'research', private: false, modified_at: 5 },
      { path: 'tasks/active/referee.md', filename: 'referee.md', title: 'Referee Report', kind: 'task', status: 'open', priority: '1', due: '2026-04-29', project: 'referee-reports', domain: 'research', time_category: 'research', private: false, modified_at: 5 },
      { path: 'projects/harbor-flows/README.md', filename: 'README.md', title: 'Harbor Flows', kind: 'project', id: 'harbor-flows', status: 'active', domain: 'research', private: false, modified_at: 5 },
      { path: 'tasks/active/admin.md', filename: 'admin.md', title: 'Admin Push', kind: 'task', status: 'open', priority: '1', due: '2026-05-06', project: 'operations', domain: 'admin', private: false, modified_at: 5 },
    ], false, today);

    const research = overview.taskGroups.find((group) => group.key === 'research');
    const other = overview.taskGroups.find((group) => group.key === 'other');
    expect(research?.now.map((entry) => entry.title)).toContain('Research Push');
    expect(research?.now.map((entry) => entry.title)).toContain('Project Research Push');
    expect(research?.now.map((entry) => entry.title)).toContain('Referee Report');
    expect(research?.now.map((entry) => entry.title)).not.toContain('Admin Push');
    expect(other?.now.map((entry) => entry.title)).toContain('Admin Push');
  });

  it('builds upcoming travel from dated events, open logistics tasks, and itinerary briefs', () => {
    const overview = buildOverview([
      ...entries,
      { path: 'dates/methods-summit.md', filename: 'methods-summit.md', title: 'Methods Summit begins', type: 'conference', kind: 'event', date: '2026-06-03', area: 'travel', properties: { module: 'travel', trip_key: 'methods-summit', trip_title: 'Methods Summit / Northport' }, private: false, modified_at: 5 },
      { path: 'dates/methods-summit-checkout.md', filename: 'methods-summit-checkout.md', title: 'Example Hotel checkout', type: 'travel', kind: 'event', date: '2026-06-04', area: 'travel', properties: { module: 'travel', trip_key: 'methods-summit', trip_title: 'Methods Summit / Northport' }, private: false, modified_at: 5 },
      { path: 'dates/annual-meeting.md', filename: 'annual-meeting.md', title: 'Annual Meeting begins', type: 'conference', kind: 'event', date: '2026-08-17', area: 'travel', properties: { module: 'travel', trip_key: 'annual-meeting', trip_title: 'Annual Meeting / Lakeside' }, private: false, modified_at: 5 },
      { path: 'dates/regional-deadline.md', filename: 'regional-deadline.md', title: 'Regional Methods Meeting submission deadline', type: 'deadline', kind: 'date', date: '2026-05-21', project: 'harbor-city', private: false, modified_at: 5 },
      { path: 'projects/travel/notes/methods-summit-routing.md', filename: 'methods-summit-routing.md', title: 'Methods Summit travel routing', kind: 'travel-brief', area: 'travel', properties: { module: 'travel', trip_key: 'methods-summit', trip_title: 'Methods Summit / Northport' }, private: false, modified_at: 6 },
      { path: 'tasks/waiting/book-june.md', filename: 'book-june.md', title: 'Book Methods Summit travel after approval', kind: 'task', status: 'waiting', priority: '1', due: '2026-05-20', area: 'travel', properties: { module: 'travel', trip_key: 'methods-summit', trip_title: 'Methods Summit / Northport' }, next: 'Book the trip after approval.', private: false, modified_at: 7 },
      { path: 'tasks/done/regional-meeting-hotel.md', filename: 'regional-meeting-hotel.md', title: 'Book Regional Meeting hotel block', kind: 'task', status: 'done', priority: '1', due: '2026-05-12', area: 'travel', properties: { module: 'travel', trip_key: 'regional-meeting', trip_title: 'Regional Meeting / Cedar Campus' }, private: false, modified_at: 7 },
      { path: 'tasks/active/northbridge.md', filename: 'northbridge.md', title: 'Follow up about a Northbridge seminar visit', kind: 'task', status: 'open', priority: '3', due: '2026-05-20', area: 'travel', properties: { module: 'travel', trip_key: 'northbridge-seminar', trip_title: 'Northbridge seminar lead' }, private: false, modified_at: 7 },
      { path: 'tasks/active/floating.md', filename: 'floating.md', title: 'Undated travel idea', kind: 'task', status: 'open', priority: '3', area: 'travel', properties: { module: 'travel', trip_key: 'floating-idea', trip_title: 'Undated travel idea' }, private: false, modified_at: 7 },
    ], false, new Date(2026, 4, 13));

    const methodsSummit = overview.upcomingTravel.find((item) => item.title === 'Methods Summit / Northport');
    expect(methodsSummit?.missing.map((entry) => entry.title)).toContain('Book Methods Summit travel after approval');
    expect(methodsSummit?.missing.map((entry) => entry.title)).not.toContain('Book Regional Meeting hotel block');
    expect(methodsSummit?.briefs.map((entry) => entry.title)).toContain('Methods Summit travel routing');
    expect(methodsSummit?.startDate).toBe('2026-06-03');
    expect(methodsSummit?.endDate).toBe('2026-06-04');
    expect(overview.upcomingTravel.map((item) => item.title)).not.toContain('Regional Methods Meeting submission deadline');
    expect(overview.upcomingTravel.map((item) => item.title)).not.toContain('Annual Meeting / Lakeside');
    expect(overview.upcomingTravel.map((item) => item.title)).not.toContain('Undated travel idea');
    expect(overview.upcomingTravel.map((item) => item.title)).toContain('Northbridge seminar lead');
  });

  it('separates coauthor-assigned tasks from owned overview lanes', () => {
    const overview = buildOverview([
      ...entries,
      { path: 'tasks/active/coauthor.md', filename: 'coauthor.md', title: 'Coauthor Follow-up', kind: 'task', status: 'open', priority: '1', due: '2026-05-06', project: 'alpha', assignee: 'Jan Bakker', private: false, modified_at: 5 },
    ], false, today);

    const research = overview.taskGroups.find((group) => group.key === 'research');
    const other = overview.taskGroups.find((group) => group.key === 'other');
    const alpha = overview.projectReview.find((item) => item.project.id === 'alpha');
    expect(overview.coauthorTasks.map((entry) => entry.title)).toContain('Coauthor Follow-up');
    expect(research?.now.map((entry) => entry.title)).not.toContain('Coauthor Follow-up');
    expect(other?.now.map((entry) => entry.title)).not.toContain('Coauthor Follow-up');
    expect(alpha?.coauthorTaskCount).toBe(1);
    expect(alpha?.coauthorTasks.map((entry) => entry.title)).toContain('Coauthor Follow-up');
  });

  it('does not repeat surfaced tasks or projects in later overview panels', () => {
    const overview = buildOverview(entries, false, today);
    const firstPassPaths = new Set([
      ...overview.triage.now.map((entry) => entry.path),
      ...overview.triage.next.map((entry) => entry.path),
      ...overview.triage.waiting.map((entry) => entry.path),
      ...overview.triage.review.map((item) => item.project.path),
    ]);
    expect(overview.upcomingDates.some((entry) => firstPassPaths.has(entry.path))).toBe(false);
    expect(overview.upcomingDates.map((entry) => entry.title)).not.toContain('Done');
    const secondPassPaths = new Set([...firstPassPaths, ...overview.upcomingDates.map((entry) => entry.path)]);
    expect(overview.recentActivity.some((entry) => secondPassPaths.has(entry.path))).toBe(false);
  });
});
