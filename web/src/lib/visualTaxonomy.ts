import { entryLens } from './filters';
import { entryDomain } from './domain';
import { daysUntil, isManualUrgent } from './overview';
import { isSoftDeadline } from './deadlines';
import type { VaultEntry } from '../types';

const RESEARCH_ROLES = new Set([
  'modeling',
  'empirics',
  'data',
  'code-run',
  'literature',
  'technical',
  'source',
]);

const PROCESS_ROLES = new Set([
  'meeting',
  'feedback',
  'revision',
  'writing',
  'presentation',
  'procedural',
  'decision-log',
  'open-questions',
  'next-actions',
  'progress-log',
]);

export function statusTone(value?: string | null): string {
  const normalized = String(value || '').toLowerCase();
  if (['done', 'complete', 'completed'].includes(normalized)) return 'done';
  if (['cancelled', 'dropped', 'archive', 'archived'].includes(normalized)) return 'archived';
  if (['blocked', 'needs-local-audit'].some((item) => normalized.includes(item))) return 'blocked';
  if (['waiting', 'pending', 'follow'].some((item) => normalized.includes(item))) return 'waiting';
  if (['draft', 'planned', 'scoping'].some((item) => normalized.includes(item))) return 'draft';
  if (['active', 'open'].some((item) => normalized.includes(item))) return 'open';
  return 'neutral';
}

export function priorityTone(value?: string | null): string {
  const normalized = String(value || '').trim();
  if (['1', 'p1'].includes(normalized.toLowerCase())) return 'p1';
  if (['2', 'p2'].includes(normalized.toLowerCase())) return 'p2';
  if (['3', 'p3'].includes(normalized.toLowerCase())) return 'p3';
  if (['4', 'p4'].includes(normalized.toLowerCase())) return 'p4';
  return 'none';
}

export function urgencyTone(entry: VaultEntry, today = new Date()): string {
  const days = daysUntil(entry.due || entry.date || entry.start_date, today);
  if (days === null) return 'undated';
  if (isSoftDeadline(entry)) {
    if (days < 0) return 'soft-overdue';
    if (days <= 7) return 'soft-soon';
    return 'scheduled';
  }
  if (days < 0) return 'overdue';
  if (days === 0) return 'today';
  if (days <= 7) return 'soon';
  return 'scheduled';
}

export function kindTone(entry: VaultEntry): string {
  const domain = entryDomain(entry);
  const lens = entryLens(entry).toLowerCase();
  const role = String(entry.note_role || '').toLowerCase();
  const collection = String(entry.collection || '').toLowerCase();
  if (entry.private) return 'private';
  if (domain === 'system' || domain === 'archive') return 'template';
  if (domain === 'teaching') return 'process';
  if (domain === 'personal') return 'health';
  if (lens === 'task') return 'task';
  if (lens === 'project' || lens === 'project-status' || lens === 'paper-status' || lens === 'project-note') return 'project';
  if (lens === 'event' || collection === 'calendar') return 'event';
  if (domain === 'admin') return 'admin';
  if (domain === 'research') return 'research';
  if (['wellness', 'health'].includes(String(entry.area || entry.properties?.module || '').toLowerCase())) return 'health';
  if (['collaborators', 'ra'].includes(String(entry.area || entry.properties?.module || '').toLowerCase())) return 'admin';
  if (RESEARCH_ROLES.has(role) || ['model-note', 'derivation-note', 'data-note', 'result-note', 'code-run-log', 'literature-note', 'technical-note'].includes(lens)) return 'research';
  if (PROCESS_ROLES.has(role) || ['meeting-note', 'feedback-note', 'revision-matrix', 'writing-note', 'presentation-note', 'procedural-note'].includes(lens)) return 'process';
  if (collection === 'docs' || lens === 'documentation') return 'docs';
  if (collection === 'templates' || lens === 'template' || lens === 'type') return 'template';
  if (collection === 'inbox' || lens === 'inbox-note') return 'inbox';
  if (collection === 'sources' || lens === 'source-note') return 'source';
  return 'note';
}

export function entryToneClass(entry: VaultEntry): string {
  return [
    'entry-tone',
    `tone-${kindTone(entry)}`,
    `status-${statusTone(entry.status)}`,
    `priority-${priorityTone(entry.priority)}`,
    `urgency-${urgencyTone(entry)}`,
    isManualUrgent(entry) ? 'manual-urgent' : '',
  ].join(' ');
}

export function kindToneClass(entry: VaultEntry): string {
  return `kind-tone tone-${kindTone(entry)}`;
}
