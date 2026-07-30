import { entryDomain } from './domain';
import { isTask } from './filters';
import { daysUntil, isOpenTask } from './overview';
import type { VaultEntry } from '../types';

export type AdminLaneId = 'urgent' | 'forms' | 'policy-service' | 'life-admin' | 'waiting' | 'later';
export type AdminCategory = 'work-admin' | 'forms-approvals' | 'policy-service' | 'life-admin';

export interface AdminLane {
  id: AdminLaneId;
  title: string;
  detail: string;
  entries: VaultEntry[];
}

export interface AdminCenterMetrics {
  total: number;
  urgent: number;
  dueSoon: number;
  waiting: number;
  formsApprovals: number;
  lifeAdmin: number;
}

export interface AdminCenterData {
  tasks: VaultEntry[];
  lanes: AdminLane[];
  metrics: AdminCenterMetrics;
}

const INCLUDED_PROJECT_AREAS = new Set([
  'admin',
  'life-admin',
  'policy',
  'service',
  'research/service',
]);
const WAITING_STATUSES = new Set(['waiting', 'blocked']);

function normalized(value?: unknown): string {
  return String(value || '').trim().toLowerCase();
}

function priorityValue(entry: VaultEntry): number {
  const parsed = Number(String(entry.priority || 99).match(/\d+/)?.[0] || 99);
  return Number.isFinite(parsed) ? parsed : 99;
}

function projectKey(entry: VaultEntry): string {
  return normalized(entry.project || entry.inferred_project || entry.explicit_project);
}

function projectAreaMap(entries: VaultEntry[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const entry of entries) {
    if (!/^projects\/[^/]+\/README\.md$/.test(entry.path)) continue;
    const id = normalized(entry.id || entry.project || entry.path.split('/')[1]);
    if (!id) continue;
    map.set(id, normalized(entry.area || (entry.properties?.area as string | undefined)));
  }
  return map;
}

function metadataValue(entry: VaultEntry, field: string): string {
  const record = entry as unknown as Record<string, unknown>;
  return normalized(record[field] ?? entry.properties?.[field]);
}

function isDedicatedPanelTask(entry: VaultEntry): boolean {
  return ['travel', 'collaborators', 'wellness'].includes(metadataValue(entry, 'module'));
}

export function isAdminCenterTask(entry: VaultEntry, entries: VaultEntry[] = [entry]): boolean {
  if (!isOpenTask(entry) || !isTask(entry)) return false;
  if (isDedicatedPanelTask(entry)) return false;

  const project = projectKey(entry);

  const areas = projectAreaMap(entries);
  const projectArea = areas.get(project);
  if (projectArea && INCLUDED_PROJECT_AREAS.has(projectArea)) return true;

  const explicitDomain = normalized(entry.domain || entry.area || (entry.properties?.domain as string | undefined));
  if (['admin', 'service', 'policy', 'life-admin'].includes(explicitDomain)) return true;

  const domain = entryDomain(entry);
  return domain === 'admin' && !project;
}

function adminCategory(entry: VaultEntry, areas: Map<string, string>): AdminCategory {
  const project = projectKey(entry);
  const area = areas.get(project) || '';
  const explicit = metadataValue(entry, 'admin_category');
  if (['work-admin', 'forms-approvals', 'policy-service', 'life-admin'].includes(explicit)) return explicit as AdminCategory;
  if (area === 'life-admin') return 'life-admin';
  if (area === 'policy' || area === 'service' || area === 'research/service') return 'policy-service';
  return 'work-admin';
}

function isWaiting(entry: VaultEntry): boolean {
  return WAITING_STATUSES.has(normalized(entry.status));
}

function isUrgent(entry: VaultEntry, today: Date): boolean {
  const days = daysUntil(entry.due || entry.date || entry.start_date, today);
  return priorityValue(entry) === 1 || (days !== null && days <= 7);
}

function adminLaneId(entry: VaultEntry, areas: Map<string, string>, today: Date): AdminLaneId {
  if (isWaiting(entry)) return 'waiting';
  if (isUrgent(entry, today)) return 'urgent';
  const category = adminCategory(entry, areas);
  if (category === 'forms-approvals') return 'forms';
  if (category === 'policy-service') return 'policy-service';
  if (category === 'life-admin') return 'life-admin';
  return 'later';
}

function sortAdminTasks(tasks: VaultEntry[], today: Date): VaultEntry[] {
  return [...tasks].sort((a, b) => {
    const priorityDiff = priorityValue(a) - priorityValue(b);
    if (priorityDiff !== 0) return priorityDiff;
    const dateDiff = (daysUntil(a.due || a.date || a.start_date, today) ?? 9999) - (daysUntil(b.due || b.date || b.start_date, today) ?? 9999);
    return dateDiff !== 0 ? dateDiff : a.title.localeCompare(b.title);
  });
}

const LANE_META: Array<Omit<AdminLane, 'entries'>> = [
  { id: 'urgent', title: 'Urgent', detail: 'P1, overdue, or due this week' },
  { id: 'forms', title: 'Forms / approvals', detail: 'Signatures, submissions, verification, evaluations' },
  { id: 'policy-service', title: 'Policy + service', detail: 'Policy prep, conference organization, referee/service work' },
  { id: 'life-admin', title: 'Life admin', detail: 'Personal logistics and household administration' },
  { id: 'waiting', title: 'Waiting', detail: 'Blocked or waiting on someone else' },
  { id: 'later', title: 'Later', detail: 'Open admin queue without near-term pressure' },
];

export function buildAdminCenter(entries: VaultEntry[], today = new Date()): AdminCenterData {
  const areas = projectAreaMap(entries);
  const tasks = sortAdminTasks(entries.filter((entry) => isAdminCenterTask(entry, entries)), today);
  const categories = tasks.map((task) => adminCategory(task, areas));
  const dueSoon = tasks.filter((task) => {
    const days = daysUntil(task.due || task.date || task.start_date, today);
    return days !== null && days <= 14;
  });
  const lanes = LANE_META.map((lane) => ({
    ...lane,
    entries: tasks.filter((task) => adminLaneId(task, areas, today) === lane.id),
  }));
  return {
    tasks,
    lanes,
    metrics: {
      total: tasks.length,
      urgent: lanes.find((lane) => lane.id === 'urgent')?.entries.length || 0,
      dueSoon: dueSoon.length,
      waiting: lanes.find((lane) => lane.id === 'waiting')?.entries.length || 0,
      formsApprovals: categories.filter((category) => category === 'forms-approvals').length,
      lifeAdmin: categories.filter((category) => category === 'life-admin').length,
    },
  };
}
