import { entryLens, isTask } from './filters';
import { entryDomain } from './domain';
import { deadlineTypeLabel, isHardDeadline, isSoftDeadline, type DeadlineType } from './deadlines';
import { buildTravelCenter, type OverviewTravelItem, type TravelCenterSummary } from './travelCenter';
import { buildSubmissions, isConferenceSubmissionDeadline, type ConferenceSubmission } from './submissions';
import { buildRefereeReports, type RefereeReport } from './refereeReports';
import { buildProjectPulse, type ProjectPulse } from './projectPulse';
import type { VaultEntry } from '../types';

export { buildUpcomingTravel } from './travelCenter';
export type { ProjectPulse };

/** The single most pressing date for a project: its own deadline or an open task's. */
export interface ProjectNextDeadline {
  date: string;
  type: DeadlineType;
  daysUntil: number | null;
  source: 'project' | 'task';
  label: string;
}

export interface ProjectReview {
  project: VaultEntry;
  openTaskCount: number;
  openTasks: VaultEntry[];
  coauthorTaskCount: number;
  coauthorTasks: VaultEntry[];
  recentEntries: VaultEntry[];
  stale: boolean;
  staleReason: string;
  /** Tasks this project has completed within the last three weeks. */
  recentCompletionCount: number;
  /** Newest modification timestamp across the project page and its artifacts. */
  latestActivityTs: number;
  /** Open project tasks that are manually urgent or due within a week. */
  urgentTaskCount: number;
  /** Soonest deadline among the project page and its open tasks. */
  nextDeadline: ProjectNextDeadline | null;
}

export interface OverviewData {
  visibleEntries: VaultEntry[];
  openTasks: VaultEntry[];
  coauthorTasks: VaultEntry[];
  mustNotSlip: VaultEntry[];
  priorityStack: Record<'1' | '2' | '3', VaultEntry[]>;
  projectReview: ProjectReview[];
  projectPulse: ProjectPulse[];
  triage: OverviewTriage;
  taskGroups: OverviewTaskGroup[];
  upcomingTravel: OverviewTravelItem[];
  travelSummary: TravelCenterSummary;
  upcomingDeadlines: VaultEntry[];
  upcomingDates: VaultEntry[];
  recentActivity: VaultEntry[];
  activityHeatmap: OverviewActivityHeatmap;
  submissions: ConferenceSubmission[];
  refereeReports: RefereeReport[];
}

const DONE_STATUSES = new Set(['done', 'complete', 'completed', 'cancelled', 'dropped', 'archive', 'archived']);
const WAITING_STATUSES = new Set(['waiting', 'blocked']);
const DEFERRED_STATUSES = new Set(['someday', 'later', 'parked', 'paused']);
let SELF_ASSIGNEES = new Set(['owner', 'me', 'self']);

export function configureOwnerAliases(aliases: string[]): void {
  SELF_ASSIGNEES = new Set(aliases.map((value) => value.trim().toLowerCase()).filter(Boolean));
}

export interface OverviewTriage {
  now: VaultEntry[];
  next: VaultEntry[];
  waiting: VaultEntry[];
  review: ProjectReview[];
}

export interface OverviewTaskGroup {
  key: 'research' | 'other';
  title: string;
  detail: string;
  totalCount: number;
  now: VaultEntry[];
  next: VaultEntry[];
  waiting: VaultEntry[];
}

export interface OverviewActivityDay {
  date: string;
  edits: number;
  completed: number;
  total: number;
  level: 0 | 1 | 2 | 3 | 4;
}

export interface OverviewActivityHeatmap {
  startDate: string;
  endDate: string;
  days: OverviewActivityDay[];
  totalEdits: number;
  totalCompleted: number;
  activeDays: number;
  maxTotal: number;
}

export type { OverviewTravelItem };

function dayNumber(date: Date): number {
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000);
}

function localDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function dateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function dateKeyFromTimestamp(value?: number | null): string | null {
  if (!value || !Number.isFinite(value)) return null;
  return dateKey(new Date(value * 1000));
}

export function parseEntryDate(value?: string | null): Date | null {
  if (!value) return null;
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const [, y, m, d] = match;
  return new Date(Number(y), Number(m) - 1, Number(d));
}

export function daysUntil(value: string | null | undefined, today = new Date()): number | null {
  const parsed = parseEntryDate(value);
  if (!parsed) return null;
  return dayNumber(parsed) - dayNumber(today);
}

export function isOpenTask(entry: VaultEntry): boolean {
  return isTask(entry) && !DONE_STATUSES.has(String(entry.status || '').toLowerCase());
}

function scalarText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.map(scalarText).filter(Boolean).join(', ');
  return String(value).trim();
}

function completionDateKey(entry: VaultEntry): string | null {
  const explicit = scalarText(
    entry.properties?.completed ||
    entry.properties?.completed_at ||
    entry.properties?.done_on ||
    entry.properties?.closed_on,
  );
  if (explicit) {
    const parsed = parseEntryDate(explicit);
    if (parsed) return dateKey(parsed);
  }
  const status = String(entry.status || '').toLowerCase();
  if (isTask(entry) && ['done', 'complete', 'completed'].includes(status) && entry.path.startsWith('tasks/done/')) {
    return dateKeyFromTimestamp(entry.modified_at);
  }
  return null;
}

function activityLevel(total: number): OverviewActivityDay['level'] {
  if (total <= 0) return 0;
  if (total === 1) return 1;
  if (total <= 3) return 2;
  if (total <= 7) return 3;
  return 4;
}

export function buildActivityHeatmap(entries: VaultEntry[], today = new Date(), weeks = 14): OverviewActivityHeatmap {
  const end = localDay(today);
  const start = addDays(end, -((weeks - 1) * 7 + end.getDay()));
  const dayCount = Math.max(7, dayNumber(end) - dayNumber(start) + 1);
  const byDate = new Map<string, { edits: Set<string>; completed: Set<string> }>();

  for (let offset = 0; offset < dayCount; offset += 1) {
    byDate.set(dateKey(addDays(start, offset)), { edits: new Set(), completed: new Set() });
  }

  for (const entry of entries) {
    const edited = dateKeyFromTimestamp(entry.modified_at);
    if (edited && byDate.has(edited)) {
      byDate.get(edited)?.edits.add(entry.path);
    }

    const completed = completionDateKey(entry);
    if (completed && byDate.has(completed)) {
      byDate.get(completed)?.completed.add(entry.path);
    }
  }

  const days = [...byDate.entries()].map(([date, value]) => {
    const edits = value.edits.size;
    const completed = value.completed.size;
    const total = edits + completed;
    return { date, edits, completed, total, level: activityLevel(total) };
  });

  return {
    startDate: dateKey(start),
    endDate: dateKey(end),
    days,
    totalEdits: days.reduce((sum, day) => sum + day.edits, 0),
    totalCompleted: days.reduce((sum, day) => sum + day.completed, 0),
    activeDays: days.filter((day) => day.total > 0).length,
    maxTotal: Math.max(0, ...days.map((day) => day.total)),
  };
}

export function taskAssignee(entry: VaultEntry): string {
  return scalarText(
    entry.assignee ||
    entry.assigned_to ||
    entry.owner ||
    entry.properties?.assignee ||
    entry.properties?.assigned_to ||
    entry.properties?.owner,
  );
}

export function isCoauthorAssignedTask(entry: VaultEntry): boolean {
  const assignee = taskAssignee(entry);
  if (!assignee) return false;
  return !SELF_ASSIGNEES.has(assignee.toLowerCase());
}

export function isProject(entry: VaultEntry): boolean {
  return entryLens(entry).toLowerCase() === 'project' || /^projects\/[^/]+\/README\.md$/.test(entry.path);
}

function isTopLevelProjectReadme(entry: VaultEntry): boolean {
  return /^projects\/[^/]+\/README\.md$/.test(entry.path);
}

function projectRecordRank(entry: VaultEntry): number {
  if (isTopLevelProjectReadme(entry)) return 0;
  if (entry.path.startsWith('projects/')) return 1;
  return 2;
}

function priorityNumber(entry: VaultEntry): number {
  const parsed = Number(String(entry.priority || 99).match(/\d+/)?.[0] || 99);
  return Number.isFinite(parsed) ? parsed : 99;
}

function statusKey(entry: VaultEntry): string {
  return String(entry.status || '').toLowerCase();
}

export function isManualUrgent(entry: VaultEntry): boolean {
  const value = entry.urgent ?? entry.focus_manual ?? entry.properties?.urgent ?? entry.properties?.focus_manual;
  if (value === true) return true;
  return ['true', '1', 'yes', 'urgent', 'focus'].includes(String(value || '').toLowerCase());
}

function focusRankNumber(entry: VaultEntry): number | null {
  const value = entry.focus_rank ?? entry.properties?.focus_rank;
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(String(value).match(/\d+/)?.[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function hasExplicitFocus(entry: VaultEntry): boolean {
  return isManualUrgent(entry) || focusRankNumber(entry) !== null;
}

function hasCalendarBlockedSignal(entry: VaultEntry, today: Date): boolean {
  const blockedValue =
    entry.properties?.calendar_blocked ??
    entry.properties?.calendar_conflict ??
    entry.properties?.time_conflict ??
    entry.properties?.blocked_by_calendar;
  if (blockedValue === true) return true;
  if (['true', '1', 'yes', 'blocked', 'calendar'].includes(String(blockedValue || '').toLowerCase())) return true;
  const blockDay = entry.block_day ?? entry.properties?.block_day;
  return Boolean(blockDay && daysUntil(String(blockDay), today) === 0);
}

export function isDeferredTask(entry: VaultEntry): boolean {
  if (!isTask(entry)) return false;
  const status = statusKey(entry);
  return DEFERRED_STATUSES.has(status) || entry.path.includes('/someday/') || (priorityNumber(entry) >= 4 && !hasExplicitFocus(entry));
}

export function focusReason(entry: VaultEntry, today = new Date()): string | null {
  const focusRank = focusRankNumber(entry);
  if (focusRank !== null) return `focus #${focusRank}`;
  if (isManualUrgent(entry)) return 'manual';
  if (isWaitingTask(entry)) return null;
  if (hasCalendarBlockedSignal(entry, today)) return 'calendar blocked';
  const due = daysUntil(entry.due || entry.date, today);
  if (isHardDeadline(entry) && due !== null) {
    if (due === 0) return 'due today';
    if (due < 0 || due <= 7) return 'hard deadline';
  }
  if (priorityNumber(entry) <= 1 && due !== null && due <= 7) return 'P1 due soon';
  if (softOverdueEnough(entry, today)) return 'stale';
  return null;
}

function entryKey(entry: VaultEntry): string {
  return entry.path || entry.title;
}

function dueSortValue(entry: VaultEntry, today: Date): number {
  const due = daysUntil(entry.due || entry.date, today);
  return due === null ? 9999 : due;
}

function datedSortValue(entry: VaultEntry, today: Date): number {
  const due = daysUntil(entry.due || entry.date || entry.start_date, today);
  return due === null ? 9999 : due;
}

function hardDueWithin(entry: VaultEntry, days: number, today: Date): boolean {
  const due = daysUntil(entry.due || entry.date, today);
  return isHardDeadline(entry) && due !== null && due <= days;
}

function softOverdueEnough(entry: VaultEntry, today: Date): boolean {
  const due = daysUntil(entry.due || entry.date, today);
  return isSoftDeadline(entry) && priorityNumber(entry) <= 2 && !WAITING_STATUSES.has(statusKey(entry)) && !isDeferredTask(entry) && due !== null && due <= -7;
}

function isOverviewFocusTask(entry: VaultEntry, today: Date): boolean {
  if (isWaitingTask(entry)) return false;
  if (isDeferredTask(entry)) return false;
  if (hasExplicitFocus(entry)) return true;
  if (hasCalendarBlockedSignal(entry, today)) return true;
  const due = daysUntil(entry.due || entry.date, today);
  if (isHardDeadline(entry) && due !== null && due <= 7) return true;
  if (priorityNumber(entry) <= 1 && due !== null && due <= 7) return true;
  return softOverdueEnough(entry, today);
}

function uniqueByPath(entries: VaultEntry[]): VaultEntry[] {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    const key = entryKey(entry);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function sortFocusTasks(tasks: VaultEntry[], today = new Date()): VaultEntry[] {
  return [...tasks].sort((a, b) => {
    const explicitDiff = Number(hasExplicitFocus(b)) - Number(hasExplicitFocus(a));
    if (explicitDiff !== 0) return explicitDiff;
    const rankDiff = (focusRankNumber(a) ?? 999) - (focusRankNumber(b) ?? 999);
    if (rankDiff !== 0) return rankDiff;
    const manualDiff = Number(isManualUrgent(b)) - Number(isManualUrgent(a));
    if (manualDiff !== 0) return manualDiff;
    const priorityDiff = priorityNumber(a) - priorityNumber(b);
    if (priorityDiff !== 0) return priorityDiff;
    const dueDiff = dueSortValue(a, today) - dueSortValue(b, today);
    if (dueDiff !== 0) return dueDiff;
    return a.title.localeCompare(b.title);
  });
}

export function sortUrgentTasks(tasks: VaultEntry[], today = new Date()): VaultEntry[] {
  return [...tasks].sort((a, b) => {
    const explicitDiff = Number(hasExplicitFocus(b)) - Number(hasExplicitFocus(a));
    if (explicitDiff !== 0) return explicitDiff;
    const rankDiff = (focusRankNumber(a) ?? 999) - (focusRankNumber(b) ?? 999);
    if (rankDiff !== 0) return rankDiff;
    const manualDiff = Number(isManualUrgent(b)) - Number(isManualUrgent(a));
    if (manualDiff !== 0) return manualDiff;
    const priorityDiff = priorityNumber(a) - priorityNumber(b);
    if (priorityDiff !== 0) return priorityDiff;
    const dueDiff = dueSortValue(a, today) - dueSortValue(b, today);
    if (dueDiff !== 0) return dueDiff;
    return a.title.localeCompare(b.title);
  });
}

export function isWaitingTask(entry: VaultEntry): boolean {
  return isOpenTask(entry) && WAITING_STATUSES.has(statusKey(entry));
}

// Date/event files are not "deadline-managed" by deadlineType(), so submission
// and registration deadlines living under dates/ need their own keyword pass.
const DEADLINE_DATE_TOKENS = [
  'deadline',
  'submission',
  'submit',
  'rsvp',
  'registration',
  'register',
  'abstract due',
  'due',
];

// Use the same date fields the chip's dueLabel renders (due/date/start_date),
// NOT the `deadline` frontmatter field — entries whose only date lives in
// `deadline` (e.g. project pages) would otherwise show in the rail as "no date".
function deadlineEntryDue(entry: VaultEntry): string | null | undefined {
  return entry.due || entry.date || entry.start_date;
}

export function isUpcomingDeadlineEntry(entry: VaultEntry): boolean {
  // Hard-deadline tasks/projects (referee, submission, upload, registration, ...).
  if (isHardDeadline(entry)) return true;
  // Submission/registration deadlines captured as dated event files.
  const kind = String(entry.kind || entry.type || '').toLowerCase();
  const path = String(entry.path || '');
  const isDateLike = kind === 'date' || kind === 'event' || kind === 'deadline' || path.startsWith('dates/');
  if (!isDateLike) return false;
  if (!deadlineEntryDue(entry)) return false;
  const text = [entry.id, entry.path, entry.title, entry.project, entry.next].filter(Boolean).join(' ').toLowerCase();
  return DEADLINE_DATE_TOKENS.some((token) => text.includes(token));
}

// Generic words that don't identify which deadline this is, so two entries for
// the same deadline (a submission task and its matching dates/ deadline file)
// reduce to the same topic key.
const DEADLINE_TOPIC_STOPWORDS = new Set([
  'the', 'a', 'an', 'to', 'of', 'for', 'and', 'on', 'in', 'by', 'at',
  'decide', 'decision', 'submit', 'submission', 'submissions', 'deadline',
  'due', 'register', 'registration', 'rsvp', 'review', 'report', 'referee',
  'prepare', 'request', 'requests', 'upload', 'paper', 'final', 'send',
]);

function deadlineTopicTokens(entry: VaultEntry): Set<string> {
  return new Set(
    String(entry.title || '')
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, ' ')
      .split(/\s+/)
      .filter((word) => word.length > 2 && !DEADLINE_TOPIC_STOPWORDS.has(word)),
  );
}

// Same deadline if one entry's topic tokens are wholly contained in the other's
// — handles a submission task ("Submit Harbor Flows to Methods Symposium")
// and its dates/ file ("Methods Symposium submission deadline") whose
// titles overlap but are not identical.
function sharesDeadlineTopic(a: Set<string>, b: Set<string>): boolean {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  if (small.size === 0) return false;
  for (const token of small) {
    if (!large.has(token)) return false;
  }
  return true;
}

// Forward-looking radar of hard/submission deadlines so the home screen can
// highlight them separately from the "what to work on now" focus list.
export function buildUpcomingDeadlines(entries: VaultEntry[], today = new Date(), horizonDays = 30): VaultEntry[] {
  const candidates = uniqueByPath(
    entries.filter((entry) => {
      if (isProject(entry)) return false; // a project page is not a specific deadline
      if (isConferenceSubmissionDeadline(entry)) return false; // shown in the Conference submissions panel
      if (isTask(entry) && !isOpenTask(entry)) return false; // skip done/cancelled tasks
      if (isTask(entry) && (isDeferredTask(entry) || isWaitingTask(entry))) return false;
      if (!isUpcomingDeadlineEntry(entry)) return false;
      const due = daysUntil(deadlineEntryDue(entry), today);
      return due !== null && due >= 0 && due <= horizonDays;
    }),
  ).sort((a, b) => {
    const dueDiff = (daysUntil(deadlineEntryDue(a), today) ?? 9999) - (daysUntil(deadlineEntryDue(b), today) ?? 9999);
    if (dueDiff !== 0) return dueDiff;
    const priorityDiff = priorityNumber(a) - priorityNumber(b);
    if (priorityDiff !== 0) return priorityDiff;
    return a.title.localeCompare(b.title);
  });

  // Collapse the same deadline appearing as both a task and a dates/ file into
  // one row, preferring the actionable task.
  const kept: VaultEntry[] = [];
  const keptMeta: Array<{ due: number | null; tokens: Set<string> }> = [];
  for (const entry of candidates) {
    const due = daysUntil(deadlineEntryDue(entry), today);
    const tokens = deadlineTopicTokens(entry);
    const index = keptMeta.findIndex((meta) => meta.due === due && sharesDeadlineTopic(meta.tokens, tokens));
    if (index === -1) {
      kept.push(entry);
      keptMeta.push({ due, tokens });
    } else if (isTask(entry) && !isTask(kept[index])) {
      kept[index] = entry;
      keptMeta[index] = { due, tokens };
    }
  }
  return kept.slice(0, 6);
}

export function buildOverviewTriage(openTasks: VaultEntry[], projectReview: ProjectReview[], today = new Date()): OverviewTriage {
  const now = sortUrgentTasks(
    openTasks.filter((task) => {
      if (isWaitingTask(task)) return false;
      if (isDeferredTask(task)) return false;
      return priorityNumber(task) === 1 || hardDueWithin(task, 0, today) || softOverdueEnough(task, today);
    }),
    today,
  ).slice(0, 5);

  const used = new Set(now.map(entryKey));
  const waiting = sortUrgentTasks(
    openTasks.filter((task) => !used.has(entryKey(task)) && isWaitingTask(task)),
    today,
  ).slice(0, 4);
  waiting.forEach((task) => used.add(entryKey(task)));

  const next = sortUrgentTasks(
    openTasks.filter((task) => {
      if (used.has(entryKey(task)) || isWaitingTask(task)) return false;
      if (isDeferredTask(task)) return false;
      const due = daysUntil(task.due || task.date, today);
      const priorityTwoDueSoon = priorityNumber(task) <= 2 && due !== null && due > 0 && due <= 7;
      const softDueSoon = priorityNumber(task) <= 2 && isSoftDeadline(task) && due !== null && due > 0 && due <= 7;
      return priorityTwoDueSoon || (isHardDeadline(task) && due !== null && due > 0 && due <= 14) || softDueSoon;
    }),
    today,
  ).slice(0, 4);

  return {
    now,
    next,
    waiting,
    review: projectReview.filter((item) => item.stale || item.openTaskCount > 0 || item.coauthorTaskCount > 0).slice(0, 4),
  };
}

export function buildOverviewTaskGroups(openTasks: VaultEntry[], entries: VaultEntry[] = openTasks, today = new Date()): OverviewTaskGroup[] {
  const researchProjectKeys = new Set(
    entries
      .filter((entry) => isProject(entry) && entryDomain(entry) === 'research')
      .map(projectKey),
  );
  const isResearchTask = (task: VaultEntry) => {
    const taskProjectKey = String(task.project || task.inferred_project || task.explicit_project || '').toLowerCase();
    return entryDomain(task) === 'research' || (taskProjectKey ? researchProjectKeys.has(taskProjectKey) : false);
  };
  const groups: Array<{ key: OverviewTaskGroup['key']; title: string; detail: string; tasks: VaultEntry[] }> = [
    {
      key: 'research',
      title: 'Research tasks',
      detail: 'Papers, data, slides, and writing',
      tasks: openTasks.filter(isResearchTask),
    },
    {
      key: 'other',
      title: 'Other tasks',
      detail: 'Admin, travel, personal, and process work',
      tasks: openTasks.filter((task) => !isResearchTask(task)),
    },
  ];

  return groups.map((group) => {
    const triage = buildOverviewTriage(group.tasks, [], today);
    return {
      key: group.key,
      title: group.title,
      detail: group.detail,
      totalCount: group.tasks.length,
      now: triage.now,
      next: triage.next,
      waiting: triage.waiting,
    };
  });
}

function projectKey(project: VaultEntry): string {
  const parts = project.path.split('/');
  return String(project.id || project.project || parts[Math.max(0, parts.length - 2)] || project.title).toLowerCase();
}

function uniqueProjectRecords(projects: VaultEntry[]): VaultEntry[] {
  const byKey = new Map<string, VaultEntry>();
  for (const project of projects) {
    const key = projectKey(project);
    const current = byKey.get(key);
    if (!current || projectRecordRank(project) < projectRecordRank(current)) {
      byKey.set(key, project);
    }
  }
  return [...byKey.values()];
}

function belongsToProject(entry: VaultEntry, project: VaultEntry): boolean {
  const key = projectKey(project);
  const candidates = [
    entry.project,
    entry.id,
    entry.path.includes(`/projects/${key}/`) ? key : '',
    entry.path.includes(`/areas/${key}/`) ? key : '',
  ].filter(Boolean).map((value) => String(value).toLowerCase());
  return candidates.includes(key);
}

function timestampFromDateField(value?: string | null): number {
  const parsed = parseEntryDate(value);
  return parsed ? parsed.getTime() / 1000 : 0;
}

function latestTimestamp(entries: VaultEntry[]): number {
  return Math.max(
    0,
    ...entries.map((entry) => Math.max(
      entry.modified_at || 0,
      timestampFromDateField(entry.last_touched),
      timestampFromDateField(entry.properties?.last_touched as string | undefined),
    )),
  );
}

function daysSinceTimestamp(timestamp: number, today = new Date()): number {
  return timestamp ? Math.floor((today.getTime() / 1000 - timestamp) / 86_400) : 9999;
}

function isProgressEntry(entry: VaultEntry): boolean {
  return /\/progress\.md$/i.test(entry.path);
}

function isProjectNoteEntry(entry: VaultEntry): boolean {
  const kind = String(entry.kind || entry.type || entry.note_role || '').toLowerCase();
  return kind.includes('note') || /\/notes\//i.test(entry.path);
}

export function isStaleProject(project: VaultEntry, relatedEntries: VaultEntry[], openTaskCount: number, today = new Date()): { stale: boolean; reason: string } {
  const latestRelated = latestTimestamp([project, ...relatedEntries]);
  const daysSinceTouch = daysSinceTimestamp(latestRelated, today);
  const isActive = !DONE_STATUSES.has(String(project.status || '').toLowerCase());
  if (!isActive) return { stale: false, reason: '' };
  if (openTaskCount === 0) return { stale: true, reason: 'no open tasks' };
  const progressEntries = relatedEntries.filter(isProgressEntry);
  const latestProgress = latestTimestamp(progressEntries);
  const daysSinceProgress = daysSinceTimestamp(latestProgress, today);
  if (latestProgress && daysSinceProgress > 21) return { stale: true, reason: `progress.md stale ${daysSinceProgress}d` };
  const noteEntries = relatedEntries.filter(isProjectNoteEntry);
  const latestNote = latestTimestamp(noteEntries);
  const daysSinceNote = daysSinceTimestamp(latestNote, today);
  if (latestNote && daysSinceNote > 21) return { stale: true, reason: `no note activity in ${daysSinceNote}d` };
  if (daysSinceTouch > 21) return { stale: true, reason: `no activity in ${daysSinceTouch}d` };
  return { stale: false, reason: '' };
}

const RECENT_COMPLETION_WINDOW_DAYS = 21;

// Real momentum signal: a task this project closed within the last three weeks.
// Reads the `completed` (or `date`) frontmatter, which is reliable — unlike file
// mtimes, which all share one recent timestamp right after a checkout.
function isRecentlyCompleted(entry: VaultEntry, today: Date): boolean {
  if (!isTask(entry)) return false;
  const status = String(entry.status || '').toLowerCase();
  if (status !== 'done' && status !== 'complete' && status !== 'completed') return false;
  const completed = String(
    (entry as unknown as Record<string, unknown>).completed ||
    entry.properties?.completed ||
    entry.date ||
    '',
  ).trim();
  const days = daysUntil(completed, today);
  return days !== null && days <= 0 && -days <= RECENT_COMPLETION_WINDOW_DAYS;
}

/** Soonest date in play for a project: its own deadline or its nearest open-task due. */
function nextProjectDeadline(project: VaultEntry, openTasks: VaultEntry[], today: Date): ProjectNextDeadline | null {
  const candidates: ProjectNextDeadline[] = [];
  if (project.deadline && parseEntryDate(project.deadline)) {
    candidates.push({
      date: project.deadline,
      type: deadlineTypeLabel(project),
      daysUntil: daysUntil(project.deadline, today),
      source: 'project',
      label: 'project deadline',
    });
  }
  for (const task of openTasks) {
    const due = task.due || task.date;
    if (!due || !parseEntryDate(due)) continue;
    candidates.push({
      date: due,
      type: deadlineTypeLabel(task),
      daysUntil: daysUntil(due, today),
      source: 'task',
      label: String(task.title || task.id || 'task'),
    });
  }
  return candidates.sort((a, b) => a.date.localeCompare(b.date))[0] || null;
}

export function buildProjectReview(entries: VaultEntry[], openTasks: VaultEntry[], today = new Date()): ProjectReview[] {
  const projects = uniqueProjectRecords(entries.filter(isProject));
  return projects.map((project) => {
    const allOpenProjectTasks = openTasks.filter((task) => belongsToProject(task, project));
    const coauthorProjectTasks = allOpenProjectTasks.filter(isCoauthorAssignedTask);
    const openProjectTasks = allOpenProjectTasks.filter((task) => !isCoauthorAssignedTask(task));
    const relatedEntries = entries
      .filter((entry) => entry.path !== project.path && belongsToProject(entry, project))
      .sort((a, b) => (b.modified_at || 0) - (a.modified_at || 0));
    const staleState = isStaleProject(project, relatedEntries, allOpenProjectTasks.length, today);
    const recentCompletionCount = relatedEntries.filter((entry) => isRecentlyCompleted(entry, today)).length;
    const latestActivityTs = latestTimestamp([project, ...relatedEntries]);
    const urgentTaskCount = allOpenProjectTasks.filter((task) => {
      if (isManualUrgent(task)) return true;
      const due = daysUntil(task.due || task.date, today);
      return due !== null && due <= 7;
    }).length;
    return {
      project,
      openTaskCount: openProjectTasks.length,
      openTasks: openProjectTasks.slice(0, 4),
      coauthorTaskCount: coauthorProjectTasks.length,
      coauthorTasks: coauthorProjectTasks.slice(0, 4),
      recentEntries: relatedEntries.slice(0, 4),
      stale: staleState.stale,
      staleReason: staleState.reason,
      recentCompletionCount,
      latestActivityTs,
      urgentTaskCount,
      nextDeadline: nextProjectDeadline(project, allOpenProjectTasks, today),
    };
  }).sort((a, b) => {
    const priorityDiff = priorityNumber(a.project) - priorityNumber(b.project);
    if (priorityDiff !== 0) return priorityDiff;
    return Number(b.stale) - Number(a.stale) || a.project.title.localeCompare(b.project.title);
  });
}

export function buildOverview(entries: VaultEntry[], privateMode: boolean, today = new Date()): OverviewData {
  const visibleEntries = privateMode ? entries.filter((entry) => !entry.private) : entries;
  const focusEntries = privateMode
    ? uniqueByPath([
      ...visibleEntries,
      ...entries.filter((entry) => entry.private && isTask(entry) && isManualUrgent(entry)),
    ])
    : visibleEntries;
  const openTasks = visibleEntries.filter(isOpenTask);
  const focusOpenTasks = focusEntries.filter(isOpenTask);
  const coauthorTasks = sortUrgentTasks(openTasks.filter(isCoauthorAssignedTask), today);
  const ownedOpenTasks = openTasks.filter((task) => !isCoauthorAssignedTask(task));
  const focusOwnedOpenTasks = focusOpenTasks.filter((task) => !isCoauthorAssignedTask(task));
  const mustNotSlip = sortFocusTasks(
    focusOwnedOpenTasks.filter((task) => isOverviewFocusTask(task, today)),
    today,
  ).slice(0, 6);
  const priorityOpenTasks = ownedOpenTasks.filter((task) => !isDeferredTask(task));
  const priorityStack = {
    '1': sortUrgentTasks(priorityOpenTasks.filter((task) => priorityNumber(task) === 1), today).slice(0, 8),
    '2': sortUrgentTasks(priorityOpenTasks.filter((task) => priorityNumber(task) === 2), today).slice(0, 8),
    '3': sortUrgentTasks(priorityOpenTasks.filter((task) => priorityNumber(task) === 3), today).slice(0, 8),
  };
  const projectReviewFull = buildProjectReview(visibleEntries, openTasks, today);
  const projectReview = projectReviewFull.slice(0, 14);
  const projectPulse = buildProjectPulse(projectReviewFull);
  const triage = buildOverviewTriage(ownedOpenTasks, projectReview, today);
  const taskGroups = buildOverviewTaskGroups(ownedOpenTasks, visibleEntries, today);
  const travelCenter = buildTravelCenter(visibleEntries, ownedOpenTasks, today);
  const upcomingTravel = travelCenter.upcomingTravel;
  const activityHeatmap = buildActivityHeatmap(visibleEntries, today);
  const upcomingDeadlines = buildUpcomingDeadlines(visibleEntries, today);
  const submissions = buildSubmissions(visibleEntries, today);
  // Referee reports are intentionally surfaced on Home even in private mode (per
  // user preference), so build from the full entry set, not the filtered one.
  const refereeReports = buildRefereeReports(entries);
  const surfacedPaths = new Set<string>([
    ...upcomingDeadlines.map((entry) => entry.path),
    ...triage.now.map((entry) => entry.path),
    ...triage.next.map((entry) => entry.path),
    ...triage.waiting.map((entry) => entry.path),
    ...triage.review.map((item) => item.project.path),
    ...coauthorTasks.slice(0, 8).map((entry) => entry.path),
    ...taskGroups.flatMap((group) => [...group.now, ...group.next, ...group.waiting]).map((entry) => entry.path),
    ...upcomingTravel.flatMap((item) => [item.anchor, ...item.missing, ...item.briefs]).map((entry) => entry.path),
  ]);
  const upcomingDates = visibleEntries
    .filter((entry) => {
      if (surfacedPaths.has(entry.path)) return false;
      if (isTask(entry) && !isOpenTask(entry)) return false;
      if (isTask(entry) && isDeferredTask(entry)) return false;
      const due = daysUntil(entry.due || entry.date || entry.start_date, today);
      return due !== null && due >= 0;
    })
    .sort((a, b) => dueSortValue(a, today) - dueSortValue(b, today) || priorityNumber(a) - priorityNumber(b))
    .slice(0, 18);
  upcomingDates.forEach((entry) => surfacedPaths.add(entry.path));
  const recentActivity = [...visibleEntries]
    .filter((entry) => !surfacedPaths.has(entry.path))
    .sort((a, b) => (b.modified_at || 0) - (a.modified_at || 0))
    .slice(0, 18);
  return {
    visibleEntries,
    openTasks,
    coauthorTasks,
    mustNotSlip,
    priorityStack,
    projectReview,
    projectPulse,
    triage,
    taskGroups,
    upcomingTravel,
    travelSummary: travelCenter.summary,
    upcomingDeadlines,
    upcomingDates,
    recentActivity,
    activityHeatmap,
    submissions,
    refereeReports,
  };
}
