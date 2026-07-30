import type { VaultEntry } from '../types';
import type { AppView, LayoutPanels } from '../types';

export interface Command {
  id: string;
  title: string;
  detail: string;
  kind: 'action' | 'entry' | 'create' | 'view' | 'layout';
  payload?: string;
}

const viewCommands: Array<{ id: string; title: string; detail: string; payload: AppView }> = [
  { id: 'open-overview', title: 'Open Overview', detail: 'Return to the command center', payload: 'overview' },
  { id: 'open-open-tasks', title: 'Open Tasks', detail: 'Show active Markdown tasks', payload: 'open-tasks' },
  { id: 'open-codex-backlog', title: 'Open Codex Backlog', detail: 'Review queued task-local instructions for Codex', payload: 'codex-backlog' },
  { id: 'open-admin-center', title: 'Open Admin Center', detail: 'Review non-research admin, forms, policy/service, and life logistics', payload: 'admin-center' },
  { id: 'open-performance-evaluation', title: 'Open Performance Evaluation', detail: 'Review accomplishments, evidence, and verification gaps', payload: 'performance-evaluation' },
  { id: 'open-travel-center', title: 'Open Travel Center', detail: 'Review trips, approvals, expenses, and reimbursements', payload: 'travel-center' },
  { id: 'open-ra-management', title: 'Open Collaborators', detail: 'Review collaborator workload, blockers, and check-ins', payload: 'ra-management' },
  { id: 'open-health-review', title: 'Open Health Review', detail: 'Review private health tasks, routines, and status-only follow-ups', payload: 'health-review' },
  { id: 'open-sync', title: 'Open Sync', detail: 'Review hosted GitHub sync status and manual controls', payload: 'sync' },
  { id: 'open-projects', title: 'Open Projects', detail: 'Review active projects and next actions', payload: 'projects' },
  { id: 'open-types', title: 'Open Types', detail: 'Browse entries grouped by type lens', payload: 'types' },
  { id: 'open-calendar', title: 'Open Calendar', detail: 'Show dated tasks and events on a calendar', payload: 'calendar' },
  { id: 'open-time-plan', title: 'Open Time Plan', detail: 'Show automatic daily and weekly time blocks', payload: 'time-plan' },
  { id: 'open-recent', title: 'Open Recent', detail: 'Show recent Markdown activity', payload: 'recent' },
  { id: 'open-library', title: 'Open Library', detail: 'Browse the full Markdown library', payload: 'library' },
];

const layoutCommands: Array<{ id: string; title: string; detail: string; payload: keyof LayoutPanels }> = [
  { id: 'toggle-nav', title: 'Toggle Navigation', detail: 'Show or hide the main navigation', payload: 'nav' },
  { id: 'toggle-library', title: 'Toggle Markdown Library', detail: 'Show or hide the side library', payload: 'library' },
  { id: 'toggle-inspector', title: 'Toggle Inspector', detail: 'Show or hide file metadata inspector', payload: 'inspector' },
];

export function buildCommands(entries: VaultEntry[]): Command[] {
  const commands: Command[] = [
    ...viewCommands.map((command) => ({ ...command, kind: 'view' as const })),
    ...layoutCommands.map((command) => ({ ...command, kind: 'layout' as const })),
    { id: 'open-must-not-slip', title: 'Open Must Not Slip', detail: 'Show urgent tasks in the overview', kind: 'view', payload: 'overview' },
    { id: 'open-project-review', title: 'Open Project Review', detail: 'Show project health', kind: 'view', payload: 'projects' },
    { id: 'reload', title: 'Reload vault', detail: 'Rebuild the Markdown index from disk', kind: 'action' },
    { id: 'github-sync-status', title: 'GitHub Sync Status', detail: 'Open Sync and refresh hosted GitHub status', kind: 'action' },
    { id: 'github-sync-push-dry-run', title: 'Push Dry Run', detail: 'Open Sync and preview hosted vault changes before pushing', kind: 'action' },
    { id: 'toggle-private', title: 'Toggle private visibility', detail: 'Hide or show private entries in this browser view only', kind: 'action' },
    { id: 'create-task', title: 'Create task', detail: 'Create a Markdown task in tasks/active', kind: 'create', payload: 'task' },
    { id: 'create-note', title: 'Create inbox note', detail: 'Create a Markdown note in _inbox', kind: 'create', payload: 'note' },
    { id: 'create-project', title: 'Create project', detail: 'Create a Markdown project folder', kind: 'create', payload: 'project' },
  ];
  for (const entry of entries.slice(0, 250)) {
    commands.push({
      id: `open:${entry.path}`,
      title: `Open ${entry.title}`,
      detail: entry.path,
      kind: 'entry',
      payload: entry.path,
    });
  }
  return commands;
}
