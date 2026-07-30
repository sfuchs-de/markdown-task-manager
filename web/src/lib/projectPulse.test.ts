import { describe, expect, it } from 'vitest';
import { activityLevelFor, buildProjectPulse, splitProjectPulse } from './projectPulse';
import type { ProjectNextDeadline, ProjectReview } from './overview';
import type { VaultEntry } from '../types';

function project(id: string, extra: Partial<VaultEntry> = {}): VaultEntry {
  return { path: `projects/${id}/README.md`, filename: 'README.md', title: id, kind: 'project', id, status: 'active', priority: '2', ...extra };
}

function review(extra: Partial<ProjectReview> & { project: VaultEntry }): ProjectReview {
  return {
    openTaskCount: 0, openTasks: [], coauthorTaskCount: 0, coauthorTasks: [], recentEntries: [],
    stale: false, staleReason: '', recentCompletionCount: 0, latestActivityTs: 0, urgentTaskCount: 0, nextDeadline: null,
    ...extra,
  };
}

const deadline = (date: string, extra: Partial<ProjectNextDeadline> = {}): ProjectNextDeadline =>
  ({ date, type: 'soft', daysUntil: 0, source: 'project', label: 'project deadline', ...extra });

describe('activityLevelFor', () => {
  it('buckets the activity score (open + delegated + recently closed) into a 0-3 meter', () => {
    expect([0, 1, 2, 3, 5, 6, 12].map(activityLevelFor)).toEqual([0, 1, 1, 2, 2, 3, 3]);
  });
});

describe('buildProjectPulse', () => {
  it('drops finished/parked projects but keeps every live status', () => {
    const reviews = [
      review({ project: project('done', { status: 'done' }) }),
      review({ project: project('archived', { status: 'archived' }) }),
      review({ project: project('cancelled', { status: 'cancelled' }) }),
      review({ project: project('live', { status: 'active' }) }),
      review({ project: project('scoping', { status: 'scoping' }) }),
      review({ project: project('audit', { status: 'needs-local-audit' }) }),
    ];
    expect(buildProjectPulse(reviews).map((p) => p.id).sort()).toEqual(['audit', 'live', 'scoping']);
  });

  it('sorts by priority, then soonest deadline, then activity', () => {
    const reviews = [
      review({ project: project('e', { priority: '2' }), openTaskCount: 0 }),
      review({ project: project('d', { priority: '2' }), openTaskCount: 5 }),
      review({ project: project('b', { priority: '2' }), nextDeadline: deadline('2026-06-25') }),
      review({ project: project('c', { priority: '2' }), nextDeadline: deadline('2026-06-24') }),
      review({ project: project('a', { priority: '1' }) }),
    ];
    expect(buildProjectPulse(reviews).map((p) => p.id)).toEqual(['a', 'c', 'b', 'd', 'e']);
  });

  it('maps the view fields: cleaned status, parsed priority, bucketed activity', () => {
    const [pulse] = buildProjectPulse([
      review({
        project: project('p', { status: 'active   scoping', priority: 'P1', area: 'research' }),
        openTaskCount: 3,
        urgentTaskCount: 1,
        recentCompletionCount: 3,
        nextDeadline: deadline('2026-07-07', { type: 'hard', source: 'task', label: 'send Jon slides' }),
      }),
    ]);
    expect(pulse).toMatchObject({
      status: 'active scoping',
      priority: 1,
      area: 'research',
      activityLevel: 3,
      openTaskCount: 3,
      urgentTaskCount: 1,
      recentCompletionCount: 3,
      nextDeadline: { date: '2026-07-07', type: 'hard', label: 'send Jon slides' },
    });
  });

  it('defaults a missing priority to 99 so it sorts last', () => {
    const reviews = [
      review({ project: project('none', { priority: undefined }) }),
      review({ project: project('p3', { priority: '3' }) }),
    ];
    expect(buildProjectPulse(reviews).map((p) => p.id)).toEqual(['p3', 'none']);
  });
});

describe('splitProjectPulse', () => {
  it('features the most recently changed, keeping the rest in priority order', () => {
    const pulse = buildProjectPulse([
      review({ project: project('a', { priority: '1' }), latestActivityTs: 100 }),
      review({ project: project('b', { priority: '2' }), latestActivityTs: 300 }),
      review({ project: project('c', { priority: '3' }), latestActivityTs: 200 }),
      review({ project: project('d', { priority: '1' }), latestActivityTs: 50 }),
    ]);
    const { featured, rest } = splitProjectPulse(pulse, 2);
    expect(featured.map((p) => p.id)).toEqual(['b', 'c']); // newest timestamps first
    expect(rest.map((p) => p.id)).toEqual(['a', 'd']); // remainder stays priority-sorted
  });

  it('leaves rest empty when everything fits in featured', () => {
    const pulse = buildProjectPulse([
      review({ project: project('a'), latestActivityTs: 1 }),
      review({ project: project('b'), latestActivityTs: 2 }),
    ]);
    const { featured, rest } = splitProjectPulse(pulse, 3);
    expect(featured).toHaveLength(2);
    expect(rest).toHaveLength(0);
  });
});
