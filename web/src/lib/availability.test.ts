import { describe, expect, it } from 'vitest';
import { availabilityForDate, buildAvailability } from './availability';
import type { VaultEntry } from '../types';

const entries: VaultEntry[] = [
  { path: 'dates/globalMeeting-window.md', filename: 'g.md', title: 'Global Economics Meeting Hillview travel window', kind: 'event', type: 'travel', start_date: '2026-06-24', end_date: '2026-06-29' },
  { path: 'dates/globalMeeting-meeting.md', filename: 'm.md', title: 'Georgia Economics Association Meeting', kind: 'event', type: 'conference', date: '2026-06-26' },
  { path: 'dates/annual-meeting.md', filename: 'e.md', title: 'Annual Meeting begins', kind: 'event', type: 'conference', date: '2026-08-17' },
  { path: 'tasks/active/dl.md', filename: 'd.md', title: 'Hard thing due', kind: 'task', status: 'open', due: '2026-07-01', deadline_type: 'hard' },
  { path: 'tasks/active/soft.md', filename: 's.md', title: 'Soft thing', kind: 'task', status: 'open', due: '2026-07-02', deadline_type: 'soft' },
  { path: 'tasks/done/done.md', filename: 'x.md', title: 'Done hard thing', kind: 'task', status: 'done', due: '2026-07-03', deadline_type: 'hard' },
];

describe('availability', () => {
  it('marks travel windows away across the full span only', () => {
    const m = buildAvailability(entries);
    expect(availabilityForDate(m, new Date(2026, 5, 24)).status).toBe('away'); // Jun 24
    expect(availabilityForDate(m, new Date(2026, 5, 29)).status).toBe('away'); // Jun 29
    expect(availabilityForDate(m, new Date(2026, 5, 23)).status).toBe('free'); // day before
    expect(availabilityForDate(m, new Date(2026, 5, 30)).status).toBe('free'); // day after
  });

  it('lets travel outrank a conference on a shared day', () => {
    const day = availabilityForDate(buildAvailability(entries), new Date(2026, 5, 26)); // Jun 26
    expect(day.status).toBe('away');
    expect(day.reasons.length).toBeGreaterThanOrEqual(2); // travel window + conference
  });

  it('marks conferences and open hard deadlines busy; soft and done deadlines stay free', () => {
    const m = buildAvailability(entries);
    expect(availabilityForDate(m, new Date(2026, 7, 17)).status).toBe('busy'); // Annual Meeting conference
    expect(availabilityForDate(m, new Date(2026, 6, 1)).status).toBe('busy'); // open hard deadline
    expect(availabilityForDate(m, new Date(2026, 6, 2)).status).toBe('free'); // soft deadline
    expect(availabilityForDate(m, new Date(2026, 6, 3)).status).toBe('free'); // done hard deadline
  });

  it('defaults uncommitted days to free', () => {
    expect(availabilityForDate(buildAvailability(entries), new Date(2026, 8, 15)).status).toBe('free');
  });
});
