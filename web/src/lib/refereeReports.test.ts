import { describe, expect, it } from 'vitest';
import { buildRefereeReports, isRefereeTask, outstandingRefereeReports, refereeLabel } from './refereeReports';
import type { VaultEntry } from '../types';

const entries: VaultEntry[] = [
  { path: 'tasks/cancelled/t-journal-c-review.md', filename: 'c.md', title: 'Referee Report — Journal C JM-03151R1', kind: 'referee-assignment', status: 'cancelled', due: '2026-06-20', private: true },
  { path: 'tasks/active/t-journal-b-review.md', filename: 'b.md', title: 'Referee Report - Journal B JM-00374R1', kind: 'referee-assignment', status: 'open', due: '2026-06-23', private: true },
  { path: 'tasks/done/t-journal-a-review.md', filename: 'a.md', title: 'Referee Report - Journal A MS 12345', kind: 'referee-assignment', status: 'done', due: '2026-05-08', private: true },
  // Not a referee report: an author's own revision must be excluded.
  { path: 'tasks/active/t-harbor-paper-revision.md', filename: 'h.md', title: 'Revise Journal B submission', kind: 'task', domain: 'research', project: 'harbor-flows', status: 'open', due: '2026-06-30', private: false },
];

describe('refereeReports', () => {
  it('matches referee tasks by project, not by the word "referee"', () => {
    expect(isRefereeTask(entries[0])).toBe(true);
    expect(isRefereeTask(entries[3])).toBe(false); // "Revise Journal B submission" is not a referee assignment
  });

  it('strips the "Referee Report" prefix to a journal/manuscript label', () => {
    expect(refereeLabel(entries[0])).toBe('Journal C JM-03151R1');
    expect(refereeLabel(entries[1])).toBe('Journal B JM-00374R1');
  });

  it('marks done/cancelled assignments and keeps outstanding ones, soonest first', () => {
    const built = buildRefereeReports(entries);
    expect(built.map((r) => [r.label, r.status])).toEqual([
      ['Journal B JM-00374R1', 'outstanding'],
      ['Journal A MS 12345', 'submitted'],
      ['Journal C JM-03151R1', 'declined'],
    ]);
    expect(outstandingRefereeReports(built).map((r) => r.label)).toEqual([
      'Journal B JM-00374R1',
    ]);
  });
});
