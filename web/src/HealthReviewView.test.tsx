import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HealthReviewView } from './App';
import { buildWorkbenchData } from './lib/workbench';
import type { EntryFilters, VaultEntry } from './types';

const today = new Date(2026, 4, 15);

const fitnessPlan = Array.from({ length: 14 }, (_, index) => ({
  id: `session-${index + 1}`,
  week: index < 7 ? 1 : 2,
  offset: index,
  label: index === 0 ? 'Logged easy run' : index % 4 === 0 ? 'Rest day' : 'Easy movement',
  duration: index === 0 ? '27m' : '20m',
  kind: index % 4 === 0 ? 'rest' : 'cardio',
}));

const baseFilters: EntryFilters = {
  lens: 'all',
  query: '',
  domain: '',
  privateMode: false,
  collection: '',
  entryProject: '',
  noteRole: '',
  taskStatus: '',
  taskPriority: '',
  taskProject: '',
};

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
    status: 'open',
    priority: '2',
    due: '2026-05-26',
    private: true,
    modified_at: 10,
    properties: { module: 'wellness', wellness_category: 'admin' },
  },
  {
    path: 'projects/wellness/notes/2026-05-baseline-log.md',
    filename: '2026-05-baseline-log.md',
    title: 'Baseline log',
    kind: 'project-note',
    project: 'wellness',
    area: 'wellness',
    private: true,
    date: '2026-05-15',
    properties: { module: 'wellness', wellness_category: 'baseline' },
  },
  {
    path: 'projects/wellness/notes/2026-05-travel-exercise-plan.md',
    filename: '2026-05-travel-exercise-plan.md',
    title: 'Travel exercise plan',
    kind: 'project-note',
    project: 'wellness',
    area: 'wellness',
    private: true,
    date: '2026-05-09',
    properties: { module: 'wellness' },
  },
  {
    path: 'areas/wellness/fitness/exercise_plan.md',
    filename: 'exercise_plan.md',
    title: 'Minimal exercise plan',
    kind: 'health-note',
    area: 'wellness',
    private: true,
    properties: { module: 'wellness', wellness_category: 'fitness' },
  },
  {
    path: 'tasks/active/t-health-fitness-two-week-plan.md',
    filename: 't-health-fitness-two-week-plan.md',
    id: 't-health-fitness-two-week-plan',
    title: 'Start two-week fitness re-entry plan',
    kind: 'task',
    project: 'wellness',
    area: 'wellness',
    status: 'active',
    priority: '3',
    start_date: '2026-05-15',
    due: '2026-05-29',
    private: true,
    modified_at: 12,
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
  {
    path: 'projects/wellness/notes/2026-05-15-strava-activity-summary.md',
    filename: '2026-05-15-strava-activity-summary.md',
    title: 'Strava activity summary through 2026-04-23',
    kind: 'strava-summary',
    project: 'wellness',
    area: 'wellness',
    date: '2026-05-15',
    private: true,
    properties: {
      module: 'wellness',
      wellness_routine: 'activity-history',
      strava_summary_json: JSON.stringify(stravaSummary),
      source_private_path: 'areas/wellness/imports/strava/2026-05-15-export',
    },
  },
  {
    path: 'areas/wellness/daily/2026-05-15.md',
    filename: '2026-05-15.md',
    title: 'Health log 2026-05-15',
    kind: 'daily-health-log',
    area: 'wellness',
    date: '2026-05-15',
    private: true,
    properties: {
      module: 'wellness',
      sleep_hours: 7.5,
      energy: 4,
      symptom_count: 0,
    },
  },
];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(today);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('HealthReviewView', () => {
  it('shows private-aware health tasks and routine notes', () => {
    const onOpen = vi.fn();
    const onPatch = vi.fn();

    render(
      <HealthReviewView
        data={buildWorkbenchData(entries, baseFilters, today)}
        entries={entries}
        privateMode={false}
        onOpen={onOpen}
        onPatchTaskMetadata={onPatch}
        patchingTaskPath=""
      />,
    );

    expect(screen.getByText('Wellness')).toBeVisible();
    expect(screen.getByText('Reset health admin and baseline log')).toBeVisible();
    expect(screen.getAllByText('Baseline log')[0]).toBeVisible();
    expect(screen.getAllByText('Travel exercise plan')[0]).toBeVisible();
    expect(screen.getByText('Minimal exercise plan')).toBeVisible();
    expect(screen.getByText('Fitness plan calendar')).toBeVisible();
    expect(screen.getByText('Fitness plan overview')).toBeVisible();
    expect(screen.getByText('Today')).toBeVisible();
    expect(screen.getAllByText('Week 1')[0]).toBeVisible();
    expect(screen.getByTitle('Fri, May 15: Logged easy run')).toBeVisible();
    expect(screen.getByText('Fri, May 15')).toBeVisible();
    expect(screen.getByText('Strava activity history')).toBeVisible();
    expect(screen.getAllByText('617')[0]).toBeVisible();
    expect(screen.getAllByText('Run')[0]).toBeVisible();
    expect(screen.getByText('90d weekly pace')).toBeVisible();
    expect(screen.getByText('Main mode')).toBeVisible();
    expect(screen.getByText('Monthly volume')).toBeVisible();
    expect(screen.getByText('Activity mix')).toBeVisible();
    expect(screen.getByText('Health log trends')).toBeVisible();
    expect(screen.getByText('Sleep observations')).toBeVisible();
    expect(screen.getByText('7.5h avg')).toBeVisible();
    expect(screen.getByText('4/5 avg')).toBeVisible();

    fireEvent.click(screen.getAllByText('Baseline log')[0]);
    expect(onOpen).toHaveBeenCalledWith('projects/wellness/notes/2026-05-baseline-log.md');

    fireEvent.click(screen.getByTitle('Fri, May 15: Logged easy run'));
    expect(onOpen).toHaveBeenCalledWith('projects/wellness/notes/2026-05-15-fitness-update.md');

    fireEvent.click(screen.getByRole('button', { name: /Open Strava note/i }));
    expect(onOpen).toHaveBeenCalledWith('projects/wellness/notes/2026-05-15-strava-activity-summary.md');

    fireEvent.click(screen.getByRole('button', { name: /7.5h sleep/ }));
    expect(onOpen).toHaveBeenCalledWith('areas/wellness/daily/2026-05-15.md');

    const taskCard = screen.getByText('Reset health admin and baseline log').closest('article') as HTMLElement;
    fireEvent.click(within(taskCard).getByRole('button', { name: 'Done' }));
    expect(onPatch).toHaveBeenCalledWith('tasks/active/t-health-one-medical-followup.md', { status: 'done' }, 10);

    fireEvent.click(within(taskCard).getByRole('button', { name: 'Checked today' }));
    expect(onPatch).toHaveBeenCalledWith('tasks/active/t-health-one-medical-followup.md', { last_touched: '2026-05-15' }, 10);
  });

  it('shows aggregate-safe fitness visuals while redacting private health details', () => {
    render(
      <HealthReviewView
        data={buildWorkbenchData(entries, { ...baseFilters, privateMode: true }, today)}
        entries={entries}
        privateMode
        onOpen={vi.fn()}
        onPatchTaskMetadata={vi.fn()}
        patchingTaskPath=""
      />,
    );

    expect(screen.getByText('Redacted wellness summary is on.')).toBeVisible();
    expect(screen.getByText(/private wellness entries are counted/i)).toBeVisible();
    expect(screen.getByText('Private admin / appointments item')).toBeVisible();
    expect(screen.getByText('Show redacted session grid')).toBeVisible();
    fireEvent.click(screen.getByText('Show redacted session grid'));
    expect(screen.getAllByText('Private fitness session')[0]).toBeVisible();
    expect(screen.getByText('Showing aggregate-safe fitness history.')).toBeVisible();
    expect(screen.getByText('Source note hidden')).toBeVisible();
    expect(screen.getAllByText('617')[0]).toBeVisible();
    expect(screen.getByText('Monthly volume')).toBeVisible();
    expect(screen.getByText('Activity mix')).toBeVisible();
    expect(screen.getAllByText('Run')[0]).toBeVisible();
    expect(screen.getAllByText('private details hidden')[0]).toBeVisible();
    expect(screen.getByText('Health log values hidden')).toBeVisible();
    expect(screen.queryByRole('button', { name: /Open Strava note/i })).not.toBeInTheDocument();
    expect(screen.queryByText('7.5h avg')).not.toBeInTheDocument();
    expect(screen.queryByText('4/5 avg')).not.toBeInTheDocument();
    expect(screen.queryByText('Logged easy run')).not.toBeInTheDocument();
    expect(screen.queryByText('Reset health admin and baseline log')).not.toBeInTheDocument();
    expect(screen.queryByText('projects/wellness/notes/2026-05-baseline-log.md')).not.toBeInTheDocument();
  });
});
