import { entryLens, isTask } from './filters';
import { daysUntil, isOpenTask, sortUrgentTasks, taskAssignee } from './overview';
import type { VaultEntry } from '../types';

export interface RAAssignmentSummary {
  entry: VaultEntry;
  status: string;
}

export interface RARecord {
  id: string;
  slug: string;
  name: string;
  status: string;
  person?: VaultEntry;
  assignments: RAAssignmentSummary[];
  checkins: VaultEntry[];
  communications: VaultEntry[];
  tasks: VaultEntry[];
  needsOwner: VaultEntry[];
  waitingOnRA: VaultEntry[];
  dueSoon: VaultEntry[];
  latestCheckin?: VaultEntry;
  currentDraft?: VaultEntry;
  focus: string;
}

export interface RAManagementData {
  records: RARecord[];
  allTasks: VaultEntry[];
  needsOwner: VaultEntry[];
  waitingOnRA: VaultEntry[];
  dueSoon: VaultEntry[];
  recentMemory: VaultEntry[];
  metrics: {
    activeCollaborators: number;
    openTasks: number;
    waiting: number;
    dueSoon: number;
    recentCheckins: number;
  };
}

const WAITING_STATUSES = ['waiting', 'blocked', 'pending', 'follow'];
const GENERIC_NAME_TOKENS = new Set(['example', 'sample', 'person', 'user']);

function slugify(value: unknown): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'unknown';
}

function scalar(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.map(scalar).filter(Boolean).join(' ');
  return String(value).trim();
}

function dateValue(entry: VaultEntry): number {
  const date = entry.date || entry.due || entry.start_date || entry.end_date || null;
  const parsed = date ? Date.parse(String(date)) : NaN;
  if (Number.isFinite(parsed)) return parsed;
  return (entry.modified_at || 0) * 1000;
}

function byRecentDate(a: VaultEntry, b: VaultEntry): number {
  return dateValue(b) - dateValue(a) || a.title.localeCompare(b.title);
}

function isRAPerson(entry: VaultEntry): boolean {
  const kind = String(entry.kind || entry.type || '').toLowerCase();
  return ['collaborator', 'collaborator-status', 'ra-status'].includes(kind);
}

function isRAAssignment(entry: VaultEntry): boolean {
  const kind = String(entry.kind || entry.type || '').toLowerCase();
  return ['collaborator-assignment', 'ra-assignment'].includes(kind);
}

function isRACheckin(entry: VaultEntry): boolean {
  const kind = String(entry.kind || entry.type || '').toLowerCase();
  return ['collaborator-checkin', 'ra-checkin'].includes(kind);
}

function isRACommunication(entry: VaultEntry): boolean {
  const kind = String(entry.kind || entry.type || '').toLowerCase();
  return ['collaborator-communication', 'ra-communication'].includes(kind);
}

function assignmentName(entry: VaultEntry): string {
  return taskAssignee(entry) || scalar(entry.properties?.assignee) || scalar(entry.properties?.assigned_to);
}

function shouldCreateRAFromAssignee(name: string, ownerAliases: Set<string>): boolean {
  return Boolean(name) && !ownerAliases.has(name.toLowerCase());
}

function entryHaystack(entry: VaultEntry): string {
  return [
    entry.path,
    entry.title,
    entry.id,
    entry.project,
    taskAssignee(entry),
    entry.next,
    entry.snippet,
    entry.kind,
    entry.type,
  ].map(scalar).join(' ').toLowerCase();
}

function recordTokens(record: Pick<RARecord, 'name' | 'slug'>): string[] {
  const name = record.name.toLowerCase();
  const pieces = name
    .split(/\s+/)
    .filter((part) => part.length >= 3 && !GENERIC_NAME_TOKENS.has(part));
  return Array.from(new Set([name, record.slug, record.slug.replace(/-/g, ' '), ...pieces]));
}

function entryMatchesRA(entry: VaultEntry, record: Pick<RARecord, 'name' | 'slug'>): boolean {
  const haystack = entryHaystack(entry);
  return recordTokens(record).some((token) => haystack.includes(token));
}

function taskMatchesRA(task: VaultEntry, record: Pick<RARecord, 'name' | 'slug'>): boolean {
  const assigned = taskAssignee(task).toLowerCase();
  if (assigned && recordTokens(record).some((token) => assigned.includes(token))) return true;
  const module = scalar(task.properties?.module).toLowerCase();
  const explicitHaystack = [
    task.path,
    task.title,
    task.id,
    ['collaborators', 'ra'].includes(module) ? task.next : '',
  ].map(scalar).join(' ').toLowerCase();
  return recordTokens(record).some((token) => explicitHaystack.includes(token));
}

function taskWaitingOnRA(task: VaultEntry, record: Pick<RARecord, 'name' | 'slug'>): boolean {
  const status = String(task.status || '').toLowerCase();
  if (WAITING_STATUSES.some((token) => status.includes(token))) return true;
  const assigned = taskAssignee(task).toLowerCase();
  return Boolean(assigned) && recordTokens(record).some((token) => assigned.includes(token));
}

function taskDueSoon(task: VaultEntry, today: Date): boolean {
  const days = daysUntil(task.due || task.date || task.start_date, today);
  return days !== null && days <= 14;
}

function communicationRank(entry: VaultEntry): number {
  const text = `${entry.title} ${entry.snippet || ''} ${entry.status || ''}`.toLowerCase();
  if (text.includes('superseded')) return 2;
  if (text.includes('draft') || text.includes('follow-up') || text.includes('followup')) return 0;
  return 1;
}

function uniqueEntries(entries: VaultEntry[]): VaultEntry[] {
  const seen = new Set<string>();
  const result: VaultEntry[] = [];
  for (const entry of entries) {
    if (seen.has(entry.path)) continue;
    seen.add(entry.path);
    result.push(entry);
  }
  return result;
}

function summaryText(entry?: VaultEntry): string {
  if (!entry) return 'No active assignment summary found yet.';
  return entry.next || entry.snippet || `${entryLens(entry)} · ${entry.path}`;
}

export function buildRAManagement(
  entries: VaultEntry[],
  today = new Date(),
  ownerAliases: string[] = ['owner', 'me', 'self'],
): RAManagementData {
  const records = new Map<string, RARecord>();
  const selfAssignees = new Set(ownerAliases.map((value) => value.trim().toLowerCase()).filter(Boolean));

  function ensureRecord(name: string, person?: VaultEntry): RARecord {
    const normalizedName = name.trim();
    const slug = slugify(normalizedName);
    const existing = records.get(slug);
    if (existing) {
      if (person && !existing.person) existing.person = person;
      return existing;
    }
    const record: RARecord = {
      id: slug,
      slug,
      name: normalizedName,
      status: person?.status || 'active',
      person,
      assignments: [],
      checkins: [],
      communications: [],
      tasks: [],
      needsOwner: [],
      waitingOnRA: [],
      dueSoon: [],
      focus: '',
    };
    records.set(slug, record);
    return record;
  }

  for (const entry of entries.filter(isRAPerson)) {
    ensureRecord(assignmentName(entry) || entry.title, entry);
  }

  for (const entry of entries.filter((item) => isRAAssignment(item) || isRACheckin(item) || isRACommunication(item))) {
    const assigned = assignmentName(entry);
    if (shouldCreateRAFromAssignee(assigned, selfAssignees)) ensureRecord(assigned);
  }

  const recordList = () => [...records.values()];

  for (const entry of entries.filter(isRAAssignment)) {
    const record = recordList().find((candidate) => entryMatchesRA(entry, candidate));
    if (record) record.assignments.push({ entry, status: entry.status || 'active' });
  }

  for (const entry of entries.filter(isRACheckin)) {
    const record = recordList().find((candidate) => entryMatchesRA(entry, candidate));
    if (record) record.checkins.push(entry);
  }

  for (const entry of entries.filter(isRACommunication)) {
    const record = recordList().find((candidate) => entryMatchesRA(entry, candidate));
    if (record) record.communications.push(entry);
  }

  const openTasks = entries.filter((entry) => {
    if (!isTask(entry) || !isOpenTask(entry)) return false;
    const area = scalar(entry.area).toLowerCase();
    const module = scalar(entry.properties?.module).toLowerCase();
    return ['collaborators', 'ra'].includes(area) || ['collaborators', 'ra'].includes(module);
  });
  for (const task of openTasks) {
    const record = recordList().find((candidate) => {
      if (taskMatchesRA(task, candidate)) return true;
      return entryMatchesRA(task, candidate);
    });
    if (record) record.tasks.push(task);
  }

  for (const record of recordList()) {
    record.assignments.sort((a, b) => byRecentDate(a.entry, b.entry));
    record.checkins.sort(byRecentDate);
    record.communications.sort((a, b) => communicationRank(a) - communicationRank(b) || byRecentDate(a, b));
    record.tasks = sortUrgentTasks(uniqueEntries(record.tasks), today);
    record.waitingOnRA = record.tasks.filter((task) => taskWaitingOnRA(task, record));
    record.needsOwner = record.tasks.filter((task) => !record.waitingOnRA.some((waiting) => waiting.path === task.path));
    record.dueSoon = record.tasks.filter((task) => taskDueSoon(task, today));
    record.latestCheckin = record.checkins[0];
    record.currentDraft = record.communications[0];
    record.status = record.person?.status || record.assignments[0]?.entry.status || record.status;
    record.focus = summaryText(record.assignments[0]?.entry || record.person);
  }

  const sortedRecords = recordList().sort((a, b) => {
    const activeDiff = Number(String(b.status).toLowerCase() === 'active') - Number(String(a.status).toLowerCase() === 'active');
    if (activeDiff !== 0) return activeDiff;
    const dueDiff = b.dueSoon.length - a.dueSoon.length;
    if (dueDiff !== 0) return dueDiff;
    return a.name.localeCompare(b.name);
  });
  const allTasks = sortUrgentTasks(uniqueEntries(sortedRecords.flatMap((record) => record.tasks)), today);
  const needsOwner = sortUrgentTasks(uniqueEntries(sortedRecords.flatMap((record) => record.needsOwner)), today);
  const waitingOnRA = sortUrgentTasks(uniqueEntries(sortedRecords.flatMap((record) => record.waitingOnRA)), today);
  const dueSoon = sortUrgentTasks(uniqueEntries(sortedRecords.flatMap((record) => record.dueSoon)), today);
  const recentMemory = uniqueEntries(sortedRecords.flatMap((record) => [
    ...record.checkins,
    ...record.assignments.map((assignment) => assignment.entry),
    ...record.communications,
  ])).sort(byRecentDate);

  return {
    records: sortedRecords,
    allTasks,
    needsOwner,
    waitingOnRA,
    dueSoon,
    recentMemory,
    metrics: {
      activeCollaborators: sortedRecords.filter((record) => String(record.status).toLowerCase() === 'active').length,
      openTasks: allTasks.length,
      waiting: waitingOnRA.length,
      dueSoon: dueSoon.length,
      recentCheckins: sortedRecords.flatMap((record) => record.checkins).filter((entry) => {
        const days = daysUntil(entry.date || entry.due || entry.start_date, today);
        return days !== null ? days >= -30 : true;
      }).length,
    },
  };
}
