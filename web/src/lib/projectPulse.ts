import type { ProjectReview, ProjectNextDeadline } from './overview';

// A compact, at-a-glance view-model for one project: its state, how much is
// happening right now, and the single most pressing date. Built from the richer
// ProjectReview so the Home "Projects" panel stays a pure render.

export type ProjectActivityLevel = 0 | 1 | 2 | 3;

export interface ProjectPulse {
  id: string;
  path: string;
  name: string;
  area: string;
  /** 1–3 (or 99 when unset). */
  priority: number;
  /** Cleaned raw status text, e.g. "active", "scoping". */
  status: string;
  /** 0 (quiet) → 3 (busy), bucketed from live workload + recent throughput. */
  activityLevel: ProjectActivityLevel;
  stale: boolean;
  openTaskCount: number;
  coauthorTaskCount: number;
  urgentTaskCount: number;
  /** Tasks completed in the last three weeks (the momentum half of activity). */
  recentCompletionCount: number;
  /** Newest modification timestamp across the project — drives "recently changed". */
  latestActivityTs: number;
  nextDeadline: ProjectNextDeadline | null;
}

export interface ProjectPulseSplit {
  /** The N most recently changed projects, shown up front. */
  featured: ProjectPulse[];
  /** Everything else, kept in the panel's default (priority) order for the expander. */
  rest: ProjectPulse[];
}

function activityScore(pulse: ProjectPulse): number {
  return pulse.openTaskCount + pulse.coauthorTaskCount + pulse.recentCompletionCount;
}

/**
 * Split into the `featuredCount` most recently changed projects and the rest.
 * Featured are ranked by recency (ties broken by activity, then priority, then
 * name); the rest keep the incoming order so the expander stays priority-first.
 */
export function splitProjectPulse(pulse: ProjectPulse[], featuredCount = 3): ProjectPulseSplit {
  const byRecency = [...pulse].sort((a, b) =>
    b.latestActivityTs - a.latestActivityTs ||
    activityScore(b) - activityScore(a) ||
    a.priority - b.priority ||
    a.name.localeCompare(b.name));
  const featured = byRecency.slice(0, featuredCount);
  const featuredPaths = new Set(featured.map((pulse) => pulse.path));
  const rest = pulse.filter((pulse) => !featuredPaths.has(pulse.path));
  return { featured, rest };
}

// Statuses meaning the project is finished or parked — kept out of the live overview.
const INACTIVE_STATUSES = new Set([
  'done', 'complete', 'completed', 'cancelled', 'canceled', 'dropped', 'archived', 'archive',
]);

function priorityNumber(value: unknown): number {
  const parsed = Number(String(value ?? 99).match(/\d+/)?.[0] || 99);
  return Number.isFinite(parsed) ? parsed : 99;
}

/**
 * Bucket an activity score (open + delegated tasks + tasks closed in the last
 * three weeks) into a 0–3 meter: 0 reads as quiet, 6+ as busy. Task counts are
 * used rather than file mtimes, which are unreliable after a checkout.
 */
export function activityLevelFor(activityScore: number): ProjectActivityLevel {
  if (activityScore >= 6) return 3;
  if (activityScore >= 3) return 2;
  if (activityScore >= 1) return 1;
  return 0;
}

function isInactive(status: string): boolean {
  return INACTIVE_STATUSES.has(status.trim().toLowerCase());
}

function deadlineSortKey(pulse: ProjectPulse): string {
  return pulse.nextDeadline?.date || '9999-12-31';
}

// Sort: priority first, then the soonest deadline, then the busiest, then name.
function comparePulse(a: ProjectPulse, b: ProjectPulse): number {
  if (a.priority !== b.priority) return a.priority - b.priority;
  const ad = deadlineSortKey(a);
  const bd = deadlineSortKey(b);
  if (ad !== bd) return ad.localeCompare(bd);
  if (a.activityLevel !== b.activityLevel) return b.activityLevel - a.activityLevel;
  return a.name.localeCompare(b.name);
}

export function buildProjectPulse(reviews: ProjectReview[]): ProjectPulse[] {
  return reviews
    .filter((review) => !isInactive(String(review.project.status || '')))
    .map((review) => {
      const project = review.project;
      return {
        id: String(project.id || project.project || project.path),
        path: project.path,
        name: String(project.title || project.id || project.path),
        area: String(project.area || ''),
        priority: priorityNumber(project.priority),
        status: String(project.status || '').replace(/\s+/g, ' ').trim(),
        activityLevel: activityLevelFor(review.openTaskCount + review.coauthorTaskCount + review.recentCompletionCount),
        stale: review.stale,
        openTaskCount: review.openTaskCount,
        coauthorTaskCount: review.coauthorTaskCount,
        urgentTaskCount: review.urgentTaskCount,
        recentCompletionCount: review.recentCompletionCount,
        latestActivityTs: review.latestActivityTs,
        nextDeadline: review.nextDeadline,
      };
    })
    .sort(comparePulse);
}
