import { describe, expect, it } from 'vitest';
import { buildHealthReview, healthCategory, isHealthReviewEntry } from './healthReview';
import type { VaultEntry } from '../types';

const today = new Date(2026, 4, 15);

const fitnessPlan = Array.from({ length: 14 }, (_, index) => ({
  id: `session-${index + 1}`,
  week: index < 7 ? 1 : 2,
  offset: index,
  label: index === 0 ? 'Logged easy run' : index % 4 === 0 ? 'Rest day' : 'Easy movement',
  duration: index === 0 ? '27m' : '20m',
  kind: index % 4 === 0 ? 'rest' : 'cardio',
}));

const stravaSummary = {
  import_date: '2026-05-15',
  source_private_path: 'areas/wellness/imports/strava/2026-05-15-export',
  period_start: '2018-08-01',
  period_end: '2026-04-23',
  totals: { activities: 617, distance_km: 3112, moving_hours: 369.2, elevation_gain_m: 29391, calories: 239612, relative_effort: 15113 },
  recent_90d: { activities: 17, distance_km: 72.8, moving_hours: 7.3, elevation_gain_m: 1076, calories: 3935, relative_effort: 267 },
  activity_types: [
    { type: 'Run', activities: 471, distance_km: 2161.4, moving_hours: 241.3, elevation_gain_m: 21273, calories: 180850, relative_effort: 12923 },
    { type: 'Rowing', activities: 55, distance_km: 401.5, moving_hours: 55.6, elevation_gain_m: 28, calories: 30629, relative_effort: 1316 },
  ],
  recent_months: [
    { month: '2026-03', activities: 2, distance_km: 17.2, moving_hours: 2.4, elevation_gain_m: 491, calories: 986, relative_effort: 37 },
    { month: '2026-04', activities: 5, distance_km: 28.5, moving_hours: 1.9, elevation_gain_m: 350, calories: 651, relative_effort: 30 },
  ],
  recent_weeks: [
    { week_start: '2026-04-06', activities: 3, distance_km: 25.9, moving_hours: 1.6, elevation_gain_m: 332, calories: 450, relative_effort: 21 },
    { week_start: '2026-04-20', activities: 2, distance_km: 2.6, moving_hours: 0.3, elevation_gain_m: 18, calories: 201, relative_effort: 9 },
  ],
};

const entries: VaultEntry[] = [
  {
    path: 'tasks/active/t-health-one-medical-followup.md',
    filename: 't-health-one-medical-followup.md',
    title: 'Reset health admin and baseline log',
    kind: 'task',
    project: 'wellness',
    area: 'wellness',
    properties: { module: 'wellness', wellness_category: 'admin' },
    status: 'open',
    priority: '2',
    due: '2026-05-26',
    private: true,
  },
  {
    path: 'tasks/waiting/t-health-provider-reply.md',
    filename: 't-health-provider-reply.md',
    title: 'Wait for provider reply',
    kind: 'task',
    project: 'wellness',
    area: 'wellness',
    properties: { module: 'wellness', wellness_category: 'waiting' },
    status: 'waiting',
    priority: '3',
    private: true,
  },
  {
    path: 'areas/wellness/fitness/exercise_plan.md',
    filename: 'exercise_plan.md',
    title: 'Exercise plan',
    kind: 'health-note',
    area: 'wellness',
    properties: { module: 'wellness', wellness_category: 'fitness' },
    private: true,
  },
  {
    path: 'projects/wellness/notes/2026-05-baseline-log.md',
    filename: '2026-05-baseline-log.md',
    title: 'Baseline health log',
    kind: 'health-note',
    project: 'wellness',
    area: 'wellness',
    properties: { module: 'wellness', wellness_category: 'baseline' },
    private: true,
    date: '2026-05-15',
  },
  {
    path: 'docs/project_health_score.md',
    filename: 'project_health_score.md',
    title: 'Project health score',
    kind: 'documentation',
    private: false,
  },
  {
    path: 'projects/wellness/notes/2026-05-15-strava-activity-summary.md',
    filename: '2026-05-15-strava-activity-summary.md',
    title: 'Strava activity summary through 2026-04-23',
    kind: 'strava-summary',
    project: 'wellness',
    private: true,
    date: '2026-05-15',
    properties: {
      module: 'wellness',
      wellness_routine: 'activity-history',
      strava_summary_json: JSON.stringify(stravaSummary),
      source_private_path: 'areas/wellness/imports/strava/2026-05-15-export',
    },
  },
];

describe('healthReview', () => {
  it('finds health project and area files without broad doc matches', () => {
    expect(isHealthReviewEntry(entries[0])).toBe(true);
    expect(isHealthReviewEntry(entries[2])).toBe(true);
    expect(isHealthReviewEntry(entries[4])).toBe(false);
  });

  it('classifies health entries into admin, fitness, baseline, and waiting buckets', () => {
    expect(healthCategory(entries[0])).toBe('admin');
    expect(healthCategory(entries[1])).toBe('waiting');
    expect(healthCategory(entries[2])).toBe('fitness');
    expect(healthCategory(entries[3])).toBe('baseline');
  });

  it('builds counts and routine cards from private entries', () => {
    const data = buildHealthReview(entries, today);
    expect(data.openTasks).toHaveLength(2);
    expect(data.waitingTasks).toHaveLength(1);
    expect(data.privateEntryCount).toBe(5);
    expect(data.taskGroups.find((group) => group.id === 'admin')?.entries).toHaveLength(1);
    expect(data.taskGroups.find((group) => group.id === 'waiting')?.entries).toHaveLength(1);
    expect(data.routineCards.find((card) => card.id === 'baseline')?.primary?.title).toBe('Baseline health log');
    expect(data.routineCards.find((card) => card.id === 'fitness')?.primary?.title).toBe('Exercise plan');
  });

  it('parses Strava aggregate summaries for Health Review visuals', () => {
    const data = buildHealthReview(entries, today);

    expect(data.stravaSummary?.totals.activities).toBe(617);
    expect(data.stravaSummary?.recent90d.movingHours).toBe(7.3);
    expect(data.stravaSummary?.activityTypes[0]).toMatchObject({ type: 'Run', movingHours: 241.3 });
    expect(data.stravaSummary?.recentMonths.at(-1)?.month).toBe('2026-04');
    expect(data.metrics.find((metric) => metric.id === 'strava')?.value).toBe(617);
  });

  it('ingests filled health-log observations and ignores blank templates', () => {
    const data = buildHealthReview([
      ...entries,
      {
        path: 'areas/wellness/daily/2026-05-11.md',
        filename: '2026-05-11.md',
        title: 'Health log 2026-05-11',
        kind: 'daily-health-log',
        date: '2026-05-11',
        private: true,
        area: 'wellness',
        properties: {
          module: 'wellness',
          sleep_hours: 7.2,
          energy: 4,
          symptom_count: 0,
        },
      },
      {
        path: 'areas/wellness/daily/2026-05-12.md',
        filename: '2026-05-12.md',
        title: 'Blank health log',
        kind: 'daily-health-log',
        date: '2026-05-12',
        private: true,
        area: 'wellness',
        properties: {
          module: 'wellness',
          sleep_hours: '',
          energy: '',
          symptom_count: '',
        },
      },
      {
        path: 'areas/wellness/daily/2026-05-13.md',
        filename: '2026-05-13.md',
        title: 'Health log 2026-05-13',
        kind: 'daily-health-log',
        date: '2026-05-13',
        private: true,
        area: 'wellness',
        properties: {
          module: 'wellness',
          sleep_hours: 6.8,
          energy: 3,
          symptom_count: 1,
          symptom_severity: 2,
        },
      },
    ], today);

    expect(data.healthLogTrends.observations).toHaveLength(2);
    expect(data.healthLogTrends.sleepCount).toBe(2);
    expect(data.healthLogTrends.energyCount).toBe(2);
    expect(data.healthLogTrends.symptomCount).toBe(2);
    expect(data.healthLogTrends.averageSleepHours).toBe(7);
    expect(data.healthLogTrends.averageEnergy).toBe(3.5);
    expect(data.healthLogTrends.latest?.sourcePath).toBe('areas/wellness/daily/2026-05-13.md');
    expect(data.metrics.find((metric) => metric.id === 'health-logs')?.value).toBe(2);
  });

  it('derives the two-week fitness calendar from the email-backed plan task', () => {
    const data = buildHealthReview([
      ...entries,
      {
        path: 'tasks/active/t-health-fitness-two-week-plan.md',
        filename: 't-health-fitness-two-week-plan.md',
        id: 't-health-fitness-two-week-plan',
        title: 'Start two-week fitness re-entry plan',
        kind: 'task',
        project: 'wellness',
        area: 'wellness',
        status: 'active',
        start_date: '2026-05-15',
        due: '2026-05-29',
        private: true,
        properties: { module: 'wellness' },
      },
      {
        path: 'projects/wellness/notes/2026-05-15-fitness-update.md',
        filename: '2026-05-15-fitness-update.md',
        title: 'Fitness update and two-week re-entry plan',
        kind: 'health-note',
        project: 'wellness',
        area: 'wellness',
        start_date: '2026-05-15',
        date: '2026-05-15',
        properties: { module: 'wellness', fitness_plan: fitnessPlan },
        private: true,
      },
    ], today);

    expect(data.fitnessCalendar).toHaveLength(2);
    expect(data.fitnessCalendar[0].items).toHaveLength(7);
    expect(data.fitnessCalendar[0].items[0]).toMatchObject({
      date: '2026-05-15',
      label: 'Logged easy run',
      duration: '27m',
      sourcePath: 'projects/wellness/notes/2026-05-15-fitness-update.md',
      private: true,
    });
    expect(data.fitnessCalendar[1].items.at(-1)?.date).toBe('2026-05-28');
    expect(data.metrics.find((metric) => metric.id === 'fitness-plan')?.value).toBe(14);
  });
});
