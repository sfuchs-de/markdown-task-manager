import { entryLens, filterEntries, isTask } from './filters';
import { entryDomain } from './domain';
import { buildAdminCenter, type AdminCenterData } from './adminCenter';
import { buildCodexBacklog, type CodexBacklogData } from './codexInstructions';
import { buildPerformanceEvaluation, type PerformanceEvaluationData } from './performanceEvaluation';
import { buildProjectReview, daysUntil, isDeferredTask, isOpenTask, parseEntryDate, type ProjectReview } from './overview';
import { buildRAManagement, type RAManagementData } from './raManagement';
import { buildTravelCenter, type TravelCenterData } from './travelCenter';
import type { EntryFilters, VaultEntry } from '../types';

export type KanbanBucketId = 'now' | 'next' | 'waiting' | 'scheduled' | 'later';
export type TaskTimelineBucketId = 'overdue' | 'week-1' | 'week-2' | 'week-3' | 'week-4' | 'later' | 'undated';
export type TaskQueueBucketId = 'active' | 'queue' | 'waiting' | 'scheduled';
export type CalendarViewMode = 'month' | 'week' | 'year';
export type CalendarRangePosition = 'single' | 'start' | 'middle' | 'end';
export type CalendarHighlightKind = 'none' | 'conference' | 'seminar' | 'travel' | 'hard-deadline' | 'deadline' | 'meeting' | 'event';
export type CalendarImportance = 'normal' | 'major' | 'hard-deadline';

export interface KanbanColumn {
  id: KanbanBucketId;
  label: string;
  description: string;
  tasks: VaultEntry[];
}

export interface TaskTimelineGroup {
  id: TaskTimelineBucketId;
  label: string;
  description: string;
  tasks: VaultEntry[];
}

export interface TaskQueueGroup {
  id: TaskQueueBucketId;
  label: string;
  description: string;
  tasks: VaultEntry[];
}

export interface TypeGroup {
  lens: string;
  count: number;
  entries: VaultEntry[];
}

export interface CalendarItem {
  entry: VaultEntry;
  date: string;
  daysFromToday: number;
  lane: string;
  kind: 'task' | 'event' | 'entry';
  highlight: CalendarHighlightKind;
  highlightLabel: string;
  highlightShortLabel: string;
  importance: CalendarImportance;
  rangeStart?: string;
  rangeEnd?: string;
  rangePosition?: CalendarRangePosition;
}

export interface CalendarDay {
  iso: string;
  day: number;
  isToday: boolean;
  isCurrentMonth: boolean;
  items: CalendarItem[];
}

export interface CalendarMonth {
  label: string;
  month: number;
  year: number;
  total_items: number;
  weeks: CalendarDay[][];
}

export interface CalendarWeek {
  label: string;
  start: string;
  end: string;
  total_items: number;
  days: CalendarDay[];
}

export interface CalendarYear {
  label: string;
  year: number;
  total_items: number;
  months: CalendarMonth[];
}

export interface WorkbenchData {
  visibleEntries: VaultEntry[];
  filteredEntries: VaultEntry[];
  openTasks: VaultEntry[];
  taskBoard: KanbanColumn[];
  taskTimeline: TaskTimelineGroup[];
  activeTasks: VaultEntry[];
  taskQueue: TaskQueueGroup[];
  projectReview: ProjectReview[];
  typeGroups: TypeGroup[];
  domainGroups: TypeGroup[];
  collectionGroups: TypeGroup[];
  noteRoleGroups: TypeGroup[];
  adminCenter: AdminCenterData;
  performanceEvaluation: PerformanceEvaluationData;
  raManagement: RAManagementData;
  travelCenter: TravelCenterData;
  codexBacklog: CodexBacklogData;
  calendarItems: CalendarItem[];
  calendarMonth: CalendarMonth;
  recentEntries: VaultEntry[];
}

const KANBAN_COLUMNS: Array<Omit<KanbanColumn, 'tasks'>> = [
  { id: 'now', label: 'Now', description: 'Overdue, due soon, or P1' },
  { id: 'next', label: 'Next', description: 'Due in the next two weeks' },
  { id: 'waiting', label: 'Waiting', description: 'Blocked, waiting, or follow-up' },
  { id: 'scheduled', label: 'Scheduled', description: 'Dated beyond the next two weeks' },
  { id: 'later', label: 'Later', description: 'Open with no date' },
];

const TASK_TIMELINE_GROUPS: Array<Omit<TaskTimelineGroup, 'tasks'>> = [
  { id: 'overdue', label: 'Overdue', description: 'Past due and still open' },
  { id: 'week-1', label: 'This Week', description: 'Due in the next 7 days' },
  { id: 'week-2', label: 'Next Week', description: 'Due in 8-14 days' },
  { id: 'week-3', label: 'Week 3', description: 'Due in 15-21 days' },
  { id: 'week-4', label: 'Week 4', description: 'Due in 22-28 days' },
  { id: 'later', label: 'Later', description: 'Dated beyond four weeks' },
  { id: 'undated', label: 'No Date', description: 'Open tasks without a date' },
];

const TASK_QUEUE_GROUPS: Array<Omit<TaskQueueGroup, 'tasks'>> = [
  { id: 'active', label: 'Active', description: 'Near-term, high-priority, or in progress' },
  { id: 'queue', label: 'Queue', description: 'Ready but not urgent yet' },
  { id: 'waiting', label: 'Waiting', description: 'Blocked, pending, or follow-up' },
  { id: 'scheduled', label: 'Scheduled Later', description: 'Dated beyond the active window' },
];

function priorityValue(entry: VaultEntry): number {
  const parsed = Number(String(entry.priority || 99).match(/\d+/)?.[0] || 99);
  return Number.isFinite(parsed) ? parsed : 99;
}

function dateValue(entry: VaultEntry, today: Date): number {
  const days = daysUntil(entry.due || entry.date || entry.start_date, today);
  return days === null ? 9999 : days;
}

function formatIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(date: Date, amount: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + amount);
}

function firstEntryDate(entry: VaultEntry): string | null {
  const date = entry.due || entry.date || entry.start_date || null;
  return parseEntryDate(date) ? String(date).slice(0, 10) : null;
}

function entryCalendarRange(entry: VaultEntry): { start: string; end: string } | null {
  const startDate = parseEntryDate(entry.start_date);
  const endDate = parseEntryDate(entry.end_date);
  if (startDate && endDate && endDate.getTime() >= startDate.getTime()) {
    return {
      start: formatIsoDate(startDate),
      end: formatIsoDate(endDate),
    };
  }
  const single = firstEntryDate(entry);
  return single ? { start: single, end: single } : null;
}

function rangePosition(date: string, start: string, end: string): CalendarRangePosition {
  if (start === end) return 'single';
  if (date === start) return 'start';
  if (date === end) return 'end';
  return 'middle';
}

function isWaitingTask(entry: VaultEntry): boolean {
  const status = String(entry.status || '').toLowerCase();
  return ['waiting', 'blocked', 'follow', 'pending'].some((token) => status.includes(token));
}

function isExplicitlyActiveTask(entry: VaultEntry): boolean {
  const status = String(entry.status || '').toLowerCase();
  return ['active', 'doing', 'in-progress', 'in progress', 'now'].some((token) => status.includes(token));
}

function kanbanBucket(entry: VaultEntry, today: Date): KanbanBucketId {
  if (isDeferredTask(entry)) return 'later';
  if (isWaitingTask(entry)) return 'waiting';
  const days = daysUntil(entry.due || entry.date || entry.start_date, today);
  if (days !== null && days <= 3) return 'now';
  if (priorityValue(entry) === 1) return 'now';
  if (days !== null && days <= 14) return 'next';
  if (days !== null) return 'scheduled';
  return 'later';
}

function timelineBucket(entry: VaultEntry, today: Date): TaskTimelineBucketId {
  const days = daysUntil(entry.due || entry.date || entry.start_date, today);
  if (days === null) return 'undated';
  if (days < 0) return 'overdue';
  if (days <= 6) return 'week-1';
  if (days <= 13) return 'week-2';
  if (days <= 20) return 'week-3';
  if (days <= 27) return 'week-4';
  return 'later';
}

export function isActiveWorkbenchTask(entry: VaultEntry, today = new Date()): boolean {
  if (isDeferredTask(entry)) return false;
  if (isWaitingTask(entry)) return false;
  const days = daysUntil(entry.due || entry.date || entry.start_date, today);
  const priorityIsActive = priorityValue(entry) <= 2 && (days === null || days <= 28);
  return isExplicitlyActiveTask(entry) || priorityIsActive || (days !== null && days <= 14);
}

function queueBucket(entry: VaultEntry, today: Date): TaskQueueBucketId {
  if (isWaitingTask(entry)) return 'waiting';
  if (isActiveWorkbenchTask(entry, today)) return 'active';
  const days = daysUntil(entry.due || entry.date || entry.start_date, today);
  if (days !== null && days > 14) return 'scheduled';
  return 'queue';
}

function calendarLane(entry: VaultEntry): string {
  if (isTask(entry)) return entry.project || 'Task';
  return entry.project || entryLens(entry);
}

function calendarKind(entry: VaultEntry): CalendarItem['kind'] {
  if (isTask(entry)) return 'task';
  if (entryLens(entry).toLowerCase() === 'event') return 'event';
  return 'entry';
}

function entryCalendarText(entry: VaultEntry): string {
  return [
    entry.title,
    entry.path,
    entry.filename,
    entry.project,
    entry.domain,
    entry.area,
    entry.kind,
    entry.type,
    entry.note_role,
    entry.next,
  ].filter(Boolean).join(' ').toLowerCase();
}

function calendarHighlightForEntry(
  entry: VaultEntry,
  range: { start: string; end: string },
): Pick<CalendarItem, 'highlight' | 'highlightLabel' | 'highlightShortLabel' | 'importance'> {
  const text = entryCalendarText(entry);
  const kind = calendarKind(entry);
  const isRange = range.start !== range.end;
  const isHardDeadline = isTask(entry) && String(entry.deadline_type || '').toLowerCase() === 'hard';

  if (isHardDeadline) {
    return {
      highlight: 'hard-deadline',
      highlightLabel: 'Hard deadline',
      highlightShortLabel: 'Hard',
      importance: 'hard-deadline',
    };
  }
  if (/\b(conference|workshop|congress|symposium|forum|summer institute)\b/.test(text)) {
    return {
      highlight: 'conference',
      highlightLabel: 'Conference',
      highlightShortLabel: 'Conf',
      importance: 'major',
    };
  }
  if (/\b(seminar|talk|presentation|presenter|colloquium)\b/.test(text)) {
    return {
      highlight: 'seminar',
      highlightLabel: 'Seminar',
      highlightShortLabel: 'Sem',
      importance: 'major',
    };
  }
  if (/\b(travel|flight|hotel|lodging|itinerary|booking|trip)\b/.test(text)) {
    return {
      highlight: 'travel',
      highlightLabel: 'Travel',
      highlightShortLabel: 'Trip',
      importance: 'major',
    };
  }
  if (isTask(entry) && (entry.due || entry.deadline)) {
    return {
      highlight: 'deadline',
      highlightLabel: 'Deadline',
      highlightShortLabel: 'Due',
      importance: 'normal',
    };
  }
  if (/\b(meeting|call|zoom|check-in|checkin)\b/.test(text)) {
    return {
      highlight: 'meeting',
      highlightLabel: 'Meeting',
      highlightShortLabel: 'Meet',
      importance: isRange ? 'major' : 'normal',
    };
  }
  if (kind !== 'task') {
    return {
      highlight: 'none',
      highlightLabel: '',
      highlightShortLabel: '',
      importance: isRange ? 'major' : 'normal',
    };
  }
  return {
    highlight: 'none',
    highlightLabel: '',
    highlightShortLabel: '',
    importance: 'normal',
  };
}

function isCalendarEntry(entry: VaultEntry): boolean {
  if (isTask(entry)) return isOpenTask(entry);
  const lens = entryLens(entry).toLowerCase();
  return lens === 'event' || lens === 'date' || entry.path.startsWith('dates/');
}

function typeGroupRank(lens: string): number {
  const normalized = lens.toLowerCase();
  if (normalized === 'untyped') return 3;
  if (normalized === 'type') return 2;
  return 1;
}

function entryNoiseRank(entry: VaultEntry): number {
  const text = `${entry.path} ${entry.title} ${entry.filename}`.toLowerCase();
  if (text.includes('{{') || text.includes('/templates/') || text.includes('/_templates/')) return 2;
  if (entryLens(entry).toLowerCase() === 'type') return 1;
  return 0;
}

export function visibleEntries(entries: VaultEntry[], privateMode: boolean): VaultEntry[] {
  return privateMode ? entries.filter((entry) => !entry.private) : entries;
}

export function sortOpenTasks(tasks: VaultEntry[], today = new Date()): VaultEntry[] {
  return [...tasks].sort((a, b) => {
    const priorityDiff = priorityValue(a) - priorityValue(b);
    if (priorityDiff !== 0) return priorityDiff;
    const dateDiff = dateValue(a, today) - dateValue(b, today);
    if (dateDiff !== 0) return dateDiff;
    return a.title.localeCompare(b.title);
  });
}

export function buildOpenTasks(entries: VaultEntry[], filters: EntryFilters, today = new Date()): VaultEntry[] {
  return sortOpenTasks(entries.filter(isOpenTask), today).filter((entry) => {
    if (filters.domain && entryDomain(entry) !== filters.domain) return false;
    if (filters.taskStatus && entry.status !== filters.taskStatus) return false;
    if (filters.taskPriority && String(entry.priority || '') !== filters.taskPriority) return false;
    if (filters.taskProject && entry.project !== filters.taskProject) return false;
    return true;
  });
}

export function buildTaskBoard(tasks: VaultEntry[], today = new Date()): KanbanColumn[] {
  const groups = new Map<KanbanBucketId, VaultEntry[]>();
  for (const task of tasks) {
    const bucket = kanbanBucket(task, today);
    groups.set(bucket, [...(groups.get(bucket) || []), task]);
  }
  return KANBAN_COLUMNS.map((column) => ({
    ...column,
    tasks: sortOpenTasks(groups.get(column.id) || [], today),
  }));
}

export function buildTaskTimeline(tasks: VaultEntry[], today = new Date()): TaskTimelineGroup[] {
  const groups = new Map<TaskTimelineBucketId, VaultEntry[]>();
  for (const task of tasks) {
    const bucket = timelineBucket(task, today);
    groups.set(bucket, [...(groups.get(bucket) || []), task]);
  }
  return TASK_TIMELINE_GROUPS.map((group) => ({
    ...group,
    tasks: sortOpenTasks(groups.get(group.id) || [], today),
  }));
}

export function buildActiveTasks(tasks: VaultEntry[], today = new Date()): VaultEntry[] {
  return sortOpenTasks(tasks.filter((task) => isActiveWorkbenchTask(task, today)), today);
}

export function buildTaskQueue(tasks: VaultEntry[], today = new Date()): TaskQueueGroup[] {
  const groups = new Map<TaskQueueBucketId, VaultEntry[]>();
  for (const task of tasks) {
    const bucket = queueBucket(task, today);
    groups.set(bucket, [...(groups.get(bucket) || []), task]);
  }
  return TASK_QUEUE_GROUPS.map((group) => ({
    ...group,
    tasks: sortOpenTasks(groups.get(group.id) || [], today),
  }));
}

export function buildTypeGroups(entries: VaultEntry[]): TypeGroup[] {
  return buildGroups(entries, (entry) => entryLens(entry), (lens) => typeGroupRank(lens));
}

function buildGroups(entries: VaultEntry[], keyForEntry: (entry: VaultEntry) => string | null | undefined, rank: (lens: string) => number = () => 1): TypeGroup[] {
  const groups = new Map<string, VaultEntry[]>();
  for (const entry of entries) {
    const lens = keyForEntry(entry);
    if (!lens) continue;
    groups.set(lens, [...(groups.get(lens) || []), entry]);
  }
  return [...groups.entries()]
    .map(([lens, groupEntries]) => ({
      lens,
      count: groupEntries.length,
      entries: groupEntries
        .sort((a, b) => entryNoiseRank(a) - entryNoiseRank(b) || a.title.localeCompare(b.title))
        .slice(0, 6),
    }))
    .sort((a, b) => rank(a.lens) - rank(b.lens) || b.count - a.count || a.lens.localeCompare(b.lens));
}

export function buildCollectionGroups(entries: VaultEntry[]): TypeGroup[] {
  return buildGroups(entries, (entry) => entry.collection || 'root');
}

export function buildDomainGroups(entries: VaultEntry[]): TypeGroup[] {
  const rank: Record<string, number> = {
    research: 1,
    admin: 2,
    teaching: 3,
    personal: 4,
    system: 5,
    archive: 6,
  };
  return buildGroups(entries, (entry) => entryDomain(entry), (lens) => rank[lens] || 10);
}

export function buildNoteRoleGroups(entries: VaultEntry[]): TypeGroup[] {
  return buildGroups(entries, (entry) => entry.note_role);
}

// A task in a finished lifecycle folder is finished regardless of its status
// field, so the calendar never shows it even if the status is stale/missing.
const FINISHED_TASK_DIR = /^(?:tasks\/(?:done|cancelled|canceled|archive|archived)|archive)\//;

export function isFinishedTask(entry: VaultEntry): boolean {
  return isTask(entry) && (!isOpenTask(entry) || FINISHED_TASK_DIR.test(entry.path));
}

export function buildCalendarItems(entries: VaultEntry[], today = new Date()): CalendarItem[] {
  return entries
    .filter((entry) => {
      if (isFinishedTask(entry)) return false;
      if (!entryCalendarRange(entry)) return false;
      return isCalendarEntry(entry);
    })
    .flatMap((entry) => {
      const range = entryCalendarRange(entry) as { start: string; end: string };
      const startDate = parseEntryDate(range.start) as Date;
      const endDate = parseEntryDate(range.end) as Date;
      const highlight = calendarHighlightForEntry(entry, range);
      const items: CalendarItem[] = [];
      for (let date = startDate; date.getTime() <= endDate.getTime(); date = addDays(date, 1)) {
        const iso = formatIsoDate(date);
        items.push({
          entry,
          date: iso,
          daysFromToday: daysUntil(iso, today) ?? 9999,
          lane: calendarLane(entry),
          kind: calendarKind(entry),
          ...highlight,
          rangeStart: range.start,
          rangeEnd: range.end,
          rangePosition: rangePosition(iso, range.start, range.end),
        });
      }
      return items;
    })
    .sort((a, b) => {
      const dateDiff = a.daysFromToday - b.daysFromToday;
      if (dateDiff !== 0) return dateDiff;
      const priorityDiff = priorityValue(a.entry) - priorityValue(b.entry);
      if (priorityDiff !== 0) return priorityDiff;
      return a.entry.title.localeCompare(b.entry.title);
    });
}

function itemsByDate(items: CalendarItem[]): Map<string, CalendarItem[]> {
  const grouped = new Map<string, CalendarItem[]>();
  for (const item of items) {
    grouped.set(item.date, [...(grouped.get(item.date) || []), item]);
  }
  return grouped;
}

function totalItemsInDays(days: CalendarDay[]): number {
  return days.reduce((sum, day) => sum + day.items.length, 0);
}

export function buildCalendarMonth(items: CalendarItem[], anchorDate = new Date(), today = new Date()): CalendarMonth {
  const monthStart = new Date(anchorDate.getFullYear(), anchorDate.getMonth(), 1);
  const firstVisible = addDays(monthStart, -monthStart.getDay());
  const monthLabel = monthStart.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const groupedItems = itemsByDate(items);
  const weeks: CalendarDay[][] = [];
  for (let week = 0; week < 6; week += 1) {
    const days: CalendarDay[] = [];
    for (let weekday = 0; weekday < 7; weekday += 1) {
      const date = addDays(firstVisible, week * 7 + weekday);
      const iso = formatIsoDate(date);
      days.push({
        iso,
        day: date.getDate(),
        isToday: iso === formatIsoDate(today),
        isCurrentMonth: date.getMonth() === anchorDate.getMonth(),
        items: groupedItems.get(iso) || [],
      });
    }
    weeks.push(days);
  }
  const monthDays = weeks.flat().filter((day) => day.isCurrentMonth);
  return {
    label: monthLabel,
    month: monthStart.getMonth(),
    year: monthStart.getFullYear(),
    total_items: totalItemsInDays(monthDays),
    weeks,
  };
}

export function buildCalendarWeek(items: CalendarItem[], anchorDate = new Date(), today = new Date()): CalendarWeek {
  const firstVisible = addDays(anchorDate, -anchorDate.getDay());
  const groupedItems = itemsByDate(items);
  const days: CalendarDay[] = [];
  for (let weekday = 0; weekday < 7; weekday += 1) {
    const date = addDays(firstVisible, weekday);
    const iso = formatIsoDate(date);
    days.push({
      iso,
      day: date.getDate(),
      isToday: iso === formatIsoDate(today),
      isCurrentMonth: true,
      items: groupedItems.get(iso) || [],
    });
  }
  const start = days[0].iso;
  const end = days[6].iso;
  return {
    label: `${firstVisible.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} - ${addDays(firstVisible, 6).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`,
    start,
    end,
    total_items: totalItemsInDays(days),
    days,
  };
}

export function buildCalendarYear(items: CalendarItem[], anchorDate = new Date(), today = new Date()): CalendarYear {
  const year = anchorDate.getFullYear();
  const months = Array.from({ length: 12 }, (_, month) => buildCalendarMonth(items, new Date(year, month, 1), today));
  return {
    label: String(year),
    year,
    total_items: months.reduce((sum, month) => sum + month.total_items, 0),
    months,
  };
}

export function buildWorkbenchData(
  entries: VaultEntry[],
  filters: EntryFilters,
  today = new Date(),
  options: { ownerAliases?: string[] } = {},
): WorkbenchData {
  const visible = visibleEntries(entries, filters.privateMode);
  const openTasks = buildOpenTasks(visible, filters, today);
  const calendarItems = buildCalendarItems(visible, today);
  return {
    visibleEntries: visible,
    filteredEntries: filterEntries(visible, filters),
    openTasks,
    taskBoard: buildTaskBoard(openTasks, today),
    taskTimeline: buildTaskTimeline(openTasks, today),
    activeTasks: buildActiveTasks(openTasks, today),
    taskQueue: buildTaskQueue(openTasks, today),
    projectReview: buildProjectReview(visible, visible.filter(isOpenTask), today),
    typeGroups: buildTypeGroups(visible),
    domainGroups: buildDomainGroups(visible),
    collectionGroups: buildCollectionGroups(visible),
    noteRoleGroups: buildNoteRoleGroups(visible),
    adminCenter: buildAdminCenter(visible, today),
    performanceEvaluation: buildPerformanceEvaluation(visible),
    raManagement: buildRAManagement(visible, today, options.ownerAliases),
    travelCenter: buildTravelCenter(visible, openTasks, today),
    codexBacklog: buildCodexBacklog(visible),
    calendarItems,
    calendarMonth: buildCalendarMonth(calendarItems, today, today),
    recentEntries: [...visible].sort((a, b) => (b.modified_at || 0) - (a.modified_at || 0)),
  };
}
