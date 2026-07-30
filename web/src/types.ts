export interface VaultEntry {
  path: string;
  filename: string;
  title: string;
  type?: string | null;
  kind?: string | null;
  explicit_type?: string | null;
  explicit_kind?: string | null;
  inferred_kind?: string | null;
  kind_source?: string | null;
  status?: string | null;
  project?: string | null;
  explicit_project?: string | null;
  inferred_project?: string | null;
  project_source?: string | null;
  domain?: string | null;
  time_category?: string | null;
  schedule_policy?: string | null;
  area?: string | null;
  explicit_area?: string | null;
  inferred_area?: string | null;
  area_source?: string | null;
  collection?: string | null;
  note_role?: string | null;
  id?: string | null;
  priority?: string | null;
  urgent?: boolean | string | null;
  focus_manual?: boolean | string | null;
  focus_rank?: string | number | null;
  deadline?: string | null;
  deadline_type?: 'hard' | 'soft' | string | null;
  due?: string | null;
  date?: string | null;
  estimate_minutes?: string | number | null;
  block_day?: string | null;
  block_week?: string | null;
  time_block?: string | null;
  assignee?: string | null;
  assigned_to?: string | null;
  owner?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  last_touched?: string | null;
  next?: string | null;
  icon?: string | null;
  url?: string | null;
  aliases?: string[];
  belongs_to?: string[];
  related_to?: string[];
  has?: string[];
  relationships?: Record<string, string[]>;
  outgoing_links?: string[];
  backlinks?: string[];
  properties?: Record<string, unknown>;
  system_properties?: Record<string, unknown>;
  private?: boolean;
  word_count?: number;
  snippet?: string;
  codex_instructions?: CodexInstruction[];
  modified_at?: number;
  created_at?: number;
  file_size?: number;
  file_kind?: 'markdown';
  error?: string;
}

export interface WorkbenchModuleConfig {
  enabled: boolean;
  label: string;
}

export interface WorkbenchConfig {
  application_name: string;
  owner_label: string;
  owner_aliases: string[];
  modules: Record<string, WorkbenchModuleConfig>;
  domain_labels: Record<string, string>;
}

export type CodexInstructionStatus = 'queued' | 'blocked' | 'processed' | 'cancelled';

export interface CodexInstruction {
  status: CodexInstructionStatus | string;
  date?: string | null;
  text: string;
  line?: number | null;
}

export interface TaskMetadataUpdates {
  status?: string;
  priority?: string;
  urgent?: boolean | string;
  focus_manual?: boolean | string;
  focus_rank?: string | number;
  time_category?: string;
  schedule_policy?: string;
  due?: string;
  deadline_type?: 'hard' | 'soft' | string;
  project?: string;
  estimate_minutes?: string | number;
  assignee?: string;
  last_touched?: string;
}

export type VaultMetadataUpdates = Record<string, string | number | boolean | null | undefined>;

export interface TaskCockpitState {
  status?: string | null;
  priority?: string | null;
  urgent?: boolean | string | null;
  due?: string | null;
  deadline_type?: 'hard' | 'soft' | string | null;
  project?: string | null;
  estimate_minutes?: string | number | null;
  assignee?: string | null;
  next?: string | null;
  block_day?: string | null;
  block_week?: string | null;
  time_block?: string | null;
  energy?: string | null;
  related_to?: string | null;
}

export interface ProjectCockpitState {
  status?: string | null;
  priority?: string | null;
  deadline?: string | null;
  deadline_type?: 'hard' | 'soft' | string | null;
  area?: string | null;
  lead?: string | null;
  energy?: string | null;
  next_action?: string | null;
  last_touched?: string | null;
  dashboard?: boolean | string | null;
}

export interface VaultFile {
  path: string;
  content: string;
  frontmatter: Record<string, unknown>;
  body: string;
  modified_at: number;
  file_size: number;
}

export interface GitStatus {
  enabled: boolean;
  branch: string | null;
  changed: Array<{ status: string; path: string }>;
  error?: string;
}

export interface GitHubSyncStatus {
  enabled: boolean;
  configured: boolean;
  repo: string;
  branch: string;
  token_configured: boolean;
  author_name: string;
  author_email: string;
  remote: string;
  sparse_dirs: string[];
  vault_root: string;
  git_available: boolean;
  vault_file_count: number;
  remote_head: string;
  actions?: GitHubActionsStatus;
  errors: string[];
}

export interface GitHubActionsRun {
  id?: number | string;
  name: string;
  workflow_name: string;
  status: string;
  conclusion: string;
  event: string;
  head_branch: string;
  head_sha: string;
  created_at: string;
  updated_at: string;
  html_url: string;
}

export interface GitHubActionsStatus {
  enabled: boolean;
  configured: boolean;
  token_configured: boolean;
  repo: string;
  branch: string;
  latest: GitHubActionsRun | null;
  runs: GitHubActionsRun[];
  errors: string[];
}

export interface GitHubSyncChange {
  status: string;
  path: string;
}

export interface GitHubSyncPushResult {
  ok: boolean;
  dry_run: boolean;
  changed: GitHubSyncChange[];
  copied: number;
  deleted: number;
  missing_from_vault: string[];
  committed: boolean;
  pushed: boolean;
  head?: string;
}

export interface GitHubSyncResetResult {
  ok: boolean;
  dry_run: boolean;
  missing: string[];
  changed: string[];
  extra: string[];
  copied: number;
  deleted: number;
  backup?: string;
}

export type GitHubSyncResult =
  | { kind: 'push'; result: GitHubSyncPushResult }
  | { kind: 'reset'; result: GitHubSyncResetResult };

export interface AppHealth {
  ok: boolean;
  vault_root?: string;
  vault_root_exists: boolean;
  auth_configured: boolean;
  seed_configured?: boolean;
  app_commit?: string | null;
  vault_manifest_exists?: boolean;
  entry_count?: number;
  task_count?: number;
  error?: string;
}

export interface GeneratedCacheFileStatus {
  path: string;
  exists: boolean;
  modified_at: number | null;
  fresh: boolean;
}

export interface AppDiagnostics {
  app_commit?: string | null;
  vault_root: string;
  vault_hash: {
    algorithm: string;
    value: string;
    file_count: number;
  };
  entry_counts?: {
    entries: number;
    tasks: number;
    projects: number;
  };
  last_vault_scan_at?: string | null;
  last_markdown_save_at?: string | null;
  seed?: {
    exists: boolean;
    path: string;
    generated_at?: string | null;
    mode?: string | null;
    seed_source?: string | null;
    app_commit?: string | null;
    counts?: Record<string, unknown>;
    error?: string;
  };
  generated_cache: {
    fresh: boolean;
    source_file_count: number;
    newest_source_modified_at: number | null;
    files: GeneratedCacheFileStatus[];
  };
  hosted_service: {
    configured: boolean;
    url: string;
    checked_at: string;
    ok: boolean | null;
    status_code: number | null;
    last_success_at: string | null;
    error: string;
  };
  github_sync: {
    enabled?: boolean;
    configured?: boolean;
    token_configured?: boolean;
    git_available?: boolean;
    repo?: string;
    branch?: string;
    remote_head?: string;
    vault_file_count?: number;
    errors: string[];
  };
  actions: {
    latest: GitHubActionsRun | null;
    errors: string[];
  };
}

export interface TimePlanSettings {
  date: string;
  week_start: string;
  start: string;
  capacity_minutes: number;
  weekdays: number;
  horizon_days: number;
  no_work_before?: string;
}

export interface TimePlanTask {
  kind?: 'task' | 'calendar';
  path: string;
  title: string;
  project?: string | null;
  domain?: string | null;
  time_category?: string | null;
  schedule_policy?: string | null;
  priority?: string | null;
  urgent?: boolean | string | null;
  focus_manual?: boolean | string | null;
  focus_rank?: string | number | null;
  status?: string | null;
  due?: string | null;
  deadline_type?: 'hard' | 'soft' | string | null;
  next?: string | null;
  minutes: number;
  estimate_minutes?: number;
  reason: string;
  private?: boolean;
  readonly?: boolean;
  sourceLabel?: string;
  sourceEventId?: string;
  allDay?: boolean;
  blocking?: boolean;
}

export interface TimePlanBlock extends TimePlanTask {
  start: string;
  end: string;
  segment_index?: number;
  segment_count?: number;
}

export interface TimePlanDay {
  date: string;
  total_minutes: number;
  blocks: TimePlanBlock[];
}

export interface TimePlanCalendarStatus {
  enabled: boolean;
  last_fetch: string;
  event_count: number;
  source_labels: string[];
  errors?: string[];
}

export interface TimePlanResponse {
  settings: TimePlanSettings;
  daily: TimePlanDay;
  daily_overflow: TimePlanTask[];
  weekly: TimePlanDay[];
  weekly_overflow: TimePlanTask[];
  calendar?: TimePlanCalendarStatus;
}

export interface TimePlanPreferenceProfile {
  path: string;
  exists: boolean;
  private: boolean;
  summary: string;
  content: string;
  settings?: { no_work_before?: string };
}

export interface TimePlanProjectSummary {
  path: string;
  title: string;
  id?: string | null;
  status?: string | null;
  priority?: string | null;
  deadline?: string | null;
  deadline_type?: 'hard' | 'soft' | string | null;
  days_until_deadline?: number | null;
  next?: string | null;
  open_task_count: number;
  private?: boolean;
}

export interface TimePlanAgentContext {
  settings: TimePlanSettings & { include_private?: boolean };
  ad_hoc: string;
  preferences: TimePlanPreferenceProfile;
  deterministic_plan: TimePlanResponse;
  calendar?: TimePlanCalendarStatus;
  pressing_tasks: TimePlanTask[];
  pressing_projects: TimePlanProjectSummary[];
  agent_prompt: string;
}

export type AppView = 'overview' | 'open-tasks' | 'codex-backlog' | 'admin-center' | 'performance-evaluation' | 'travel-center' | 'ra-management' | 'health-review' | 'sync' | 'projects' | 'project-detail' | 'types' | 'calendar' | 'time-plan' | 'recent' | 'library' | 'editor';

export type EditorMode = 'split' | 'preview' | 'raw';

export type ContextScope = 'note' | 'project';

export type BodyWidthPreset = 'S' | 'M' | 'L' | 'XL' | 'XXL';

export interface TypographyPreferences {
  editorFont: string;
  previewFont: string;
  codeFont: string;
  fontSize: number;
  lineHeight: number;
  bodyWidth: BodyWidthPreset;
}

export interface QuickLookState {
  path: string;
}

export interface LayoutPanels {
  nav: boolean;
  library: boolean;
  inspector: boolean;
}

export interface EntryFilters {
  lens: string;
  query: string;
  domain: string;
  privateMode: boolean;
  collection: string;
  entryProject: string;
  noteRole: string;
  taskStatus: string;
  taskPriority: string;
  taskProject: string;
}

export interface ScholarMetricPair {
  all: number;
  recent: number;
}

export interface ScholarPublication {
  title: string;
  year?: number;
  citations: number;
}

export interface ScholarStats {
  available: boolean;
  name?: string;
  affiliation?: string;
  profile_url?: string;
  updated?: string;
  recent_since_year?: number;
  metrics?: {
    citations?: ScholarMetricPair;
    h_index?: ScholarMetricPair;
    i10_index?: ScholarMetricPair;
  };
  citations_by_year?: Record<string, number>;
  top_publications?: ScholarPublication[];
}
