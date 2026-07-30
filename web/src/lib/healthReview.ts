import { entryLens, isTask } from './filters';
import { daysUntil, isOpenTask, sortUrgentTasks } from './overview';
import type { VaultEntry } from '../types';

export type HealthCategory = 'admin' | 'fitness' | 'baseline' | 'waiting';

export interface HealthSummaryMetric {
  id: string;
  label: string;
  value: number;
  detail: string;
}

export interface HealthTaskGroup {
  id: HealthCategory;
  label: string;
  description: string;
  entries: VaultEntry[];
}

export interface HealthRoutineCard {
  id: 'weekly' | 'baseline' | 'travel' | 'fitness';
  label: string;
  description: string;
  entries: VaultEntry[];
  primary?: VaultEntry;
}

export type HealthFitnessSessionKind = 'cardio' | 'yoga' | 'strength' | 'recovery' | 'rest';

export interface HealthFitnessCalendarItem {
  id: string;
  week: 1 | 2;
  date: string;
  dayLabel: string;
  label: string;
  shortLabel: string;
  detail: string;
  duration: string;
  kind: HealthFitnessSessionKind;
  optional?: boolean;
  sourcePath: string;
  private: boolean;
}

export interface HealthFitnessCalendarWeek {
  week: 1 | 2;
  label: string;
  startDate: string;
  endDate: string;
  items: HealthFitnessCalendarItem[];
}

export interface HealthStravaBucket {
  activities: number;
  distanceKm: number;
  movingHours: number;
  elevationGainM: number;
  calories: number;
  relativeEffort: number;
}

export interface HealthStravaTypeSummary extends HealthStravaBucket {
  type: string;
}

export interface HealthStravaMonthSummary extends HealthStravaBucket {
  month: string;
}

export interface HealthStravaWeekSummary extends HealthStravaBucket {
  weekStart: string;
}

export interface HealthStravaSummary {
  sourcePath: string;
  sourcePrivatePath: string;
  importDate: string;
  periodStart: string;
  periodEnd: string;
  totals: HealthStravaBucket;
  recent90d: HealthStravaBucket;
  activityTypes: HealthStravaTypeSummary[];
  recentMonths: HealthStravaMonthSummary[];
  recentWeeks: HealthStravaWeekSummary[];
  private: boolean;
}

export interface HealthLogObservation {
  date: string;
  sourcePath: string;
  sleepHours: number | null;
  energy: number | null;
  symptomCount: number | null;
  symptomSeverity: number | null;
  private: boolean;
}

export interface HealthLogTrendSummary {
  observations: HealthLogObservation[];
  sleepCount: number;
  energyCount: number;
  symptomCount: number;
  averageSleepHours: number | null;
  averageEnergy: number | null;
  latest: HealthLogObservation | null;
}

export interface HealthReviewData {
  healthEntries: VaultEntry[];
  openTasks: VaultEntry[];
  dueSoonTasks: VaultEntry[];
  waitingTasks: VaultEntry[];
  routineNotes: VaultEntry[];
  recentMemory: VaultEntry[];
  taskGroups: HealthTaskGroup[];
  routineCards: HealthRoutineCard[];
  fitnessCalendar: HealthFitnessCalendarWeek[];
  stravaSummary: HealthStravaSummary | null;
  healthLogTrends: HealthLogTrendSummary;
  metrics: HealthSummaryMetric[];
  privateEntryCount: number;
}

const WAITING_STATUSES = new Set(['waiting', 'blocked', 'pending', 'follow']);

function scalar(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.map(scalar).filter(Boolean).join(' ');
  return String(value).trim();
}

function haystack(entry: VaultEntry): string {
  return [
    entry.path,
    entry.project,
    entry.id,
    entry.area,
    entry.title,
    entry.kind,
    entry.type,
    entry.note_role,
    entry.collection,
  ].map(scalar).join(' ').toLowerCase();
}

function categoryHaystack(entry: VaultEntry): string {
  return [
    entry.path,
    entry.id,
    entry.title,
    entry.kind,
    entry.type,
    entry.note_role,
    entry.collection,
    entry.next,
    entry.snippet,
  ].map(scalar).join(' ').toLowerCase();
}

function statusKey(entry: VaultEntry): string {
  return String(entry.status || '').toLowerCase();
}

function dateValue(entry: VaultEntry): number {
  const raw = entry.due || entry.date || entry.start_date || entry.last_touched;
  const parsed = raw ? Date.parse(String(raw)) : NaN;
  if (Number.isFinite(parsed)) return parsed;
  return (entry.modified_at || 0) * 1000;
}

function byRecentDate(a: VaultEntry, b: VaultEntry): number {
  return dateValue(b) - dateValue(a) || a.title.localeCompare(b.title);
}

function parseIsoDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return null;
  const [, year, month, day] = match;
  return new Date(Number(year), Number(month) - 1, Number(day));
}

function isoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(date: Date, amount: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + amount);
}

function dayMonthLabel(date: Date): string {
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
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

export function isHealthReviewEntry(entry: VaultEntry): boolean {
  const area = String(entry.area || entry.domain || '').toLowerCase();
  const kind = String(entry.kind || entry.type || entry.note_role || '').toLowerCase();
  const module = String(entry.properties?.module || '').toLowerCase();
  return ['health', 'wellness'].includes(area)
    || ['health', 'wellness'].includes(module)
    || kind.includes('health')
    || kind.includes('wellness');
}

export function healthCategory(entry: VaultEntry): HealthCategory {
  const text = categoryHaystack(entry);
  const explicit = String(entry.properties?.health_category || entry.properties?.wellness_category || '').toLowerCase();
  if (['admin', 'fitness', 'baseline', 'waiting'].includes(explicit)) return explicit as HealthCategory;
  if (WAITING_STATUSES.has(statusKey(entry))) return 'waiting';
  if (text.includes('appointment') || text.includes('admin')) return 'admin';
  if (text.includes('exercise') || text.includes('fitness') || text.includes('workout') || text.includes('mobility') || text.includes('strength') || text.includes('walk')) return 'fitness';
  if (text.includes('baseline') || text.includes('weekly') || text.includes('daily-health') || text.includes('nutrition') || text.includes('diet')) return 'baseline';
  return isTask(entry) ? 'admin' : 'baseline';
}

export function healthCategoryLabel(category: HealthCategory): string {
  if (category === 'admin') return 'Admin / appointments';
  if (category === 'fitness') return 'Fitness / routines';
  if (category === 'baseline') return 'Baseline / weekly review';
  return 'Waiting';
}

export function healthEntryDate(entry: VaultEntry): string {
  return String(entry.due || entry.date || entry.start_date || entry.last_touched || '');
}

export function isHealthDueSoon(entry: VaultEntry, today = new Date()): boolean {
  const days = daysUntil(entry.due || entry.date || entry.start_date, today);
  return days !== null && days <= 14;
}

export function healthRoutineLabel(entry: VaultEntry): string {
  const path = entry.path.toLowerCase();
  const text = categoryHaystack(entry);
  if (path.includes('strava') || text.includes('strava')) return 'Strava';
  if (path.includes('baseline-log') || text.includes('baseline')) return 'Baseline';
  if (path.includes('travel-exercise') || text.includes('travel exercise')) return 'Travel';
  if (path.includes('weekly') || text.includes('weekly review')) return 'Weekly';
  if (text.includes('appointment')) return 'Appointment';
  if (text.includes('exercise') || text.includes('fitness')) return 'Fitness';
  return entryLens(entry);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function numberValue(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function optionalNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  if (!raw || ['-', 'n/a', 'na', 'none', 'null'].includes(raw.toLowerCase())) return null;
  const match = raw.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function firstNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const parsed = optionalNumber(value);
    if (parsed !== null) return parsed;
  }
  return null;
}

function firstField(entry: VaultEntry, names: string[]): unknown {
  const entryRecord = entry as unknown as Record<string, unknown>;
  const properties = asRecord(entry.properties);
  for (const name of names) {
    if (entryRecord[name] !== undefined) return entryRecord[name];
    if (properties[name] !== undefined) return properties[name];
  }
  return undefined;
}

function snippetNumber(entry: VaultEntry, pattern: RegExp): number | null {
  const match = String(entry.snippet || '').match(pattern);
  return match ? optionalNumber(match[1]) : null;
}

function parseHealthLogObservation(entry: VaultEntry): HealthLogObservation | null {
  const kind = scalar(entry.kind || entry.type || entry.note_role).toLowerCase();
  const path = entry.path.toLowerCase();
  const isLog = kind === 'daily-health-log' || kind === 'weekly-health-review' || path.includes('baseline-log') || path.includes('/daily/') || path.includes('/weekly/');
  if (!isLog) return null;

  const date = scalar(entry.date || firstField(entry, ['date', 'week']) || entry.start_date || entry.last_touched);
  if (!date) return null;

  const sleepHours = firstNumber(
    firstField(entry, ['sleep_hours', 'sleepHours', 'sleep']),
    snippetNumber(entry, /\bHours:\s*([0-9.]+)/i),
  );
  const energy = firstNumber(
    firstField(entry, ['energy', 'energy_score', 'energyScore']),
    snippetNumber(entry, /\bEnergy(?:\s+1[-–]5)?:\s*([0-9.]+)/i),
  );
  const symptomCount = firstNumber(
    firstField(entry, ['symptom_count', 'symptoms_count', 'symptoms']),
  );
  const symptomSeverity = firstNumber(
    firstField(entry, ['symptom_severity', 'symptomSeverity', 'severity']),
  );

  if (sleepHours === null && energy === null && symptomCount === null && symptomSeverity === null) return null;

  return {
    date,
    sourcePath: entry.path,
    sleepHours,
    energy,
    symptomCount,
    symptomSeverity,
    private: Boolean(entry.private),
  };
}

function average(values: Array<number | null>): number | null {
  const numeric = values.filter((value): value is number => value !== null);
  if (!numeric.length) return null;
  return Math.round((numeric.reduce((total, value) => total + value, 0) / numeric.length) * 10) / 10;
}

function buildHealthLogTrends(healthEntries: VaultEntry[]): HealthLogTrendSummary {
  const observations = healthEntries
    .map(parseHealthLogObservation)
    .filter((item): item is HealthLogObservation => Boolean(item))
    .sort((a, b) => a.date.localeCompare(b.date));
  return {
    observations,
    sleepCount: observations.filter((item) => item.sleepHours !== null).length,
    energyCount: observations.filter((item) => item.energy !== null).length,
    symptomCount: observations.filter((item) => item.symptomCount !== null || item.symptomSeverity !== null).length,
    averageSleepHours: average(observations.map((item) => item.sleepHours)),
    averageEnergy: average(observations.map((item) => item.energy)),
    latest: observations.at(-1) || null,
  };
}

function stravaBucket(value: unknown): HealthStravaBucket {
  const record = asRecord(value);
  return {
    activities: Math.round(numberValue(record.activities)),
    distanceKm: numberValue(record.distance_km),
    movingHours: numberValue(record.moving_hours),
    elevationGainM: numberValue(record.elevation_gain_m),
    calories: numberValue(record.calories),
    relativeEffort: numberValue(record.relative_effort),
  };
}

function parseStravaSummary(entry: VaultEntry): HealthStravaSummary | null {
  const raw = scalar(entry.properties?.strava_summary_json);
  if (!raw) return null;
  try {
    const parsed = asRecord(JSON.parse(raw));
    return {
      sourcePath: entry.path,
      sourcePrivatePath: scalar(parsed.source_private_path || entry.properties?.source_private_path),
      importDate: scalar(parsed.import_date || entry.date),
      periodStart: scalar(parsed.period_start),
      periodEnd: scalar(parsed.period_end),
      totals: stravaBucket(parsed.totals),
      recent90d: stravaBucket(parsed.recent_90d),
      activityTypes: asArray(parsed.activity_types).map((item) => ({
        type: scalar(asRecord(item).type || 'Other'),
        ...stravaBucket(item),
      })),
      recentMonths: asArray(parsed.recent_months).map((item) => ({
        month: scalar(asRecord(item).month),
        ...stravaBucket(item),
      })),
      recentWeeks: asArray(parsed.recent_weeks).map((item) => ({
        weekStart: scalar(asRecord(item).week_start),
        ...stravaBucket(item),
      })),
      private: Boolean(entry.private),
    };
  } catch {
    return null;
  }
}

function buildStravaSummary(healthEntries: VaultEntry[]): HealthStravaSummary | null {
  const candidates = healthEntries
    .filter((entry) => entry.kind === 'strava-summary' || Boolean(entry.properties?.strava_summary_json))
    .sort(byRecentDate);
  for (const candidate of candidates) {
    const summary = parseStravaSummary(candidate);
    if (summary) return summary;
  }
  return null;
}

function routineCard(
  id: HealthRoutineCard['id'],
  label: string,
  description: string,
  entries: VaultEntry[],
  matcher: (entry: VaultEntry) => boolean,
): HealthRoutineCard {
  const matches = uniqueEntries(entries.filter(matcher)).sort(byRecentDate);
  return {
    id,
    label,
    description,
    entries: matches,
    primary: matches[0],
  };
}

function matchesRoutine(
  entry: VaultEntry,
  id: HealthRoutineCard['id'],
  fallback: (entry: VaultEntry) => boolean,
): boolean {
  const routine = normalizedRoutine(entry.properties?.wellness_routine || entry.properties?.health_routine);
  if (routine) return routine === id;
  const category = normalizedRoutine(entry.properties?.wellness_category || entry.properties?.health_category);
  if (id === 'baseline' && category) return category === 'baseline';
  if (id === 'fitness' && category) return category === 'fitness';
  return fallback(entry);
}

function normalizedRoutine(value: unknown): string {
  return scalar(value).toLowerCase();
}

function buildFitnessCalendar(healthEntries: VaultEntry[]): HealthFitnessCalendarWeek[] {
  const source = healthEntries.find((entry) => Array.isArray(entry.properties?.fitness_plan));
  if (!source) return [];
  const rows = source.properties?.fitness_plan as Array<Record<string, unknown>>;
  const start = parseIsoDate(String(source.start_date || source.date || source.due || ''));
  const items = rows.map<HealthFitnessCalendarItem | null>((row, index) => {
    const rowDate = parseIsoDate(scalar(row.date));
    const date = rowDate || (start ? addDays(start, Number(row.offset ?? index)) : null);
    if (!date) return null;
    const kindValue = scalar(row.kind).toLowerCase();
    const kind = ['cardio', 'yoga', 'strength', 'recovery', 'rest'].includes(kindValue)
      ? kindValue as HealthFitnessSessionKind
      : 'recovery';
    const week: 1 | 2 = Number(row.week) === 2 ? 2 : 1;
    const label = scalar(row.label) || `Session ${index + 1}`;
    return {
      id: scalar(row.id) || `fitness-plan-${week}-${index}`,
      week,
      date: isoDate(date),
      dayLabel: dayMonthLabel(date),
      label,
      shortLabel: scalar(row.short_label) || label,
      detail: scalar(row.detail),
      duration: scalar(row.duration),
      kind,
      optional: Boolean(row.optional),
      sourcePath: source.path,
      private: Boolean(source.private),
    };
  }).filter((item): item is HealthFitnessCalendarItem => item !== null);

  return ([1, 2] as const).map((week) => {
    const weekItems = items.filter((item) => item.week === week);
    return {
      week,
      label: week === 1 ? 'Week 1: restart rhythm' : 'Week 2: add rhythm, not intensity',
      startDate: weekItems[0]?.date || '',
      endDate: weekItems[weekItems.length - 1]?.date || '',
      items: weekItems,
    };
  });
}

export function buildHealthReview(entries: VaultEntry[], today = new Date()): HealthReviewData {
  const healthEntries = uniqueEntries(entries.filter(isHealthReviewEntry));
  const openTasks = sortUrgentTasks(healthEntries.filter(isOpenTask), today);
  const dueSoonTasks = openTasks.filter((entry) => isHealthDueSoon(entry, today));
  const waitingTasks = openTasks.filter((entry) => WAITING_STATUSES.has(statusKey(entry)));
  const routineNotes = healthEntries
    .filter((entry) => !isTask(entry) && (
      entry.path.includes('/notes/')
      || entry.path.startsWith('areas/wellness/')
      || entry.path.startsWith('areas/health/')
      || entry.path.startsWith('templates/health/')
    ))
    .sort((a, b) => healthRoutineLabel(a).localeCompare(healthRoutineLabel(b)) || byRecentDate(a, b));
  const recentMemory = healthEntries
    .filter((entry) => !isTask(entry))
    .sort(byRecentDate)
    .slice(0, 6);

  const taskGroups: HealthTaskGroup[] = [
    {
      id: 'admin',
      label: healthCategoryLabel('admin'),
      description: 'Provider portals, appointments, and low-detail admin follow-ups.',
      entries: openTasks.filter((entry) => healthCategory(entry) === 'admin'),
    },
    {
      id: 'fitness',
      label: healthCategoryLabel('fitness'),
      description: 'Travel-safe movement and routine consistency.',
      entries: openTasks.filter((entry) => healthCategory(entry) === 'fitness'),
    },
    {
      id: 'baseline',
      label: healthCategoryLabel('baseline'),
      description: 'Baseline log and weekly review work.',
      entries: openTasks.filter((entry) => healthCategory(entry) === 'baseline'),
    },
    {
      id: 'waiting',
      label: healthCategoryLabel('waiting'),
      description: 'External confirmations or next check-ins.',
      entries: waitingTasks,
    },
  ];

  const routineCards: HealthRoutineCard[] = [
    routineCard('weekly', 'Weekly review', 'Run a short status-only review and choose next actions.', routineNotes, (entry) => matchesRoutine(entry, 'weekly', (candidate) => categoryHaystack(candidate).includes('weekly'))),
    routineCard('baseline', 'Baseline log', 'Track practical baseline status without medical detail.', routineNotes, (entry) => matchesRoutine(entry, 'baseline', (candidate) => categoryHaystack(candidate).includes('baseline') || categoryHaystack(candidate).includes('daily-health'))),
    routineCard('travel', 'Travel exercise', 'Keep the travel-friendly movement plan easy to find.', routineNotes, (entry) => matchesRoutine(entry, 'travel', (candidate) => categoryHaystack(candidate).includes('travel exercise'))),
    routineCard('fitness', 'Fitness plan', 'Walking, strength, mobility, and routine principles.', routineNotes, (entry) => matchesRoutine(entry, 'fitness', (candidate) => categoryHaystack(candidate).includes('fitness') || categoryHaystack(candidate).includes('exercise') || categoryHaystack(candidate).includes('workout'))),
  ];
  const fitnessCalendar = buildFitnessCalendar(healthEntries);
  const fitnessSessionCount = fitnessCalendar.reduce((total, week) => total + week.items.length, 0);
  const stravaSummary = buildStravaSummary(healthEntries);
  const healthLogTrends = buildHealthLogTrends(healthEntries);

  return {
    healthEntries,
    openTasks,
    dueSoonTasks,
    waitingTasks,
    routineNotes,
    recentMemory,
    taskGroups,
    routineCards,
    fitnessCalendar,
    stravaSummary,
    healthLogTrends,
    privateEntryCount: healthEntries.filter((entry) => entry.private).length,
    metrics: [
      { id: 'admin', label: 'Admin items', value: taskGroups[0].entries.length, detail: 'appointments and portals' },
      { id: 'routine', label: 'Routine notes', value: routineNotes.length, detail: 'baseline, weekly, fitness' },
      { id: 'fitness-plan', label: 'Plan days', value: fitnessSessionCount, detail: 'two-week calendar' },
      { id: 'health-logs', label: 'Log points', value: healthLogTrends.observations.length, detail: 'sleep/energy/symptom' },
      { id: 'strava', label: 'Strava activities', value: stravaSummary?.totals.activities || 0, detail: stravaSummary ? `${stravaSummary.periodStart} to ${stravaSummary.periodEnd}` : 'no import' },
      { id: 'due-soon', label: 'Due soon', value: dueSoonTasks.length, detail: 'within 14 days' },
      { id: 'waiting', label: 'Waiting', value: waitingTasks.length, detail: 'blocked or pending' },
    ],
  };
}
