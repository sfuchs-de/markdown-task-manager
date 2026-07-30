import { useEffect, useId, useState } from 'react';
import type { TaskMetadataUpdates, VaultEntry, VaultFile } from './types';

export interface TaskQuickEditValue {
  path: string;
  title?: string | null;
  status?: string | null;
  priority?: string | null;
  urgent?: boolean | string | null;
  due?: string | null;
  deadlineType?: string | null;
  project?: string | null;
  estimateMinutes?: string | number | null;
  assignee?: string | null;
  modifiedAt?: number;
}

interface TaskQuickEditProps {
  task: TaskQuickEditValue;
  projectOptions: string[];
  onPatch: (path: string, updates: TaskMetadataUpdates, currentModifiedAt?: number) => Promise<void> | void;
  compact?: boolean;
  disabled?: boolean;
  note?: string;
}

const STATUS_OPTIONS = ['open', 'active', 'waiting', 'blocked', 'done', 'cancelled', 'archived'];
const PRIORITY_OPTIONS = ['', '1', '2', '3', '4'];
const DEADLINE_TYPE_OPTIONS = ['', 'hard', 'soft'];

function display(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value);
}

function truthy(value: unknown): boolean {
  if (value === true) return true;
  return ['true', '1', 'yes', 'urgent'].includes(display(value).toLowerCase());
}

export function taskQuickEditFromEntry(entry: VaultEntry): TaskQuickEditValue {
  return {
    path: entry.path,
    title: entry.title,
    status: entry.status || 'open',
    priority: entry.priority || '',
    urgent: entry.urgent ?? entry.properties?.urgent as boolean | string | undefined,
    due: entry.due || '',
    deadlineType: entry.deadline_type || (entry.properties?.deadline_type as string | undefined) || '',
    project: entry.project || '',
    estimateMinutes: entry.estimate_minutes || entry.properties?.estimate_minutes as string | number | undefined,
    assignee: entry.assignee || entry.assigned_to || entry.owner || display(entry.properties?.assignee || entry.properties?.assigned_to || entry.properties?.owner),
    modifiedAt: entry.modified_at,
  };
}

export function taskQuickEditFromFile(file: VaultFile): TaskQuickEditValue {
  return {
    path: file.path,
    title: display(file.frontmatter.title),
    status: display(file.frontmatter.status) || 'open',
    priority: display(file.frontmatter.priority),
    urgent: file.frontmatter.urgent as boolean | string | undefined,
    due: display(file.frontmatter.due),
    deadlineType: display(file.frontmatter.deadline_type),
    project: display(file.frontmatter.project),
    estimateMinutes: display(file.frontmatter.estimate_minutes),
    assignee: display(file.frontmatter.assignee || file.frontmatter.assigned_to || file.frontmatter.owner),
    modifiedAt: file.modified_at,
  };
}

export function applyTaskMetadataUpdates(
  frontmatter: Record<string, unknown>,
  updates: TaskMetadataUpdates,
): Record<string, unknown> {
  const next = { ...frontmatter };
  for (const [key, rawValue] of Object.entries(updates)) {
    if (key === 'urgent' || key === 'focus_manual') {
      if (rawValue === false || rawValue === null || rawValue === undefined || display(rawValue).trim() === '') {
        delete next[key];
      } else {
        next[key] = truthy(rawValue);
      }
      continue;
    }
    const value = display(rawValue).trim();
    if (key === 'status') {
      if (value) next.status = value;
      continue;
    }
    if (!value) {
      delete next[key];
      continue;
    }
    if (key === 'priority' || key === 'estimate_minutes') {
      const numeric = Number(value);
      next[key] = Number.isFinite(numeric) ? numeric : value;
    } else {
      next[key] = value;
    }
  }
  return next;
}

export function TaskQuickEdit({
  task,
  projectOptions,
  onPatch,
  compact = false,
  disabled = false,
  note,
}: TaskQuickEditProps) {
  const projectListId = useId();
  const [projectDraft, setProjectDraft] = useState(display(task.project));
  const [estimateDraft, setEstimateDraft] = useState(display(task.estimateMinutes));
  const [assigneeDraft, setAssigneeDraft] = useState(display(task.assignee));

  useEffect(() => {
    setProjectDraft(display(task.project));
    setEstimateDraft(display(task.estimateMinutes));
    setAssigneeDraft(display(task.assignee));
  }, [task.path, task.project, task.estimateMinutes, task.assignee]);

  const labelPrefix = task.title || task.path;
  const commit = (updates: TaskMetadataUpdates) => onPatch(task.path, updates, task.modifiedAt);
  const commitProject = () => {
    const next = projectDraft.trim();
    if (next !== display(task.project)) void commit({ project: next });
  };
  const commitEstimate = () => {
    const next = estimateDraft.trim();
    if (next !== display(task.estimateMinutes)) void commit({ estimate_minutes: next });
  };
  const commitAssignee = () => {
    const next = assigneeDraft.trim();
    if (next !== display(task.assignee)) void commit({ assignee: next });
  };

  return (
    <div className={`task-quick-edit ${compact ? 'compact' : ''}`} onClick={(event) => event.stopPropagation()}>
      <label>
        <span>Status</span>
        <select
          aria-label={`${labelPrefix} status`}
          value={display(task.status) || 'open'}
          disabled={disabled}
          onChange={(event) => void commit({ status: event.target.value })}
        >
          {STATUS_OPTIONS.map((status) => <option key={status} value={status}>{status}</option>)}
        </select>
      </label>
      <label>
        <span>Priority</span>
        <select
          aria-label={`${labelPrefix} priority`}
          value={display(task.priority)}
          disabled={disabled}
          onChange={(event) => void commit({ priority: event.target.value })}
        >
          {PRIORITY_OPTIONS.map((priority) => (
            <option key={priority || 'blank'} value={priority}>{priority ? `P${priority}` : 'No P'}</option>
          ))}
        </select>
      </label>
      <label className="task-quick-edit-check">
        <span>Urgent</span>
        <input
          aria-label={`${labelPrefix} urgent`}
          type="checkbox"
          checked={truthy(task.urgent)}
          disabled={disabled}
          onChange={(event) => void commit({ urgent: event.target.checked })}
        />
      </label>
      <label>
        <span>Due</span>
        <input
          aria-label={`${labelPrefix} due`}
          type="date"
          value={display(task.due)}
          disabled={disabled}
          onChange={(event) => void commit({ due: event.target.value })}
        />
      </label>
      <label>
        <span>Deadline</span>
        <select
          aria-label={`${labelPrefix} deadline type`}
          value={display(task.deadlineType)}
          disabled={disabled}
          onChange={(event) => void commit({ deadline_type: event.target.value })}
        >
          {DEADLINE_TYPE_OPTIONS.map((value) => (
            <option key={value || 'blank'} value={value}>{value || 'Auto'}</option>
          ))}
        </select>
      </label>
      <label>
        <span>Project</span>
        <input
          aria-label={`${labelPrefix} project`}
          list={projectListId}
          value={projectDraft}
          disabled={disabled}
          onChange={(event) => setProjectDraft(event.target.value)}
          onBlur={commitProject}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
          }}
        />
      </label>
      <label>
        <span>Estimate</span>
        <input
          aria-label={`${labelPrefix} estimate minutes`}
          type="number"
          min="1"
          max="1440"
          step="5"
          value={estimateDraft}
          disabled={disabled}
          onChange={(event) => setEstimateDraft(event.target.value)}
          onBlur={commitEstimate}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
          }}
        />
      </label>
      <label>
        <span>Assignee</span>
        <input
          aria-label={`${labelPrefix} assignee`}
          value={assigneeDraft}
          disabled={disabled}
          placeholder="Owner or collaborator"
          onChange={(event) => setAssigneeDraft(event.target.value)}
          onBlur={commitAssignee}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
          }}
        />
      </label>
      <datalist id={projectListId}>
        {projectOptions.map((project) => <option key={project} value={project} />)}
      </datalist>
      {note && <span className="task-quick-edit-note">{note}</span>}
    </div>
  );
}
