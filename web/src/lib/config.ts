import type { AppView, WorkbenchConfig } from '../types';

export const DEFAULT_WORKBENCH_CONFIG: WorkbenchConfig = {
  application_name: 'Research Workbench',
  owner_label: 'Owner',
  owner_aliases: ['owner', 'me', 'self'],
  modules: {
    overview: { enabled: true, label: 'Overview' },
    tasks: { enabled: true, label: 'Tasks' },
    projects: { enabled: true, label: 'Projects' },
    notes: { enabled: true, label: 'Library' },
    calendar: { enabled: true, label: 'Calendar' },
    boards: { enabled: true, label: 'Boards' },
    graph: { enabled: true, label: 'Graph' },
    time_planning: { enabled: true, label: 'Time Plan' },
    admin: { enabled: true, label: 'Admin Center' },
    travel: { enabled: true, label: 'Travel Center' },
    collaborators: { enabled: true, label: 'Collaborators' },
    wellness: { enabled: true, label: 'Wellness' },
    performance: { enabled: true, label: 'Performance Review' },
    scholar_metrics: { enabled: true, label: 'Scholar Metrics' },
    github_sync: { enabled: false, label: 'GitHub Sync' },
    markdown_editor: { enabled: true, label: 'Editor' },
    codex_backlog: { enabled: true, label: 'Agent Backlog' },
  },
  domain_labels: {
    research: 'Research',
    admin: 'Administration',
    teaching: 'Teaching',
    personal: 'Personal',
    system: 'System',
    archive: 'Archive',
    other: 'Other',
  },
};

const VIEW_MODULE: Partial<Record<AppView, string>> = {
  overview: 'overview',
  'open-tasks': 'tasks',
  'codex-backlog': 'codex_backlog',
  'admin-center': 'admin',
  'performance-evaluation': 'performance',
  'travel-center': 'travel',
  'ra-management': 'collaborators',
  'health-review': 'wellness',
  sync: 'github_sync',
  projects: 'projects',
  'project-detail': 'projects',
  types: 'notes',
  calendar: 'calendar',
  'time-plan': 'time_planning',
  recent: 'notes',
  library: 'notes',
  editor: 'markdown_editor',
};

export function moduleKeyForView(view: AppView): string {
  return VIEW_MODULE[view] || view;
}

export function isViewEnabled(config: WorkbenchConfig, view: AppView): boolean {
  const module = config.modules[moduleKeyForView(view)];
  return module ? module.enabled : true;
}

export function viewLabel(config: WorkbenchConfig, view: AppView, fallback: string): string {
  // Recent and Types are secondary lenses over the notes module. Reusing the
  // module label for them would create several indistinguishable nav buttons.
  if (view === 'recent' || view === 'types') return fallback;
  return config.modules[moduleKeyForView(view)]?.label || fallback;
}
