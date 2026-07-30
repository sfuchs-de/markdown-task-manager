import { isTask } from './filters';
import type { VaultEntry } from '../types';

export type RefereeReportStatus = 'outstanding' | 'submitted' | 'declined';

export interface RefereeReport {
  path: string;
  id: string;
  title: string;
  /** Journal + manuscript label, e.g. "Journal B INEC-D-25-00374R1". */
  label: string;
  due: string | null;
  status: RefereeReportStatus;
}

const SUBMITTED_STATUSES = new Set(['done', 'complete', 'completed', 'submitted']);
const DECLINED_STATUSES = new Set(['cancelled', 'canceled', 'dropped', 'declined']);

// Referee assignments opt in with a kind or module field. Project names and
// titles are intentionally not classifiers.
export function isRefereeTask(entry: VaultEntry): boolean {
  const kind = String(entry.kind || entry.type || '').toLowerCase();
  const module = String(entry.properties?.module || '').toLowerCase().replace(/-/g, '_');
  return kind === 'referee-assignment' || (isTask(entry) && module === 'referee_reports');
}

function refereeStatus(entry: VaultEntry): RefereeReportStatus {
  const status = String(entry.status || '').toLowerCase();
  if (DECLINED_STATUSES.has(status)) return 'declined';
  if (SUBMITTED_STATUSES.has(status)) return 'submitted';
  return 'outstanding';
}

/** Strip the "Referee Report -" prefix to leave the journal/manuscript label. */
export function refereeLabel(entry: VaultEntry): string {
  const title = String(entry.title || '').trim();
  if (!title) return entry.path;
  return title.replace(/^referee\s+report\s*[-—:]\s*/i, '').replace(/\s+/g, ' ').trim() || title;
}

function statusRank(status: RefereeReportStatus): number {
  if (status === 'outstanding') return 0;
  if (status === 'submitted') return 1;
  return 2;
}

export function buildRefereeReports(entries: VaultEntry[]): RefereeReport[] {
  return entries
    .filter(isRefereeTask)
    .map((entry) => ({
      path: entry.path,
      id: String(entry.id || ''),
      title: String(entry.title || entry.path),
      label: refereeLabel(entry),
      due: entry.due || entry.date || null,
      status: refereeStatus(entry),
    }))
    .sort((a, b) => {
      const rank = statusRank(a.status) - statusRank(b.status);
      if (rank !== 0) return rank;
      const ad = a.due || '9999-12-31';
      const bd = b.due || '9999-12-31';
      if (ad !== bd) return ad.localeCompare(bd);
      return a.label.localeCompare(b.label);
    });
}

export function outstandingRefereeReports(reports: RefereeReport[]): RefereeReport[] {
  return reports.filter((report) => report.status === 'outstanding');
}
