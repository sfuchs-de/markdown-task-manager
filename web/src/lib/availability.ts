import { isTask } from './filters';
import type { VaultEntry } from '../types';

export type AvailabilityStatus = 'free' | 'busy' | 'away';

export interface AvailabilityDay {
  date: string; // YYYY-MM-DD
  status: AvailabilityStatus;
  reasons: string[];
}

const DONE_STATUSES = new Set(['done', 'complete', 'completed', 'cancelled', 'canceled', 'dropped', 'archived', 'archive']);
const STATUS_RANK: Record<AvailabilityStatus, number> = { free: 0, busy: 1, away: 2 };

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Local-time YYYY-MM-DD key (avoids the UTC shift of toISOString). */
export function ymd(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function parseYmd(value?: string | null): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''));
  return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null;
}

function addDays(date: Date, n: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + n);
}

function entryType(entry: VaultEntry): string {
  return String(entry.type || entry.explicit_type || (entry.properties && entry.properties.type) || '').toLowerCase();
}

/**
 * Build a per-day availability map from the vault:
 * - travel windows -> away (you are physically gone)
 * - conferences / seminars / workshops and open hard-deadline tasks -> busy
 * - everything else defaults to free
 * Away outranks busy on a shared day; reasons accumulate.
 */
export function buildAvailability(entries: VaultEntry[]): Map<string, AvailabilityDay> {
  const map = new Map<string, AvailabilityDay>();

  const mark = (key: string, status: AvailabilityStatus, reason: string) => {
    const current = map.get(key);
    if (!current) {
      map.set(key, { date: key, status, reasons: reason ? [reason] : [] });
      return;
    }
    if (reason && !current.reasons.includes(reason)) current.reasons.push(reason);
    if (STATUS_RANK[status] > STATUS_RANK[current.status]) current.status = status;
  };

  const markSpan = (start: Date, end: Date, status: AvailabilityStatus, reason: string) => {
    for (let day = start, guard = 0; day <= end && guard < 400; day = addDays(day, 1), guard += 1) {
      mark(ymd(day), status, reason);
    }
  };

  for (const entry of entries) {
    const type = entryType(entry);
    if (type === 'travel') {
      const start = parseYmd(entry.start_date) || parseYmd(entry.date);
      if (start) markSpan(start, parseYmd(entry.end_date) || start, 'away', String(entry.title || 'Travel'));
      continue;
    }
    if (type === 'conference' || type === 'seminar' || type === 'workshop') {
      const start = parseYmd(entry.start_date) || parseYmd(entry.date);
      if (start) markSpan(start, parseYmd(entry.end_date) || start, 'busy', String(entry.title || 'Conference'));
      continue;
    }
    if (
      isTask(entry) &&
      String(entry.deadline_type || '').toLowerCase() === 'hard' &&
      !DONE_STATUSES.has(String(entry.status || '').toLowerCase())
    ) {
      const due = parseYmd(entry.due);
      if (due) mark(ymd(due), 'busy', String(entry.title || 'Deadline'));
    }
  }

  return map;
}

export function availabilityForDate(map: Map<string, AvailabilityDay>, date: Date): AvailabilityDay {
  return map.get(ymd(date)) || { date: ymd(date), status: 'free', reasons: [] };
}
