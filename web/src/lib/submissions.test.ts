import { describe, expect, it } from 'vitest';
import {
  awaitingSubmissions,
  buildSubmissions,
  conferenceDateLabel,
  isSubmissionTask,
  submissionLabel,
  upcomingSubmissions,
} from './submissions';
import type { VaultEntry } from '../types';

const entries: VaultEntry[] = [
  { path: 'tasks/active/t-harbor-flows-network-workshop-submission.md', filename: 'k.md', title: 'Decide Network Economics Workshop submission', kind: 'task', id: 't-harbor-flows-network-workshop-submission', status: 'open', project: 'harbor-flows', due: '2026-06-23', private: false, properties: { conference_start: '2026-11-03', conference_end: '2026-11-04' } },
  { path: 'tasks/active/t-harbor-flows-urban-research-meeting-submission.md', filename: 'c.md', title: 'Decide Harbor Flows Urban Research Meeting submission', kind: 'task', id: 't-harbor-flows-urban-research-meeting-submission', status: 'open', project: 'harbor-flows', due: '2026-07-25', private: false, properties: { conference_start: '2026-10-09' } },
  // Submitted, awaiting a decision (done, no closed outcome).
  { path: 'tasks/done/t-harbor-flows-junior-methods-submission.md', filename: 's.md', title: 'Submit Harbor Flows to Junior Methods Conference', kind: 'task', id: 't-harbor-flows-junior-methods-submission', status: 'done', project: 'harbor-flows', due: '2026-06-20', private: false, properties: { completed: '2026-06-20' } },
  { path: 'tasks/done/t-harbor-city-regional-meeting-submission.md', filename: 'b.md', title: 'Submit Harbor City paper to Regional Methods Meeting', kind: 'task', id: 't-harbor-city-regional-meeting-submission', status: 'done', project: 'harbor-city', due: '2026-05-21', private: false, properties: { completed: '2026-05-22', decision_expected: '2026-06-28' } },
  // Done but explicitly not submitted -> closed, must NOT appear as awaiting.
  { path: 'tasks/done/t-harbor-flows-spring-forum-submission-decision.md', filename: 'sr.md', title: 'Decide Spring Research Forum submission', kind: 'task', id: 't-harbor-flows-spring-forum-submission-decision', status: 'done', project: 'harbor-flows', due: '2026-06-15', private: false, properties: { submission_outcome: 'not_submitted' } },
  // Heard back -> closed.
  { path: 'tasks/done/t-harbor-flows-accepted-submission.md', filename: 'a.md', title: 'Submit Harbor Flows to Accepted Conf', kind: 'task', id: 't-harbor-flows-accepted-submission', status: 'done', project: 'harbor-flows', due: '2026-04-01', private: false, properties: { submission_outcome: 'accepted' } },
];

describe('submissions', () => {
  it('identifies submission tasks by id suffix only', () => {
    expect(isSubmissionTask(entries[0])).toBe(true);
    expect(isSubmissionTask(entries[4])).toBe(true); // -submission-decision
  });

  it('derives compact conference labels from titles', () => {
    expect(submissionLabel(entries[0])).toBe('Network Economics Workshop');
    expect(submissionLabel(entries[2])).toBe('Junior Methods Conference');
  });

  it('classifies phases: open=upcoming, done=awaiting, closed outcomes drop out', () => {
    const byLabel = Object.fromEntries(buildSubmissions(entries).map((s) => [s.label, s.phase]));
    expect(byLabel['Network Economics Workshop']).toBe('upcoming');
    expect(byLabel['Junior Methods Conference']).toBe('awaiting');
    expect(byLabel['Regional Methods Meeting']).toBe('awaiting');
    expect(buildSubmissions(entries).find((s) => s.id.includes('spring-forum'))?.phase).toBe('closed'); // not_submitted
    expect(buildSubmissions(entries).find((s) => s.id.includes('accepted'))?.phase).toBe('closed'); // heard back
  });

  it('splits upcoming (by deadline) and awaiting (by decision/submission date)', () => {
    const built = buildSubmissions(entries);
    expect(upcomingSubmissions(built).map((s) => s.label)).toEqual([
      'Network Economics Workshop',
      'Harbor Flows Urban Research Meeting',
    ]);
    const awaiting = awaitingSubmissions(built);
    // The junior meeting submitted 2026-06-20 sorts before the regional meeting's 2026-06-28 decision date.
    expect(awaiting.map((s) => s.label)).toEqual([
      'Junior Methods Conference',
      'Regional Methods Meeting',
    ]);
    expect(awaiting.find((s) => s.label === 'Regional Methods Meeting')?.decisionExpected).toBe('2026-06-28');
    expect(awaiting.find((s) => s.label.startsWith('Junior Methods'))?.submittedOn).toBe('2026-06-20');
  });

  it('exposes conference dates and formats a compact label', () => {
    const built = buildSubmissions(entries);
    const westport = built.find((s) => s.label === 'Network Economics Workshop');
    expect(westport?.conferenceStart).toBe('2026-11-03');
    expect(westport?.conferenceEnd).toBe('2026-11-04');
    expect(conferenceDateLabel(westport!)).toBe('Nov 3–4, 2026');
    // Single-day conference (no end) and a submission with no conference date.
    expect(conferenceDateLabel(built.find((s) => s.label === 'Harbor Flows Urban Research Meeting')!)).toBe('Oct 9, 2026');
    expect(conferenceDateLabel(built.find((s) => s.id.includes('spring-forum'))!)).toBe('');
  });
});
