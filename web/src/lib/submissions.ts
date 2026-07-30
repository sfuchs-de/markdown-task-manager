import { isTask } from './filters';
import type { VaultEntry } from '../types';

export type SubmissionPhase = 'upcoming' | 'awaiting' | 'closed';

export interface ConferenceSubmission {
  path: string;
  id: string;
  title: string;
  /** Cleaned conference label, e.g. "Methods Symposium". */
  label: string;
  project: string;
  /** Submission deadline (drives the "upcoming" group). */
  due: string | null;
  /** Date the paper was submitted, if recorded. */
  submittedOn: string | null;
  /** Date a decision is expected back, if recorded. */
  decisionExpected: string | null;
  /** Conference start/end dates (the event itself, distinct from the deadline). */
  conferenceStart: string | null;
  conferenceEnd: string | null;
  phase: SubmissionPhase;
  /** Raw submission_outcome marker, if any (accepted/rejected/not_submitted/...). */
  outcome: string;
}

const DONE_STATUSES = new Set(['done', 'complete', 'completed', 'submitted']);
const DECLINED_STATUSES = new Set(['cancelled', 'canceled', 'dropped']);
// Outcomes meaning the submission is resolved (heard back) or was never sent —
// either way it leaves the active monitor.
const CLOSED_OUTCOMES = new Set([
  'accepted', 'rejected', 'declined', 'withdrawn', 'desk_reject', 'desk reject',
  'not_submitted', 'not submitted',
]);
// Conference-submission tasks share the id suffix `-submission` (committed
// submissions) or `-submission-decision` (still deciding whether to submit).
const SUBMISSION_ID_RE = /-submission(-decision)?$/;

function readField(entry: VaultEntry, key: string): string {
  const top = (entry as unknown as Record<string, unknown>)[key];
  const nested = entry.properties?.[key];
  return String((top ?? nested ?? '') || '').trim();
}

export function isSubmissionTask(entry: VaultEntry): boolean {
  if (!isTask(entry)) return false;
  const id = String(entry.id || '').toLowerCase();
  if (id) return SUBMISSION_ID_RE.test(id);
  const stem = entry.path.replace(/^.*\//, '').replace(/\.md$/, '').toLowerCase();
  return SUBMISSION_ID_RE.test(stem);
}

/**
 * True for conference-submission tasks AND their submission-deadline date files.
 * Used to keep them out of the generic "Upcoming deadlines" radar and the
 * decision-strip deadline tile, since they have their own Conference
 * submissions panel.
 */
export function isConferenceSubmissionDeadline(entry: VaultEntry): boolean {
  if (isSubmissionTask(entry)) return true;
  if (/\bsubmission\s+deadline\b/i.test(String(entry.title || ''))) return true;
  const idPath = `${entry.id || ''} ${entry.path || ''}`.toLowerCase();
  return /-submission(-decision)?-deadline\b/.test(idPath);
}

function submissionPhase(entry: VaultEntry, outcome: string): SubmissionPhase {
  const status = String(entry.status || '').toLowerCase();
  if (CLOSED_OUTCOMES.has(outcome)) return 'closed';
  if (DECLINED_STATUSES.has(status)) return 'closed';
  if (DONE_STATUSES.has(status)) return 'awaiting'; // submitted, no resolved outcome yet
  return 'upcoming'; // still open / to submit
}

/** Derive a compact conference label from the task title. */
export function submissionLabel(entry: VaultEntry): string {
  const title = String(entry.title || '').trim();
  if (!title) return entry.path;
  const submitTo = title.match(/^submit\s+.+?\s+to\s+(.+)$/i);
  const label = submitTo
    ? submitTo[1]
    : title.replace(/^decide\s+/i, '').replace(/\s+submission(\s+decision)?\s*$/i, '');
  return label.replace(/\s+/g, ' ').trim() || title;
}

const SUBMISSION_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Compact conference-date label, e.g. "Nov 3–4, 2026" or "Nov 30 – Dec 2, 2026". */
export function conferenceDateLabel(submission: ConferenceSubmission): string {
  const start = submission.conferenceStart;
  if (!start) return '';
  const [sy, sm, sd] = start.split('-').map(Number);
  if (!sy || !sm || !sd) return '';
  let label = `${SUBMISSION_MONTHS[sm - 1]} ${sd}`;
  const end = submission.conferenceEnd;
  if (end) {
    const [ey, em, ed] = end.split('-').map(Number);
    if (ey && em && ed && !(ey === sy && em === sm && ed === sd)) {
      label += em === sm && ey === sy ? `–${ed}` : ` – ${SUBMISSION_MONTHS[em - 1]} ${ed}`;
    }
  }
  return `${label}, ${sy}`;
}

export function buildSubmissions(entries: VaultEntry[], _today = new Date()): ConferenceSubmission[] {
  return entries
    .filter(isSubmissionTask)
    .map((entry) => {
      const outcome = readField(entry, 'submission_outcome').toLowerCase();
      return {
        path: entry.path,
        id: String(entry.id || ''),
        title: String(entry.title || entry.path),
        label: submissionLabel(entry),
        project: String(entry.project || ''),
        due: entry.due || entry.date || null,
        submittedOn: readField(entry, 'completed') || null,
        decisionExpected: readField(entry, 'decision_expected') || readField(entry, 'notification_date') || null,
        conferenceStart: readField(entry, 'conference_start') || readField(entry, 'conference_date') || null,
        conferenceEnd: readField(entry, 'conference_end') || null,
        phase: submissionPhase(entry, outcome),
        outcome,
      };
    })
    .sort((a, b) => {
      // ISO dates sort lexicographically; undated rows sink to the bottom.
      const ad = a.due || '9999-12-31';
      const bd = b.due || '9999-12-31';
      if (ad !== bd) return ad.localeCompare(bd);
      return a.label.localeCompare(b.label);
    });
}

/** Submissions still to be sent — deadline ahead. Sorted soonest deadline first. */
export function upcomingSubmissions(submissions: ConferenceSubmission[]): ConferenceSubmission[] {
  return submissions
    .filter((submission) => submission.phase === 'upcoming')
    .sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999') || a.label.localeCompare(b.label));
}

/** Submitted, awaiting a decision. Sorted by expected decision (then submission) date. */
export function awaitingSubmissions(submissions: ConferenceSubmission[]): ConferenceSubmission[] {
  return submissions
    .filter((submission) => submission.phase === 'awaiting')
    .sort((a, b) => {
      const ak = a.decisionExpected || a.submittedOn || '9999';
      const bk = b.decisionExpected || b.submittedOn || '9999';
      return ak.localeCompare(bk) || a.label.localeCompare(b.label);
    });
}

/** Everything still being monitored (upcoming + awaiting). */
export function monitoredSubmissions(submissions: ConferenceSubmission[]): ConferenceSubmission[] {
  return submissions.filter((submission) => submission.phase !== 'closed');
}
