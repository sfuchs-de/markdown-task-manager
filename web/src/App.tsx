import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import {
  Activity,
  AlarmClock,
  Award,
  Bot,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Circle,
  ClipboardList,
  Columns3,
  Copy,
  Eye,
  EyeOff,
  ExternalLink,
  FileText,
  FolderGit2,
  GitBranch,
  GraduationCap,
  HeartPulse,
  Home,
  Layers,
  Target,
  ListFilter,
  MoreHorizontal,
  PanelLeft,
  PanelRight,
  Pencil,
  Plane,
  Plus,
  Receipt,
  RefreshCcw,
  Save,
  Search,
  Send,
  SlidersHorizontal,
  Shield,
  Sparkles,
  Tags,
  TerminalSquare,
  Type,
  UsersRound,
  Wallet,
  X,
} from 'lucide-react';
import {
  ApiError,
  createEntry,
  getEntries,
  getConfig,
  getDiagnostics,
  getFile,
  getGitStatus,
  getGitHubSyncStatus,
  getHealth,
  getScholarStats,
  getStoredToken,
  patchTaskMetadata,
  patchVaultMetadata,
  pushGitHubSync,
  reloadVault,
  resetGitHubSync,
  saveFile,
  storeToken,
} from './api';
import type { AdminCenterData } from './lib/adminCenter';
import { codexInstructionCounts, formatCodexInstruction, parseCodexInstructions, type CodexBacklogData } from './lib/codexInstructions';
import { buildCommands, type Command } from './lib/commands';
import { DEFAULT_WORKBENCH_CONFIG, isViewEnabled, viewLabel } from './lib/config';
import { configureDomainLabels, domainLabel, entryDomain } from './lib/domain';
import { deadlineType, deadlineTypeLabel, isHardDeadline, nextDeadlineType } from './lib/deadlines';
import { entryLens, fieldCounts, filterEntries, groupCounts, isTask } from './lib/filters';
import { frontmatterFromContent, frontmatterScalar, replaceFrontmatter, scalarDisplay, setFrontmatterScalar } from './lib/frontmatter';
import { buildHealthReview, healthCategory, healthCategoryLabel, healthEntryDate, healthRoutineLabel, isHealthReviewEntry, type HealthStravaSummary, type HealthTaskGroup } from './lib/healthReview';
import { buildOverview, configureOwnerAliases, daysUntil, focusReason, isCoauthorAssignedTask, isDeferredTask, isManualUrgent, taskAssignee, type OverviewData, type OverviewTaskGroup, type ProjectPulse, type ProjectReview } from './lib/overview';
import type { PerformanceEvaluationData } from './lib/performanceEvaluation';
import type { RAManagementData, RARecord } from './lib/raManagement';
import { parseLedgerRows, type TravelCenterData, type TravelLedgerItem, type TravelTrip } from './lib/travelCenter';
import { awaitingSubmissions, conferenceDateLabel, isConferenceSubmissionDeadline, monitoredSubmissions, upcomingSubmissions, type ConferenceSubmission } from './lib/submissions';
import { availabilityForDate, buildAvailability, ymd, type AvailabilityDay, type AvailabilityStatus } from './lib/availability';
import { outstandingRefereeReports, type RefereeReport } from './lib/refereeReports';
import { splitProjectPulse } from './lib/projectPulse';
import { entryToneClass, kindToneClass, priorityTone, statusTone, urgencyTone } from './lib/visualTaxonomy';
import { buildCalendarMonth, buildCalendarWeek, buildCalendarYear, buildWorkbenchData, type CalendarDay, type CalendarItem, type CalendarMonth, type CalendarViewMode, type WorkbenchData, type TypeGroup } from './lib/workbench';
import { applyTaskMetadataUpdates, TaskQuickEdit, taskQuickEditFromEntry, taskQuickEditFromFile } from './TaskQuickEdit';
import type { AppDiagnostics, AppHealth, AppView, ContextScope, EditorMode, EntryFilters, GitHubSyncPushResult, GitHubSyncResult, GitHubSyncStatus, GitStatus, LayoutPanels, QuickLookState, ScholarStats, TaskMetadataUpdates, TypographyPreferences, VaultEntry, VaultFile, VaultMetadataUpdates, WorkbenchConfig } from './types';

const MarkdownEditor = lazy(() => import('./MarkdownEditor'));
const MarkdownRenderer = lazy(() => import('./MarkdownRenderer').then((module) => ({ default: module.MarkdownRenderer })));
const LazyTimePlanView = lazy(() => import('./TimePlanView').then((module) => ({ default: module.TimePlanView })));

const defaultFilters: EntryFilters = {
  lens: 'all',
  query: '',
  domain: '',
  privateMode: true,
  collection: '',
  entryProject: '',
  noteRole: '',
  taskStatus: '',
  taskPriority: '',
  taskProject: '',
};

const defaultPanels: LayoutPanels = {
  nav: true,
  library: false,
  inspector: true,
};

const PANELS_KEY = 'pm_workbench_panels';
const TYPOGRAPHY_KEY = 'pm_typography_preferences';
const CONTEXT_PANEL_KEY = 'pm_context_panel_open';
const privateHiddenLabel = 'Private hidden in this view';
const privateVisibleLabel = 'Private visible in this view';
const privateVisibilityTitle = 'Display filter only: this does not encrypt files or remove private data from the loaded vault.';

const defaultTypography: TypographyPreferences = {
  editorFont: 'SFMono-Regular, ui-monospace, Menlo, Consolas, monospace',
  previewFont: 'ui-serif, Georgia, "Times New Roman", serif',
  codeFont: 'SFMono-Regular, ui-monospace, Menlo, Consolas, monospace',
  fontSize: 16,
  lineHeight: 1.62,
  bodyWidth: 'L',
};

const bodyWidthPx: Record<TypographyPreferences['bodyWidth'], number> = {
  S: 620,
  M: 760,
  L: 900,
  XL: 1080,
  XXL: 1240,
};

const viewLabels: Record<AppView, string> = {
  overview: 'Overview',
  'open-tasks': 'Open Tasks',
  'codex-backlog': 'Codex Backlog',
  'admin-center': 'Admin Center',
  'performance-evaluation': 'Performance Evaluation',
  'travel-center': 'Travel Center',
  'ra-management': 'Collaborators',
  'health-review': 'Health Review',
  sync: 'Sync',
  projects: 'Projects',
  'project-detail': 'Project',
  types: 'Types',
  calendar: 'Calendar',
  'time-plan': 'Time Plan',
  recent: 'Recent',
  library: 'Library',
  editor: 'Editor',
};

function loadPanels(): LayoutPanels {
  if (typeof window === 'undefined') return defaultPanels;
  const mobileDefault = window.matchMedia?.('(max-width: 860px)').matches ? { inspector: false } : {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(PANELS_KEY) || '');
    return { ...defaultPanels, ...parsed, ...mobileDefault };
  } catch {
    return { ...defaultPanels, ...mobileDefault };
  }
}

export function loadTypographyPreferences(): TypographyPreferences {
  if (typeof window === 'undefined') return defaultTypography;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(TYPOGRAPHY_KEY) || '');
    return normalizeTypographyPreferences(parsed);
  } catch {
    return defaultTypography;
  }
}

function loadContextPanelOpen(): boolean {
  if (typeof window === 'undefined') return false;
  const raw = window.localStorage.getItem(CONTEXT_PANEL_KEY);
  return raw === null ? false : raw === 'true';
}

function normalizeTypographyPreferences(value: Partial<TypographyPreferences> | null | undefined): TypographyPreferences {
  const bodyWidth = ['S', 'M', 'L', 'XL', 'XXL'].includes(String(value?.bodyWidth))
    ? value?.bodyWidth as TypographyPreferences['bodyWidth']
    : defaultTypography.bodyWidth;
  const fontSize = Number(value?.fontSize);
  const lineHeight = Number(value?.lineHeight);
  return {
    editorFont: value?.editorFont || defaultTypography.editorFont,
    previewFont: value?.previewFont || defaultTypography.previewFont,
    codeFont: value?.codeFont || defaultTypography.codeFont,
    fontSize: Number.isFinite(fontSize) ? Math.min(22, Math.max(13, fontSize)) : defaultTypography.fontSize,
    lineHeight: Number.isFinite(lineHeight) ? Math.min(2, Math.max(1.2, lineHeight)) : defaultTypography.lineHeight,
    bodyWidth,
  };
}

export function saveTypographyPreferences(value: TypographyPreferences): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(TYPOGRAPHY_KEY, JSON.stringify(value));
}

export function typographyCssVariables(value: TypographyPreferences): CSSProperties {
  return {
    '--editor-font': value.editorFont,
    '--preview-font': value.previewFont,
    '--code-font': value.codeFont,
    '--editor-font-size': `${value.fontSize}px`,
    '--editor-line-height': String(value.lineHeight),
    '--document-width': `${bodyWidthPx[value.bodyWidth]}px`,
  } as CSSProperties;
}

function formatStamp(value?: number): string {
  if (!value) return 'unknown';
  return new Date(value * 1000).toLocaleString();
}

function parsePropertyValue(raw: string, original: unknown): unknown {
  if (Array.isArray(original)) {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [raw];
    } catch {
      return raw.split(',').map((item) => item.trim()).filter(Boolean);
    }
  }
  if (typeof original === 'boolean') return ['true', '1', 'yes'].includes(raw.toLowerCase());
  if (typeof original === 'number') {
    const numeric = Number(raw);
    return Number.isFinite(numeric) ? numeric : raw;
  }
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return raw;
}

function displayMetadataValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) {
    if (value.some((item) => item !== null && typeof item === 'object')) {
      return `${value.length} structured ${value.length === 1 ? 'item' : 'items'}`;
    }
    return value.join(', ');
  }
  if (typeof value === 'object') return 'Structured object';
  return String(value);
}

function isStructuredMetadataValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.some((item) => item !== null && typeof item === 'object');
  return typeof value === 'object';
}

function applyMetadataUpdates(
  frontmatter: Record<string, unknown>,
  updates: VaultMetadataUpdates,
): Record<string, unknown> {
  const next = { ...frontmatter };
  for (const [key, rawValue] of Object.entries(updates)) {
    if (rawValue === null || rawValue === undefined || String(rawValue).trim() === '') {
      delete next[key];
      continue;
    }
    if (key === 'priority' || key === 'estimate_minutes') {
      const numeric = Number(rawValue);
      next[key] = Number.isFinite(numeric) ? numeric : rawValue;
    } else if (key === 'private' || key === 'dashboard' || key === 'urgent') {
      next[key] = rawValue === true || String(rawValue).toLowerCase() === 'true';
    } else {
      next[key] = String(rawValue).trim();
    }
  }
  return next;
}

function entryIdentity(entry: VaultEntry | null): string {
  if (!entry) return '';
  return entry.id || entry.project || entry.title || entry.path;
}

function isProject(entry: VaultEntry | null): boolean {
  if (!entry) return false;
  const kind = String(entry.kind || entry.type || '').toLowerCase();
  return kind === 'project' || /^projects\/[^/]+\/README\.md$/.test(entry.path);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function calendarIso(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseCalendarIso(value: string): Date {
  const [year, month, day] = value.split('-').map((part) => Number(part));
  if (!year || !month || !day) return new Date();
  return new Date(year, month - 1, day);
}

function shiftCalendarDate(date: Date, viewMode: CalendarViewMode, amount: number): Date {
  if (viewMode === 'year') return new Date(date.getFullYear() + amount, date.getMonth(), 1);
  if (viewMode === 'month') return new Date(date.getFullYear(), date.getMonth() + amount, 1);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + amount * 7);
}

function calendarItemKey(item: CalendarItem): string {
  return `${item.entry.path}:${item.rangeStart || item.date}:${item.rangeEnd || item.date}`;
}

function uniqueCalendarItems(items: CalendarItem[]): CalendarItem[] {
  const byRange = new Map<string, CalendarItem>();
  for (const item of items) {
    const key = calendarItemKey(item);
    const current = byRange.get(key);
    if (!current || item.date < current.date) {
      byRange.set(key, item);
    }
  }
  return [...byRange.values()].sort((a, b) => {
    const aStart = a.rangeStart || a.date;
    const bStart = b.rangeStart || b.date;
    if (aStart !== bStart) return aStart.localeCompare(bStart);
    return a.entry.title.localeCompare(b.entry.title);
  });
}

function calendarDateSpanLabel(item: CalendarItem): string {
  const start = item.rangeStart || item.date;
  const end = item.rangeEnd || item.date;
  if (start === end) return start;
  return `${start} - ${end}`;
}

type CalendarScope = 'events' | 'focus' | 'all';

function calendarHighlightClass(item: CalendarItem): string {
  return `calendar-importance-${item.importance || 'normal'} calendar-highlight-${item.highlight || 'none'}`;
}

function calendarShouldShowCompactHighlight(item: CalendarItem): boolean {
  return Boolean(item.highlightShortLabel) && (item.importance === 'major' || item.importance === 'hard-deadline');
}

function calendarShouldShowAgendaHighlight(item: CalendarItem): boolean {
  if (item.highlight === 'none') return false;
  return item.highlight !== 'event' || item.importance !== 'normal';
}

function calendarTaskPriority(item: CalendarItem): number {
  const parsed = Number(item.entry.priority);
  return Number.isFinite(parsed) ? parsed : 99;
}

function calendarItemMatchesScope(item: CalendarItem, scope: CalendarScope): boolean {
  if (scope === 'all') return true;
  if (item.kind !== 'task') return true;
  if (scope === 'events') return item.importance === 'hard-deadline';
  return item.daysFromToday <= 1 || (calendarTaskPriority(item) <= 1 && item.daysFromToday <= 14);
}

function hiddenTaskCountsByDate(allItems: CalendarItem[], visibleItems: CalendarItem[]): Map<string, number> {
  const visibleKeys = new Set(visibleItems.map((item) => `${item.entry.path}:${item.date}`));
  const counts = new Map<string, number>();
  for (const item of allItems) {
    if (item.kind !== 'task') continue;
    if (visibleKeys.has(`${item.entry.path}:${item.date}`)) continue;
    counts.set(item.date, (counts.get(item.date) || 0) + 1);
  }
  return counts;
}

const LIFECYCLE_CLOSED_STATUSES = new Set(['done', 'cancelled', 'archived']);
const LIFECYCLE_ACTIVE_STATUSES = new Set(['open', 'active', 'blocked']);

function taskLifecycleMovePath(path: string, status: string): string | undefined {
  if (!path.startsWith('tasks/')) return undefined;
  const normalized = status.trim().toLowerCase();
  const filename = path.split('/').pop() || '';
  if (!filename) return undefined;
  let folder = '';
  if (LIFECYCLE_CLOSED_STATUSES.has(normalized)) folder = 'tasks/done';
  if (normalized === 'waiting') folder = 'tasks/waiting';
  if (LIFECYCLE_ACTIVE_STATUSES.has(normalized)) folder = 'tasks/active';
  if (!folder) return undefined;
  const target = `${folder}/${filename}`;
  return target === path ? undefined : target;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function appendToMarkdownSection(content: string, section: string, line: string): string {
  const pattern = new RegExp(`^##\\s+${escapeRegExp(section)}\\s*$`, 'im');
  const match = pattern.exec(content);
  const trimmed = line.trimEnd();
  if (!match) {
    const prefix = content.endsWith('\n') ? '' : '\n';
    return `${content}${prefix}\n## ${section}\n\n${trimmed}\n`;
  }
  const afterHeading = match.index + match[0].length;
  const rest = content.slice(afterHeading);
  const nextHeading = rest.search(/\n##\s+/);
  const insertAt = nextHeading >= 0 ? afterHeading + nextHeading : content.length;
  const before = content.slice(0, insertAt).replace(/\s*$/, '\n\n');
  const after = content.slice(insertAt);
  const suffix = after.startsWith('\n') || !after ? '' : '\n';
  return `${before}${trimmed}\n${suffix}${after}`;
}

function ensureMarkdownSections(content: string, sections: Array<{ title: string; body: string }>): string {
  let next = content;
  for (const section of sections) {
    const pattern = new RegExp(`^##\\s+${escapeRegExp(section.title)}\\s*$`, 'im');
    if (pattern.test(next)) continue;
    const prefix = next.endsWith('\n') ? '' : '\n';
    next = `${next}${prefix}\n## ${section.title}\n\n${section.body.trimEnd()}\n`;
  }
  return next;
}

function visibleStatusFromContent(content: string, fallback: unknown): string {
  return frontmatterScalar(content, 'status') || displayMetadataValue(fallback) || '';
}

function needsTokenInput(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes('pm_app_token') || normalized.includes('app token') || normalized.includes('invalid or missing');
}

function missingServerToken(message: string): boolean {
  return message.toLowerCase().includes('pm_app_token is required');
}

function emptyVaultMessage(health: AppHealth | null, entries: VaultEntry[]): string {
  const taskCount = entries.filter(isTask).length;
  if (entries.length > 0 && taskCount > 0) return '';
  if (!health) return '';
  if (health.entry_count === 0 || entries.length === 0) {
    return 'No Markdown entries were found. Initialize a vault or point PM_VAULT_ROOT at a folder containing Markdown files.';
  }
  if (taskCount === 0) {
    return `The hosted vault loaded ${health.entry_count ?? entries.length} Markdown entries, but no task entries. Confirm the deployed vault contains tasks/active/*.md.`;
  }
  return '';
}

interface NavigationSnapshot {
  activeView: AppView;
  selectedPath: string;
  selectedProjectPath: string;
}

type SyncCommandRequest = { id: number; action: 'status' | 'push-dry-run' } | null;

function sameNavigationSnapshot(a: NavigationSnapshot, b: NavigationSnapshot): boolean {
  return a.activeView === b.activeView && a.selectedPath === b.selectedPath && a.selectedProjectPath === b.selectedProjectPath;
}

export function App() {
  const [workbenchConfig, setWorkbenchConfig] = useState<WorkbenchConfig>(DEFAULT_WORKBENCH_CONFIG);
  const [entries, setEntries] = useState<VaultEntry[]>([]);
  const [scholarStats, setScholarStats] = useState<ScholarStats | null>(null);
  const [selectedPath, setSelectedPath] = useState<string>('');
  const [selectedProjectPath, setSelectedProjectPath] = useState<string>('');
  const [selectedFile, setSelectedFile] = useState<VaultFile | null>(null);
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [patchingTaskPath, setPatchingTaskPath] = useState('');
  const [patchingMetadataPath, setPatchingMetadataPath] = useState('');
  const [error, setError] = useState<string>('');
  const [health, setHealth] = useState<AppHealth | null>(null);
  const [gitStatus, setGitStatus] = useState<GitStatus | null>(null);
  const [syncStatus, setSyncStatus] = useState<GitHubSyncStatus | null>(null);
  const [dockSyncResult, setDockSyncResult] = useState<GitHubSyncPushResult | null>(null);
  const [dockSyncChecking, setDockSyncChecking] = useState(false);
  const [filters, setFilters] = useState<EntryFilters>(defaultFilters);
  const [layoutPanels, setLayoutPanels] = useState<LayoutPanels>(loadPanels);
  const [activeView, setActiveView] = useState<AppView>('overview');
  const [editorMode, setEditorMode] = useState<EditorMode>('preview');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState('');
  const [overviewFocus, setOverviewFocus] = useState('overview');
  const [tokenDraft, setTokenDraft] = useState(getStoredToken());
  const [typography, setTypography] = useState<TypographyPreferences>(loadTypographyPreferences);
  const [typographyOpen, setTypographyOpen] = useState(false);
  const [contextPanelOpen, setContextPanelOpen] = useState(loadContextPanelOpen);
  const [quickLook, setQuickLook] = useState<QuickLookState | null>(null);
  const [quickLookFile, setQuickLookFile] = useState<VaultFile | null>(null);
  const [quickLookLoading, setQuickLookLoading] = useState(false);
  const [quickLookError, setQuickLookError] = useState('');
  const [navigationHistory, setNavigationHistory] = useState<NavigationSnapshot[]>([]);
  const [syncCommandRequest, setSyncCommandRequest] = useState<SyncCommandRequest>(null);

  const selectedEntry = useMemo(
    () => entries.find((entry) => entry.path === selectedPath) || null,
    [entries, selectedPath],
  );
  const currentNavigation = useMemo<NavigationSnapshot>(
    () => ({ activeView, selectedPath, selectedProjectPath }),
    [activeView, selectedPath, selectedProjectPath],
  );
  const dirty = Boolean(selectedFile && content !== selectedFile.content);
  const showSideLibrary = layoutPanels.library && activeView === 'editor' && Boolean(selectedPath);
  const overviewData = useMemo(() => buildOverview(entries, filters.privateMode), [entries, filters.privateMode]);
  const workbenchBuilderFilters = useMemo<EntryFilters>(() => ({
    ...defaultFilters,
    privateMode: filters.privateMode,
    taskStatus: filters.taskStatus,
    taskPriority: filters.taskPriority,
    taskProject: filters.taskProject,
  }), [filters.privateMode, filters.taskPriority, filters.taskProject, filters.taskStatus]);
  const workbenchBaseData = useMemo(
    () => buildWorkbenchData(entries, workbenchBuilderFilters, new Date(), { ownerAliases: workbenchConfig.owner_aliases }),
    [entries, workbenchBuilderFilters, workbenchConfig.owner_aliases],
  );
  const filteredEntriesForView = useMemo(
    () => filterEntries(workbenchBaseData.visibleEntries, filters),
    [filters, workbenchBaseData.visibleEntries],
  );
  const workbenchData = useMemo(
    () => ({ ...workbenchBaseData, filteredEntries: filteredEntriesForView }),
    [filteredEntriesForView, workbenchBaseData],
  );
  const commandEntries = useMemo(
    () => filters.privateMode ? entries.filter((entry) => !entry.private) : entries,
    [entries, filters.privateMode],
  );
  const commands = useMemo(() => {
    const next = buildCommands(commandEntries);
    if (selectedPath) {
      next.unshift({
        id: 'quick-look-current',
        title: 'Quick Look Current File',
        detail: selectedPath,
        kind: 'action',
      });
    }
    next.unshift(
      {
        id: 'toggle-context-panel',
        title: contextPanelOpen ? 'Hide Context Panel' : 'Show Context Panel',
        detail: 'Toggle the right-side Codex context composer',
        kind: 'action',
      },
      {
        id: 'open-typography-settings',
        title: 'Open Typography Settings',
        detail: 'Adjust editor and preview reading controls',
        kind: 'action',
      },
    );
    return next;
  }, [commandEntries, contextPanelOpen, selectedPath]);
  const filteredCommands = useMemo(() => {
    const q = paletteQuery.trim().toLowerCase();
    if (!q) return commands.slice(0, 40);
    return commands.filter((command) => `${command.title} ${command.detail}`.toLowerCase().includes(q)).slice(0, 40);
  }, [commands, paletteQuery]);
  const taskProjects = useMemo(
    () => [...new Set(entries.filter(isTask).map((entry) => entry.project).filter(Boolean) as string[])].sort(),
    [entries],
  );
  const typeGroups = useMemo(() => groupCounts(workbenchData.visibleEntries), [workbenchData.visibleEntries]);
  const domainGroups = useMemo(() => workbenchData.domainGroups.map(({ lens, count }) => ({ lens, count })), [workbenchData.domainGroups]);
  const collectionGroups = useMemo(() => fieldCounts(workbenchData.visibleEntries, 'collection'), [workbenchData.visibleEntries]);
  const entryProjectGroups = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of workbenchData.visibleEntries) {
      const value = entry.project || entry.area;
      if (value) counts.set(value, (counts.get(value) || 0) + 1);
    }
    return [...counts.entries()]
      .map(([lens, count]) => ({ lens, count }))
      .sort((a, b) => b.count - a.count || a.lens.localeCompare(b.lens));
  }, [workbenchData.visibleEntries]);
  const noteRoleGroups = useMemo(() => fieldCounts(workbenchData.visibleEntries, 'note_role'), [workbenchData.visibleEntries]);

  const loadVault = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const nextHealth = await getHealth().catch(() => null);
      setHealth(nextHealth);
      const [nextConfig, nextEntries, nextGit, nextSyncStatus, nextScholar] = await Promise.all([
        getConfig().catch(() => DEFAULT_WORKBENCH_CONFIG),
        getEntries(),
        getGitStatus().catch(() => null),
        getGitHubSyncStatus().catch(() => null),
        getScholarStats().catch(() => null),
      ]);
      setWorkbenchConfig(nextConfig);
      configureDomainLabels(nextConfig.domain_labels);
      configureOwnerAliases(nextConfig.owner_aliases);
      document.title = nextConfig.application_name;
      setEntries(nextEntries);
      setGitStatus(nextGit);
      setSyncStatus(nextSyncStatus);
      setScholarStats(nextScholar);
      setDockSyncResult(null);
      const deploymentMessage = emptyVaultMessage(nextHealth, nextEntries);
      if (deploymentMessage) {
        setError(deploymentMessage);
      }
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : 'Could not load vault');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadVault();
  }, [loadVault]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(PANELS_KEY, JSON.stringify(layoutPanels));
    }
  }, [layoutPanels]);

  useEffect(() => {
    saveTypographyPreferences(typography);
  }, [typography]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(CONTEXT_PANEL_KEY, String(contextPanelOpen));
    }
  }, [contextPanelOpen]);

  useEffect(() => {
    if (!selectedPath) {
      setSelectedFile(null);
      setContent('');
      return;
    }
    // We already hold this exact file in memory (e.g. just saved/renamed, or a
    // reverted navigation). Re-fetching here would clobber the buffer and races
    // the just-set state, so skip it.
    if (selectedFile && selectedFile.path === selectedPath) {
      return;
    }
    // Navigating to a different file with unsaved edits would silently discard
    // them. Confirm first; on cancel, revert the navigation to the dirty file.
    if (selectedFile && content !== selectedFile.content) {
      const proceed = window.confirm('You have unsaved changes that will be lost. Discard them and switch files?');
      if (!proceed) {
        setSelectedPath(selectedFile.path);
        return;
      }
    }
    let cancelled = false;
    setError('');
    getFile(selectedPath)
      .then((file) => {
        if (cancelled) return;
        setSelectedFile(file);
        setContent(file.content);
      })
      .catch((exc) => {
        if (!cancelled) setError(exc instanceof Error ? exc.message : 'Could not open file');
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPath]);

  // Warn before a tab close/reload drops unsaved editor edits.
  useEffect(() => {
    if (!dirty) return undefined;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  useEffect(() => {
    if (!quickLook?.path) {
      setQuickLookFile(null);
      setQuickLookError('');
      return;
    }
    let cancelled = false;
    setQuickLookLoading(true);
    setQuickLookError('');
    getFile(quickLook.path)
      .then((file) => {
        if (!cancelled) setQuickLookFile(file);
      })
      .catch((exc) => {
        if (!cancelled) setQuickLookError(exc instanceof Error ? exc.message : 'Could not preview file');
      })
      .finally(() => {
        if (!cancelled) setQuickLookLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [quickLook]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        openCommandPalette();
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void handleSave();
      }
      if (event.key === 'Escape') {
        setPaletteOpen(false);
        setTypographyOpen(false);
        closeQuickLook();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  function openCommandPalette() {
    setPaletteQuery('');
    setPaletteOpen(true);
  }

  function togglePanel(panel: keyof LayoutPanels) {
    setLayoutPanels((current) => ({ ...current, [panel]: !current[panel] }));
  }

  function applyNavigation(snapshot: NavigationSnapshot) {
    setActiveView(snapshot.activeView);
    setSelectedPath(snapshot.selectedPath);
    setSelectedProjectPath(snapshot.selectedProjectPath);
    if (snapshot.activeView === 'overview') setOverviewFocus('overview');
  }

  function navigateTo(snapshot: NavigationSnapshot) {
    if (!sameNavigationSnapshot(currentNavigation, snapshot)) {
      setNavigationHistory((history) => {
        const last = history[history.length - 1];
        const nextHistory = last && sameNavigationSnapshot(last, currentNavigation)
          ? history
          : [...history, currentNavigation];
        return nextHistory.slice(-50);
      });
    }
    applyNavigation(snapshot);
  }

  function goBack() {
    const target = navigationHistory[navigationHistory.length - 1];
    if (!target) return;
    setNavigationHistory((history) => history.slice(0, -1));
    applyNavigation(target);
  }

  function openView(view: AppView) {
    navigateTo({ activeView: view, selectedPath, selectedProjectPath });
  }

  function openEntry(path: string) {
    navigateTo({ activeView: 'editor', selectedPath: path, selectedProjectPath });
    const entry = entries.find((candidate) => candidate.path === path);
    if (!entry || isTask(entry) || path.startsWith('tasks/')) setEditorMode('preview');
  }

  function openProject(path: string) {
    navigateTo({ activeView: 'project-detail', selectedPath, selectedProjectPath: path });
  }

  function openQuickLook(path: string) {
    setQuickLook({ path });
  }

  function closeQuickLook() {
    setQuickLook(null);
  }

  function openQuickLookInEditor() {
    if (!quickLook?.path) return;
    openEntry(quickLook.path);
    closeQuickLook();
  }

  async function handleSave() {
    if (!selectedFile || !dirty) return;
    setSaving(true);
    setError('');
    try {
      const status = visibleStatusFromContent(content, selectedFile.frontmatter.status);
      const moveTo = taskLifecycleMovePath(selectedFile.path, status);
      const contentToSave = LIFECYCLE_CLOSED_STATUSES.has(status.toLowerCase()) && !frontmatterScalar(content, 'completed')
        ? setFrontmatterScalar(content, 'completed', todayIso())
        : content;
      const saved = await saveFile(selectedFile.path, contentToSave, selectedFile.modified_at, moveTo);
      setSelectedPath(saved.path);
      setSelectedFile(saved);
      setContent(saved.content);
      const nextEntries = await reloadVault();
      setEntries(nextEntries);
      setDockSyncResult(null);
    } catch (exc) {
      if (exc instanceof ApiError && exc.status === 409) {
        setError(`${exc.message}. Your edits are still in the editor; reload after copying anything you need.`);
      } else {
        setError(exc instanceof Error ? exc.message : 'Save failed');
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleReload() {
    setError('');
    const nextEntries = await reloadVault();
    setEntries(nextEntries);
    setDockSyncResult(null);
    if (selectedPath) {
      const file = await getFile(selectedPath);
      setSelectedFile(file);
      setContent(file.content);
    }
  }

  async function handleCreate(kind: string) {
    const title = window.prompt(`Title for new ${kind}`);
    if (!title) return;
    setError('');
    try {
      const created = await createEntry(kind, title);
      const nextEntries = await reloadVault();
      setEntries(nextEntries);
      setDockSyncResult(null);
      setSelectedFile(created);
      setContent(created.content);
      navigateTo({ activeView: 'editor', selectedPath: created.path, selectedProjectPath });
      if (kind === 'task') setEditorMode('preview');
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : 'Create failed');
    }
  }

  async function handlePatchTaskMetadata(path: string, updates: TaskMetadataUpdates, currentModifiedAt?: number) {
    if (!Object.keys(updates).length) return;
    setError('');
    if (selectedFile?.path === path && dirty) {
      const nextFrontmatter = applyTaskMetadataUpdates(selectedFile.frontmatter || {}, updates);
      const nextContent = replaceFrontmatter(content, nextFrontmatter);
      setSelectedFile({ ...selectedFile, frontmatter: nextFrontmatter });
      setContent(nextContent);
      setError('Task metadata was applied to the unsaved editor draft. Press Save to write it to Markdown.');
      return;
    }

    setPatchingTaskPath(path);
    try {
      const saved = await patchTaskMetadata(path, updates, currentModifiedAt);
      if (selectedFile?.path === path) {
        setSelectedPath(saved.path);
        setSelectedFile(saved);
        setContent(saved.content);
      }
      const nextEntries = await reloadVault();
      setEntries(nextEntries);
      setDockSyncResult(null);
    } catch (exc) {
      if (exc instanceof ApiError && exc.status === 409) {
        setError(`${exc.message}. Reload this task before changing metadata.`);
      } else {
        setError(exc instanceof Error ? exc.message : 'Task metadata update failed');
      }
    } finally {
      setPatchingTaskPath('');
    }
  }

  async function handlePatchVaultMetadata(path: string, updates: VaultMetadataUpdates, currentModifiedAt?: number) {
    if (!Object.keys(updates).length) return;
    setError('');
    if (selectedFile?.path === path && dirty) {
      const nextFrontmatter = applyMetadataUpdates(selectedFile.frontmatter || {}, updates);
      const nextContent = replaceFrontmatter(content, nextFrontmatter);
      setSelectedFile({ ...selectedFile, frontmatter: nextFrontmatter });
      setContent(nextContent);
      setError('Metadata was applied to the unsaved editor draft. Press Save to write it to Markdown.');
      return;
    }

    setPatchingMetadataPath(path);
    try {
      const saved = await patchVaultMetadata(path, updates, currentModifiedAt);
      if (selectedFile?.path === path) {
        setSelectedFile(saved);
        setContent(saved.content);
      }
      const nextEntries = await reloadVault();
      setEntries(nextEntries);
      setDockSyncResult(null);
    } catch (exc) {
      if (exc instanceof ApiError && exc.status === 409) {
        setError(`${exc.message}. Reload this file before changing metadata.`);
      } else {
        setError(exc instanceof Error ? exc.message : 'Metadata update failed');
      }
    } finally {
      setPatchingMetadataPath('');
    }
  }

  async function reloadSelectedFile() {
    if (!selectedPath) return;
    setError('');
    try {
      const file = await getFile(selectedPath);
      setSelectedFile(file);
      setContent(file.content);
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : 'Could not open file');
    }
  }

  async function createLinkedTask() {
    const source = selectedEntry;
    const title = window.prompt('Title for linked task', source ? `Follow up: ${source.title}` : '');
    if (!title) return;
    setError('');
    try {
      const created = await createEntry('task', title);
      const updates: VaultMetadataUpdates = {};
      if (source?.project || source?.id) updates.project = source.project || source.id || '';
      if (source) updates.related_to = `[[${entryIdentity(source)}]]`;
      if (Object.keys(updates).length) await patchVaultMetadata(created.path, updates, created.modified_at);
      const nextEntries = await reloadVault();
      setEntries(nextEntries);
      const linked = await getFile(created.path);
      setSelectedFile(linked);
      setContent(linked.content);
      navigateTo({ activeView: 'editor', selectedPath: linked.path, selectedProjectPath });
      setEditorMode('preview');
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : 'Could not create linked task');
    }
  }

  function handleCommand(command: Command) {
    if (command.kind === 'entry' && command.payload) openEntry(command.payload);
    if (command.kind === 'view' && command.payload) {
      openView(command.payload as AppView);
      if (command.id === 'open-must-not-slip') setOverviewFocus('must-not-slip');
    }
    if (command.kind === 'layout' && command.payload) togglePanel(command.payload as keyof LayoutPanels);
    if (command.id === 'reload') void handleReload();
    if (command.id === 'github-sync-status') {
      openView('sync');
      setSyncCommandRequest({ id: Date.now(), action: 'status' });
    }
    if (command.id === 'github-sync-push-dry-run') {
      openView('sync');
      setSyncCommandRequest({ id: Date.now(), action: 'push-dry-run' });
    }
    if (command.id === 'toggle-private') setFilters((current) => ({ ...current, privateMode: !current.privateMode }));
    if (command.id === 'quick-look-current' && selectedPath) openQuickLook(selectedPath);
    if (command.id === 'toggle-context-panel') setContextPanelOpen((current) => !current);
    if (command.id === 'open-typography-settings') {
      openView('editor');
      setTypographyOpen(true);
    }
    if (command.kind === 'create' && command.payload) void handleCreate(command.payload);
    setPaletteOpen(false);
    setPaletteQuery('');
  }

  async function handleDockSyncCheck() {
    setDockSyncChecking(true);
    setError('');
    try {
      const nextStatus = await getGitHubSyncStatus();
      setSyncStatus(nextStatus);
      if (!nextStatus.enabled || !nextStatus.configured || !nextStatus.token_configured || !nextStatus.git_available) {
        setDockSyncResult(null);
        return;
      }
      setDockSyncResult(await pushGitHubSync({ dryRun: true }));
    } catch (exc) {
      setDockSyncResult(null);
      setError(exc instanceof Error ? exc.message : 'Could not check GitHub sync status');
    } finally {
      setDockSyncChecking(false);
    }
  }

  function updateFrontmatter(nextFrontmatter: Record<string, unknown>) {
    if (!selectedFile) return;
    const nextContent = replaceFrontmatter(content, nextFrontmatter);
    setContent(nextContent);
    setSelectedFile({ ...selectedFile, frontmatter: nextFrontmatter });
  }

  function selectType(lens: string) {
    setFilters((current) => ({ ...current, lens, domain: '', collection: '', noteRole: '' }));
    openView('library');
  }

  function selectDomain(domain: string) {
    setFilters((current) => ({ ...current, lens: 'all', domain, collection: '', noteRole: '' }));
    openView('library');
  }

  function selectCollection(collection: string) {
    setFilters((current) => ({ ...current, lens: 'all', domain: '', collection, noteRole: '' }));
    openView('library');
  }

  function selectNoteRole(noteRole: string) {
    setFilters((current) => ({ ...current, lens: 'all', domain: '', collection: '', noteRole }));
    openView('library');
  }

  const inspectorVisible = activeView === 'editor' && layoutPanels.inspector && Boolean(selectedPath);

  return (
    <div
      className="app"
      data-nav={layoutPanels.nav}
      data-library={showSideLibrary}
      data-inspector={inspectorVisible}
    >
      {layoutPanels.nav && (
        <Sidebar
          config={workbenchConfig}
          activeView={activeView}
          onView={openView}
          urgentTasks={overviewData.mustNotSlip.slice(0, 3)}
          onOpen={openEntry}
        />
      )}
      {showSideLibrary && (
        <MarkdownLibrary
          entries={workbenchData.filteredEntries}
          selectedPath={selectedPath}
          filters={filters}
          setFilters={setFilters}
          taskProjects={taskProjects}
          typeGroups={typeGroups}
          domainGroups={domainGroups}
          collectionGroups={collectionGroups}
          entryProjectGroups={entryProjectGroups}
          noteRoleGroups={noteRoleGroups}
          onSelect={openEntry}
          onQuickLook={openQuickLook}
          onPatchTaskMetadata={handlePatchTaskMetadata}
          patchingTaskPath={patchingTaskPath}
          variant="panel"
        />
      )}
      <main className="editor-panel">
        <WorkbenchTopbar
          config={workbenchConfig}
          activeView={activeView}
          layoutPanels={layoutPanels}
          selectedEntry={selectedEntry}
          onTogglePanel={togglePanel}
          onOpenPalette={openCommandPalette}
          canGoBack={navigationHistory.length > 0}
          onGoBack={goBack}
        />
        {activeView === 'editor' && selectedPath ? (
          <EditorView
            selectedEntry={selectedEntry}
            selectedFile={selectedFile}
            content={content}
            dirty={dirty}
            saving={saving}
            error={error}
            loading={loading}
            editorMode={editorMode}
            setEditorMode={setEditorMode}
            onSave={handleSave}
            onOpenPalette={openCommandPalette}
            onQuickLook={() => openQuickLook(selectedPath)}
            typography={typography}
            setTypography={setTypography}
            typographyOpen={typographyOpen}
            setTypographyOpen={setTypographyOpen}
            contextPanelOpen={contextPanelOpen}
            onToggleContextPanel={() => setContextPanelOpen((current) => !current)}
            onApplyFrontmatter={updateFrontmatter}
            onContentChange={setContent}
            taskProjects={taskProjects}
            entries={workbenchData.visibleEntries}
            projectReview={workbenchData.projectReview}
            onOpen={openEntry}
            onCreateLinkedTask={createLinkedTask}
            onOpenView={openView}
            onRetryOpen={reloadSelectedFile}
          />
        ) : (
          <WorkbenchView
            activeView={activeView}
            data={workbenchData}
            entries={entries}
            overviewData={overviewData}
            scholar={scholarStats}
            overviewFocus={overviewFocus}
            loading={loading}
            error={error}
            privateMode={filters.privateMode}
            filters={filters}
            setFilters={setFilters}
            taskProjects={taskProjects}
            typeGroups={typeGroups}
            domainGroups={domainGroups}
            collectionGroups={collectionGroups}
            entryProjectGroups={entryProjectGroups}
            noteRoleGroups={noteRoleGroups}
            onOpen={openEntry}
            onOpenProject={openProject}
            onCreate={handleCreate}
            onOpenPalette={openCommandPalette}
            onOpenView={openView}
            syncCommandRequest={syncCommandRequest}
            onReloadVault={handleReload}
            selectedProjectPath={selectedProjectPath}
            onPatchTaskMetadata={handlePatchTaskMetadata}
            patchingTaskPath={patchingTaskPath}
            onQuickLook={openQuickLook}
            onSelectType={selectType}
            onSelectDomain={selectDomain}
            onSelectCollection={selectCollection}
            onSelectNoteRole={selectNoteRole}
          />
        )}
      </main>
      {inspectorVisible && (
        <Inspector
          entry={selectedEntry}
          file={selectedFile}
          entries={workbenchData.visibleEntries}
          projectReview={workbenchData.projectReview}
          gitStatus={gitStatus}
          onOpen={openEntry}
          onApplyFrontmatter={updateFrontmatter}
        />
      )}
      {paletteOpen && (
        <CommandPalette
          commands={filteredCommands}
          query={paletteQuery}
          setQuery={setPaletteQuery}
          onRun={handleCommand}
          onClose={() => setPaletteOpen(false)}
        />
      )}
      {quickLook && (
        <QuickLookModal
          entry={entries.find((entry) => entry.path === quickLook.path) || null}
          file={quickLookFile}
          loading={quickLookLoading}
          error={quickLookError}
          onClose={closeQuickLook}
          onOpen={openQuickLookInEditor}
        />
      )}
      {error && needsTokenInput(error) && (
        <TokenDialog
          error={error}
          health={health}
          tokenDraft={tokenDraft}
          setTokenDraft={setTokenDraft}
          onSave={() => {
            storeToken(tokenDraft);
            void loadVault();
          }}
        />
      )}
      <MobileBottomBar
        activeView={activeView}
        filters={filters}
        setFilters={setFilters}
        layoutPanels={layoutPanels}
        gitStatus={gitStatus}
        loading={loading}
        dirty={dirty}
        saving={saving}
        selectedEntry={selectedEntry}
        selectedFile={selectedFile}
        patchingTaskPath={patchingTaskPath}
        editorMode={editorMode}
        setEditorMode={setEditorMode}
        onPatchTaskMetadata={handlePatchTaskMetadata}
        onView={openView}
        onCreate={handleCreate}
        onReload={handleReload}
        onTogglePanel={togglePanel}
        onOpenPalette={openCommandPalette}
        onSave={handleSave}
      />
      <WorkDock
        config={workbenchConfig}
        activeView={activeView}
        data={workbenchData}
        overviewData={overviewData}
        selectedEntry={selectedEntry}
        selectedProjectPath={selectedProjectPath}
        dirty={dirty}
        saving={saving}
        filters={filters}
        setFilters={setFilters}
        syncStatus={syncStatus}
        syncResult={dockSyncResult}
        syncChecking={dockSyncChecking}
        onCheckSync={handleDockSyncCheck}
        onOpenSync={() => openView('sync')}
        onCreate={handleCreate}
        onOpenPalette={openCommandPalette}
        onSave={handleSave}
      />
    </div>
  );
}

type DateLabelMode = 'full' | 'relative';

function dueDateLabel(date: string | null | undefined, mode: DateLabelMode = 'full'): string {
  if (!date) return 'no date';
  const days = daysUntil(date);
  if (days === null) return date;
  if (days === 0) return mode === 'relative' ? 'today' : `${date} · today`;
  if (days < 0) {
    const relative = `${Math.abs(days)}d overdue`;
    return mode === 'relative' ? relative : `${date} · ${relative}`;
  }
  const relative = `in ${days}d`;
  return mode === 'relative' ? relative : `${date} · ${relative}`;
}

function dueLabel(entry: VaultEntry, mode: DateLabelMode = 'full'): string {
  return dueDateLabel(entry.due || entry.date || entry.start_date || '', mode);
}

function minutesLabel(minutes: number): string {
  if (!minutes) return '0m';
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest}m`;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

function estimateLabel(entry: VaultEntry): string | null {
  const raw = entry.estimate_minutes ?? entry.properties?.estimate_minutes;
  const minutes = Number(raw);
  if (!Number.isFinite(minutes) || minutes <= 0) return null;
  return minutesLabel(minutes);
}

export function WorkbenchTopbar({
  config = DEFAULT_WORKBENCH_CONFIG,
  activeView,
  layoutPanels,
  selectedEntry,
  onTogglePanel,
  onOpenPalette,
  canGoBack,
  onGoBack,
}: {
  config?: WorkbenchConfig;
  activeView: AppView;
  layoutPanels: LayoutPanels;
  selectedEntry: VaultEntry | null;
  onTogglePanel: (panel: keyof LayoutPanels) => void;
  onOpenPalette: () => void;
  canGoBack: boolean;
  onGoBack: () => void;
  }) {
  return (
    <div className="workbench-topbar">
      <div className="topbar-title-group">
        <button
          type="button"
          className="topbar-back-button"
          aria-label="Go back"
          title={canGoBack ? 'Go back' : 'No previous page'}
          disabled={!canGoBack}
          onClick={onGoBack}
        >
          <ChevronLeft size={16} />
          <span>Back</span>
        </button>
        <div>
          <span className="eyebrow">{activeView === 'editor' ? selectedEntry ? entryLens(selectedEntry) : 'editor' : config.application_name}</span>
          <strong>{activeView === 'editor' ? selectedEntry?.title || viewLabel(config, 'editor', 'Editor') : viewLabel(config, activeView, viewLabels[activeView])}</strong>
        </div>
      </div>
      <div className="topbar-actions">
        <button
          type="button"
          className="topbar-search-button"
          aria-label="Search commands and files"
          title="Search commands and files (Cmd-K)"
          onClick={onOpenPalette}
        >
          <Search size={15} />
          <span>Search</span>
          <kbd>Cmd-K</kbd>
        </button>
        <button aria-label={layoutPanels.nav ? 'Hide navigation' : 'Show navigation'} title={layoutPanels.nav ? 'Hide navigation' : 'Show navigation'} onClick={() => onTogglePanel('nav')}>
          <PanelLeft size={16} />
        </button>
        <button aria-label={layoutPanels.library ? 'Hide Markdown library' : 'Show Markdown library'} title={layoutPanels.library ? 'Hide Markdown library' : 'Show Markdown library'} onClick={() => onTogglePanel('library')}>
          <FileText size={16} />
        </button>
        <button aria-label={layoutPanels.inspector ? 'Hide inspector' : 'Show inspector'} title={layoutPanels.inspector ? 'Hide inspector' : 'Show inspector'} onClick={() => onTogglePanel('inspector')}>
          <PanelRight size={16} />
        </button>
      </div>
    </div>
  );
}

type MobileSheet = 'new' | 'more' | null;

export function MobileBottomBar({
  activeView,
  filters,
  setFilters,
  layoutPanels,
  gitStatus,
  loading,
  dirty,
  saving,
  selectedEntry,
  selectedFile,
  patchingTaskPath,
  editorMode,
  setEditorMode,
  onPatchTaskMetadata,
  onView,
  onCreate,
  onReload,
  onTogglePanel,
  onOpenPalette,
  onSave,
}: {
  activeView: AppView;
  filters: EntryFilters;
  setFilters: (next: EntryFilters | ((current: EntryFilters) => EntryFilters)) => void;
  layoutPanels: LayoutPanels;
  gitStatus: GitStatus | null;
  loading: boolean;
  dirty: boolean;
  saving: boolean;
  selectedEntry: VaultEntry | null;
  selectedFile: VaultFile | null;
  patchingTaskPath: string;
  editorMode: EditorMode;
  setEditorMode: (mode: EditorMode) => void;
  onPatchTaskMetadata: (path: string, updates: TaskMetadataUpdates, currentModifiedAt?: number) => Promise<void> | void;
  onView: (view: AppView) => void;
  onCreate: (kind: string) => void;
  onReload: () => void;
  onTogglePanel: (panel: keyof LayoutPanels) => void;
  onOpenPalette: () => void;
  onSave: () => void;
  }) {
  const [sheet, setSheet] = useState<MobileSheet>(null);
  const moreActive = sheet === 'more' || ['codex-backlog', 'admin-center', 'performance-evaluation', 'travel-center', 'ra-management', 'health-review', 'sync', 'projects', 'project-detail', 'calendar', 'recent', 'types', 'library', 'editor'].includes(activeView);
  const activeEditorTask = activeView === 'editor' && selectedEntry && isTask(selectedEntry) ? selectedEntry : null;
  const taskActionDisabled = Boolean(activeEditorTask && patchingTaskPath === activeEditorTask.path);

  function run(action: () => void) {
    setSheet(null);
    action();
  }

  function patchActiveTask(status: string) {
    if (!activeEditorTask) return;
    void onPatchTaskMetadata(activeEditorTask.path, { status }, selectedFile?.modified_at);
  }

  const primaryItems: Array<{ label: string; view?: AppView; icon: ReactNode; active: boolean; onClick: () => void }> = [
    { label: 'Overview', view: 'overview', icon: <Home size={18} />, active: activeView === 'overview', onClick: () => run(() => onView('overview')) },
    { label: 'Tasks', view: 'open-tasks', icon: <ClipboardList size={18} />, active: activeView === 'open-tasks', onClick: () => run(() => onView('open-tasks')) },
    { label: 'Time', view: 'time-plan', icon: <Clock3 size={18} />, active: activeView === 'time-plan', onClick: () => run(() => onView('time-plan')) },
    { label: 'New', icon: <Plus size={18} />, active: sheet === 'new', onClick: () => setSheet((current) => current === 'new' ? null : 'new') },
    { label: 'More', icon: <MoreHorizontal size={18} />, active: moreActive, onClick: () => setSheet((current) => current === 'more' ? null : 'more') },
  ];

  return (
    <nav className="mobile-bottom-shell" aria-label="Mobile app actions">
      {sheet && <button className="mobile-sheet-backdrop" aria-label="Close mobile menu" onClick={() => setSheet(null)} />}
      {sheet === 'new' && (
        <section className="mobile-action-sheet" role="dialog" aria-label="New item actions">
          <div className="mobile-sheet-heading">
            <strong>Create</strong>
            <button onClick={() => setSheet(null)} aria-label="Close new item actions">Close</button>
          </div>
          <div className="mobile-sheet-grid">
            <button onClick={() => run(() => onCreate('task'))}><Plus size={16} /> New task</button>
            <button onClick={() => run(() => onCreate('note'))}><Plus size={16} /> New note</button>
            <button onClick={() => run(() => onCreate('project'))}><Plus size={16} /> New project</button>
          </div>
        </section>
      )}
      {sheet === 'more' && (
        <section className="mobile-action-sheet" role="dialog" aria-label="Mobile more actions">
          <div className="mobile-sheet-heading">
            <strong>More</strong>
            <button onClick={() => setSheet(null)} aria-label="Close mobile more actions">Close</button>
          </div>
          {activeView === 'editor' && (
            <div className="mobile-sheet-section">
              <span>Editor</span>
              <div className="mobile-sheet-grid">
                <button disabled={!dirty || saving} onClick={() => run(onSave)}>
                  {dirty ? <Save size={16} /> : <Check size={16} />}
                  {saving ? 'Saving...' : dirty ? 'Save draft' : 'Saved'}
                </button>
                {(['split', 'preview', 'raw'] as const).map((mode) => (
                  <button
                    key={mode}
                    className={editorMode === mode ? 'active' : ''}
                    onClick={() => run(() => setEditorMode(mode))}
                  >
                    {mode === 'raw' ? 'Source' : mode[0].toUpperCase() + mode.slice(1)}
                  </button>
                ))}
              </div>
            </div>
          )}
          {activeEditorTask && (
            <div className="mobile-sheet-section mobile-task-section">
              <span>Current task</span>
              <div className="mobile-sheet-grid">
                <button disabled={taskActionDisabled} onClick={() => run(() => patchActiveTask('done'))}><Check size={16} /> Done</button>
                <button disabled={taskActionDisabled} onClick={() => run(() => patchActiveTask('waiting'))}>Waiting</button>
                <button disabled={taskActionDisabled} onClick={() => run(() => patchActiveTask('blocked'))}>Blocked</button>
                <button onClick={() => run(() => onView('open-tasks'))}><ClipboardList size={16} /> Tasks</button>
              </div>
            </div>
          )}
          <div className="mobile-sheet-section">
            <span>Centers</span>
	            <div className="mobile-sheet-grid">
	              <button onClick={() => run(() => onView('codex-backlog'))}><Bot size={16} /> Codex Backlog</button>
	              <button onClick={() => run(() => onView('admin-center'))}><SlidersHorizontal size={16} /> Admin Center</button>
	              <button onClick={() => run(() => onView('travel-center'))}><Plane size={16} /> Travel Center</button>
	              <button onClick={() => run(() => onView('health-review'))}><HeartPulse size={16} /> Health Review</button>
	              <button onClick={() => run(() => onView('projects'))}><Layers size={16} /> Projects</button>
              <button onClick={() => run(() => onView('calendar'))}><CalendarDays size={16} /> Calendar</button>
              <button onClick={() => run(() => onView('sync'))}><GitBranch size={16} /> Sync</button>
            </div>
          </div>
          <div className="mobile-sheet-section">
            <span>Utilities</span>
            <div className="mobile-sheet-grid">
              <button onClick={() => run(onOpenPalette)}><TerminalSquare size={16} /> Command palette</button>
              <button className={layoutPanels.library ? 'active' : ''} onClick={() => run(() => onTogglePanel('library'))}>
                <FileText size={16} /> {layoutPanels.library ? 'Hide library panel' : 'Show library panel'}
              </button>
              <button onClick={() => run(onReload)}><RefreshCcw size={16} /> {loading ? 'Loading...' : 'Reload vault'}</button>
              <button
                className={filters.privateMode ? 'active' : ''}
                title={privateVisibilityTitle}
                onClick={() => run(() => setFilters((current) => ({ ...current, privateMode: !current.privateMode })))}
              >
                {filters.privateMode ? <EyeOff size={16} /> : <Eye size={16} />}
                {filters.privateMode ? privateHiddenLabel : privateVisibleLabel}
              </button>
            </div>
            <p className="mobile-repo-status">
              {gitStatus?.enabled ? `${gitStatus.branch || 'detached'} · ${gitStatus.changed.length} changed` : 'Git disabled'}
            </p>
          </div>
        </section>
      )}
      <div className="mobile-bottom-bar">
        {primaryItems.map((item) => (
          <button
            key={item.label}
            className={item.active ? 'active' : ''}
            aria-current={item.view && activeView === item.view ? 'page' : undefined}
            onClick={item.onClick}
          >
            {item.icon}
            <span>{item.label}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}

function projectSlugFromEntry(entry: VaultEntry | null): string {
  if (!entry) return '';
  const parts = entry.path.split('/');
  const index = parts.findIndex((part) => part === 'projects' || part === 'areas');
  return index >= 0 ? parts[index + 1] || '' : String(entry.id || entry.project || '').trim();
}

function dockProjectLabel(entry: VaultEntry | null): string {
  if (!entry) return 'Dashboard';
  return entry.title;
}

function dockSyncSummary(
  status: GitHubSyncStatus | null,
  result: GitHubSyncPushResult | null,
  checking: boolean,
): { tone: string; label: string; detail: string; title: string } {
  if (checking) {
    return { tone: 'checking', label: 'Checking', detail: 'dry-run in progress', title: 'Checking hosted vault against GitHub' };
  }
  if (!status) {
    return { tone: 'unknown', label: 'Sync unknown', detail: 'status not loaded', title: 'Open Sync or refresh the vault to load hosted sync status' };
  }
  if (!status.enabled) {
    return { tone: 'off', label: 'Sync off', detail: 'not enabled', title: 'GitHub sync is disabled on this server' };
  }
  if (!status.configured) {
    return { tone: 'attention', label: 'Sync setup', detail: 'repo missing', title: 'GitHub sync is enabled but not fully configured' };
  }
  if (!status.token_configured) {
    return { tone: 'attention', label: 'Token needed', detail: 'server secret missing', title: 'PM_GITHUB_TOKEN is not configured on the server' };
  }
  if (!status.git_available) {
    return { tone: 'attention', label: 'Git missing', detail: 'server cannot sync', title: 'The server cannot find git' };
  }
  if (status.errors?.length) {
    return { tone: 'attention', label: 'Sync attention', detail: status.errors[0], title: status.errors.join(' ') };
  }
  if (result) {
    const pending = result.changed.length + result.missing_from_vault.length;
    if (pending === 0) {
      return {
        tone: 'synced',
        label: 'Synced',
        detail: `${shortSha(status.remote_head)} · ${status.vault_file_count} files`,
        title: 'Last dry-run found no hosted vault changes to push',
      };
    }
    return {
      tone: 'pending',
      label: `${pending} pending`,
      detail: `${result.changed.length} changed · ${result.missing_from_vault.length} remote extras`,
      title: 'Last dry-run found hosted vault differences. Open Sync to review and push.',
    };
  }
  return {
    tone: 'ready',
    label: 'Sync ready',
    detail: `${shortSha(status.remote_head)} · check changes`,
    title: 'Run a dry-run check from the dock, or open Sync for full controls',
  };
}

export function WorkDock({
  config = DEFAULT_WORKBENCH_CONFIG,
  activeView,
  data,
  overviewData,
  selectedEntry,
  selectedProjectPath,
  dirty,
  saving,
  filters,
  setFilters,
  syncStatus,
  syncResult,
  syncChecking,
  onCheckSync,
  onOpenSync,
  onCreate,
  onOpenPalette,
  onSave,
}: {
  config?: WorkbenchConfig;
  activeView: AppView;
  data: WorkbenchData;
  overviewData: OverviewData;
  selectedEntry: VaultEntry | null;
  selectedProjectPath: string;
  dirty: boolean;
  saving: boolean;
  filters: EntryFilters;
  setFilters: (next: EntryFilters | ((current: EntryFilters) => EntryFilters)) => void;
  syncStatus: GitHubSyncStatus | null;
  syncResult: GitHubSyncPushResult | null;
  syncChecking: boolean;
  onCheckSync: () => Promise<void> | void;
  onOpenSync: () => void;
  onCreate: (kind: string) => void;
  onOpenPalette: () => void;
  onSave: () => void;
}) {
  const [newMenuOpen, setNewMenuOpen] = useState(false);
  const syncSummary = dockSyncSummary(syncStatus, syncResult, syncChecking);
  const selectedProject =
    activeView === 'project-detail'
      ? data.projectReview.find((item) => item.project.path === selectedProjectPath)?.project || null
      : selectedEntry && !isProject(selectedEntry)
        ? data.projectReview.find((item) => belongsToProjectEntry(selectedEntry, item.project))?.project || null
        : isProject(selectedEntry)
          ? selectedEntry
          : null;
  const projectTasks = selectedProject ? projectOpenTasks(selectedProject, data.visibleEntries).filter((task) => !isCoauthorAssignedTask(task)) : [];
  const contextTitle =
    activeView === 'editor' && selectedEntry ? selectedEntry.title :
    selectedProject ? dockProjectLabel(selectedProject) :
    viewLabel(config, activeView, viewLabels[activeView] || 'Dashboard');
  const contextMeta =
    activeView === 'editor' && selectedEntry ? `${entryLens(selectedEntry)} · ${selectedEntry.path}` :
    selectedProject ? `${projectTasks.length} open · ${selectedProject.status || 'project'}` :
    `${overviewData.openTasks.length} open tasks`;
  const canSave = activeView === 'editor' && dirty;

  function createFromDock(kind: string) {
    setNewMenuOpen(false);
    onCreate(kind);
  }

  return (
    <aside className="work-dock-shell" aria-label="Persistent dashboard actions">
      <div className="work-dock-context">
        <strong>{contextTitle}</strong>
        <span>{contextMeta}</span>
      </div>
      <div className={`work-dock-sync ${syncSummary.tone}`} aria-label="Vault sync status">
        <button
          type="button"
          className="work-dock-sync-status"
          onClick={() => void onCheckSync()}
          disabled={syncChecking}
          title={syncSummary.title}
        >
          {syncChecking ? <RefreshCcw size={13} /> : <Circle size={9} />}
          <span className="work-dock-sync-copy">
            <strong>{syncSummary.label}</strong>
            <span>{syncSummary.detail}</span>
          </span>
        </button>
        <button type="button" className="work-dock-sync-open" onClick={onOpenSync} aria-label="Open Sync panel">
          <GitBranch size={14} />
          <span>Sync</span>
        </button>
      </div>
      <div className="work-dock-actions" aria-label="Dock actions">
        {canSave && (
          <button className="primary" onClick={onSave} disabled={saving} aria-label="Save draft from dock">
            <Save size={15} />
            <span>{saving ? 'Saving' : 'Save'}</span>
          </button>
        )}
        <div className="work-dock-new-wrap">
          <button
            aria-label="New"
            aria-haspopup="menu"
            aria-expanded={newMenuOpen}
            onClick={() => setNewMenuOpen((current) => !current)}
          >
            <Plus size={15} />
            <span>New</span>
          </button>
          {newMenuOpen && (
            <div className="work-dock-new-menu" role="menu" aria-label="Create item">
              <button role="menuitem" onClick={() => createFromDock('task')}><ClipboardList size={14} /> Task</button>
              <button role="menuitem" onClick={() => createFromDock('note')}><FileText size={14} /> Note</button>
              <button role="menuitem" onClick={() => createFromDock('project')}><FolderGit2 size={14} /> Project</button>
            </div>
          )}
        </div>
        <button
          className={filters.privateMode ? 'active' : ''}
          aria-label={filters.privateMode ? privateHiddenLabel : privateVisibleLabel}
          title={privateVisibilityTitle}
          onClick={() => setFilters((current) => ({ ...current, privateMode: !current.privateMode }))}
        >
          {filters.privateMode ? <EyeOff size={15} /> : <Eye size={15} />}
          <span>{filters.privateMode ? 'Hidden' : 'Visible'}</span>
        </button>
        <button aria-label="Cmd" onClick={onOpenPalette}><TerminalSquare size={15} /> <span>Cmd</span></button>
      </div>
    </aside>
  );
}

function WorkbenchView({
  activeView,
  data,
  entries,
  overviewData,
  scholar,
  overviewFocus,
  loading,
  error,
  privateMode,
  filters,
  setFilters,
  taskProjects,
  typeGroups,
  domainGroups,
  collectionGroups,
  entryProjectGroups,
  noteRoleGroups,
  onOpen,
  onOpenProject,
  onCreate,
  onOpenPalette,
  onOpenView,
  syncCommandRequest,
  onReloadVault,
  selectedProjectPath,
  onPatchTaskMetadata,
  patchingTaskPath,
  onQuickLook,
  onSelectType,
  onSelectDomain,
  onSelectCollection,
  onSelectNoteRole,
}: {
  activeView: AppView;
  data: WorkbenchData;
  entries: VaultEntry[];
  overviewData: OverviewData;
  scholar: ScholarStats | null;
  overviewFocus: string;
  loading: boolean;
  error: string;
  privateMode: boolean;
  filters: EntryFilters;
  setFilters: (next: EntryFilters | ((current: EntryFilters) => EntryFilters)) => void;
  taskProjects: string[];
  typeGroups: Array<{ lens: string; count: number }>;
  domainGroups: Array<{ lens: string; count: number }>;
  collectionGroups: Array<{ lens: string; count: number }>;
  entryProjectGroups: Array<{ lens: string; count: number }>;
  noteRoleGroups: Array<{ lens: string; count: number }>;
  onOpen: (path: string) => void;
  onOpenProject: (path: string) => void;
  onCreate: (kind: string) => void;
  onOpenPalette: () => void;
  onOpenView: (view: AppView) => void;
  syncCommandRequest: SyncCommandRequest;
  onReloadVault: () => Promise<void> | void;
  selectedProjectPath: string;
  onPatchTaskMetadata: (path: string, updates: TaskMetadataUpdates, currentModifiedAt?: number) => Promise<void> | void;
  patchingTaskPath: string;
  onQuickLook: (path: string) => void;
  onSelectType: (lens: string) => void;
  onSelectDomain: (domain: string) => void;
  onSelectCollection: (collection: string) => void;
  onSelectNoteRole: (noteRole: string) => void;
}) {
  if (activeView === 'open-tasks') {
    return (
      <OpenTasksView
        data={data}
        filters={filters}
        setFilters={setFilters}
        taskProjects={taskProjects}
        onOpen={onOpen}
        onPatchTaskMetadata={onPatchTaskMetadata}
        patchingTaskPath={patchingTaskPath}
      />
    );
  }
  if (activeView === 'codex-backlog') {
    return <CodexBacklogView data={data.codexBacklog} onOpen={onOpen} />;
  }
  if (activeView === 'admin-center') {
    return (
      <AdminCenterView
        data={data.adminCenter}
        onOpen={onOpen}
        onPatchTaskMetadata={onPatchTaskMetadata}
        patchingTaskPath={patchingTaskPath}
      />
    );
  }
  if (activeView === 'performance-evaluation') {
    return (
      <PerformanceEvaluationView
        data={data.performanceEvaluation}
        onOpen={onOpen}
      />
    );
  }
  if (activeView === 'travel-center') {
    return (
      <TravelCenterView
        data={data.travelCenter}
        onOpen={onOpen}
        onPatchTaskMetadata={onPatchTaskMetadata}
        patchingTaskPath={patchingTaskPath}
      />
    );
  }
  if (activeView === 'ra-management') {
    return (
      <RAManagementView
        data={data.raManagement}
        onOpen={onOpen}
        onPatchTaskMetadata={onPatchTaskMetadata}
        patchingTaskPath={patchingTaskPath}
      />
    );
  }
  if (activeView === 'health-review') {
    return (
      <HealthReviewView
        data={data}
        entries={entries}
        privateMode={privateMode}
        onOpen={onOpen}
        onPatchTaskMetadata={onPatchTaskMetadata}
        patchingTaskPath={patchingTaskPath}
      />
    );
  }
  if (activeView === 'sync') {
    return <GitHubSyncView commandRequest={syncCommandRequest} onReloadVault={onReloadVault} />;
  }
  if (activeView === 'projects') {
    return <ProjectsView data={data} onOpenProject={onOpenProject} onOpenMarkdown={onOpen} />;
  }
  if (activeView === 'project-detail') {
    return (
      <ProjectDetailView
        data={data}
        projectPath={selectedProjectPath}
        onOpen={onOpen}
        onOpenProject={onOpenProject}
        onOpenView={onOpenView}
        onPatchTaskMetadata={onPatchTaskMetadata}
        patchingTaskPath={patchingTaskPath}
      />
    );
  }
  if (activeView === 'types') {
    return <TypesView data={data} onOpen={onOpen} onSelectDomain={onSelectDomain} onSelectType={onSelectType} onSelectCollection={onSelectCollection} onSelectNoteRole={onSelectNoteRole} />;
  }
  if (activeView === 'calendar') {
    return <CalendarView data={data} onOpen={onOpen} onPatchTaskMetadata={onPatchTaskMetadata} patchingTaskPath={patchingTaskPath} />;
  }
  if (activeView === 'time-plan') {
    return (
      <Suspense fallback={<PanelLoading label="Loading time plan..." />}>
        <LazyTimePlanView privateMode={privateMode} onOpen={onOpen} onPatchTaskMetadata={onPatchTaskMetadata} />
      </Suspense>
    );
  }
  if (activeView === 'recent') {
    return <RecentView data={data} onOpen={onOpen} onPatchTaskMetadata={onPatchTaskMetadata} patchingTaskPath={patchingTaskPath} />;
  }
  if (activeView === 'library') {
    return (
      <LibraryView
        entries={data.filteredEntries}
        selectedPath=""
        filters={filters}
        setFilters={setFilters}
        taskProjects={taskProjects}
        typeGroups={typeGroups}
        domainGroups={domainGroups}
        collectionGroups={collectionGroups}
        entryProjectGroups={entryProjectGroups}
        noteRoleGroups={noteRoleGroups}
        onSelect={onOpen}
        onQuickLook={onQuickLook}
        onPatchTaskMetadata={onPatchTaskMetadata}
        patchingTaskPath={patchingTaskPath}
      />
    );
  }
  return (
    <Overview
      data={overviewData}
      travelStrip={data.travelCenter.calendarItems}
      adminCenter={data.adminCenter}
      performanceEvaluation={data.performanceEvaluation}
      scholar={scholar}
      focus={overviewFocus}
      loading={loading}
      error={error}
      privateMode={privateMode}
      onOpen={onOpen}
      onOpenProject={onOpenProject}
      onCreate={onCreate}
      onOpenPalette={onOpenPalette}
      onOpenView={onOpenView}
      onPatchTaskMetadata={onPatchTaskMetadata}
      patchingTaskPath={patchingTaskPath}
    />
  );
}

export function GitHubSyncView({
  commandRequest,
  onReloadVault,
}: {
  commandRequest?: SyncCommandRequest;
  onReloadVault?: () => Promise<void> | void;
}) {
  const [status, setStatus] = useState<GitHubSyncStatus | null>(null);
  const [diagnostics, setDiagnostics] = useState<AppDiagnostics | null>(null);
  const [lastResult, setLastResult] = useState<GitHubSyncResult | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [action, setAction] = useState('');
  const [pushDryRunReady, setPushDryRunReady] = useState(false);
  const [resetDryRunReady, setResetDryRunReady] = useState(false);
  const [deleteMissing, setDeleteMissing] = useState(false);
  const [deleteExtra, setDeleteExtra] = useState(false);
  const [commitMessage, setCommitMessage] = useState(`Sync hosted vault ${todayIso()}`);

  const busy = loading || Boolean(action);
  const unavailable = !status?.enabled || !status?.configured || !status?.token_configured || !status?.git_available;
  const statusMeta = status
    ? `${status.remote || status.repo || 'remote not set'} · ${status.branch || 'branch not set'} · ${status.vault_file_count} vault files`
    : 'Hosted GitHub status has not loaded yet.';

  const refreshStatus = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [nextStatus, nextDiagnostics] = await Promise.all([
        getGitHubSyncStatus(),
        getDiagnostics(),
      ]);
      setStatus(nextStatus);
      setDiagnostics(nextDiagnostics);
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : 'Could not load GitHub sync status');
    } finally {
      setLoading(false);
    }
  }, []);

  const runPush = useCallback(async (dryRun: boolean) => {
    setAction(dryRun ? 'push-dry-run' : 'push');
    setError('');
    try {
      const result = await pushGitHubSync({
        commitMessage,
        dryRun,
        deleteMissing,
      });
      setLastResult({ kind: 'push', result });
      if (dryRun && result.ok) setPushDryRunReady(true);
      if (!dryRun) {
        setPushDryRunReady(false);
        await refreshStatus();
      }
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : dryRun ? 'Push dry-run failed' : 'Push failed');
    } finally {
      setAction('');
    }
  }, [commitMessage, deleteMissing, refreshStatus]);

  const runReset = useCallback(async (dryRun: boolean) => {
    setAction(dryRun ? 'pull-dry-run' : 'pull');
    setError('');
    try {
      const result = await resetGitHubSync({
        dryRun,
        backup: true,
        deleteExtra,
      });
      setLastResult({ kind: 'reset', result });
      if (dryRun && result.ok) setResetDryRunReady(true);
      if (!dryRun) {
        setResetDryRunReady(false);
        await onReloadVault?.();
        await refreshStatus();
      }
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : dryRun ? 'Pull dry-run failed' : 'Pull from GitHub failed');
    } finally {
      setAction('');
    }
  }, [deleteExtra, onReloadVault, refreshStatus]);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  useEffect(() => {
    if (!commandRequest) return;
    if (commandRequest.action === 'status') void refreshStatus();
    if (commandRequest.action === 'push-dry-run') void runPush(true);
  }, [commandRequest?.id]);

  return (
    <section className="work-view github-sync-view">
      <ViewHeader
        eyebrow="Hosted vault sync"
        title="Sync"
        meta={statusMeta}
        actions={(
          <button type="button" onClick={() => void refreshStatus()} disabled={busy}>
            <RefreshCcw size={14} /> {loading ? 'Refreshing' : 'Refresh'}
          </button>
        )}
      />

      {error && <div className="sync-alert error"><X size={16} /> <span>{error}</span></div>}
      {status?.errors?.length ? (
        <div className="sync-alert warning">
          <Shield size={16} />
          <span>{status.errors.join(' ')}</span>
        </div>
      ) : null}

      <div className="sync-metric-grid" aria-label="GitHub sync status">
        <ProjectMetric label="Enabled" value={boolLabel(status?.enabled)} />
        <ProjectMetric label="Configured" value={boolLabel(status?.configured)} />
        <ProjectMetric label="Token" value={status?.token_configured ? 'configured' : 'missing'} />
        <ProjectMetric label="Git" value={status?.git_available ? 'available' : 'missing'} />
        <ProjectMetric label="Remote head" value={shortSha(status?.remote_head)} />
        <ProjectMetric label="Vault files" value={String(status?.vault_file_count ?? '-')} />
        <ProjectMetric label="Latest CI" value={actionsLabel(status)} />
      </div>

      <div className="sync-grid">
        <DiagnosticsPanel diagnostics={diagnostics} status={status} />

        <section className="zone-blue project-work-panel sync-control-panel">
          <ProjectSectionTitle title="Push hosted vault" meta="Instance → GitHub" icon={<GitBranch size={15} />} />
          <p className="muted">
            Preview hosted Markdown/vault-owned changes before creating a GitHub commit. Private folders and generated dashboard/data files stay excluded.
          </p>
          <label className="sync-input">
            <span>Commit message</span>
            <input value={commitMessage} onChange={(event) => setCommitMessage(event.target.value)} />
          </label>
          <div className="sync-action-row">
            <button type="button" onClick={() => void runPush(true)} disabled={busy || unavailable}>
              <RefreshCcw size={14} /> {action === 'push-dry-run' ? 'Checking' : 'Push dry-run'}
            </button>
            <button type="button" className="primary" onClick={() => void runPush(false)} disabled={busy || unavailable || !pushDryRunReady}>
              <GitBranch size={14} /> {action === 'push' ? 'Pushing' : 'Push to GitHub'}
            </button>
          </div>
          <p className="sync-safety-note">
            Real push is enabled only after a successful push dry-run in this browser session.
          </p>
        </section>

        <section className="zone-accent project-work-panel sync-control-panel">
          <ProjectSectionTitle title="Pull from GitHub" meta="GitHub → instance" icon={<RefreshCcw size={15} />} />
          <p className="muted">
            Preview remote differences first. A real pull writes a backup under `.backups/` before copying remote files into the hosted vault.
          </p>
          <div className="sync-action-row">
            <button type="button" onClick={() => void runReset(true)} disabled={busy || unavailable}>
              <RefreshCcw size={14} /> {action === 'pull-dry-run' ? 'Checking' : 'Pull dry-run'}
            </button>
            <button type="button" className="primary" onClick={() => void runReset(false)} disabled={busy || unavailable || !resetDryRunReady}>
              <GitBranch size={14} /> {action === 'pull' ? 'Pulling' : 'Pull with backup'}
            </button>
          </div>
          <p className="sync-safety-note">
            Real pull is enabled only after a successful pull dry-run in this browser session.
          </p>
        </section>

        <section className="zone-neutral project-work-panel sync-detail-panel">
          <ProjectSectionTitle title="Connection" meta="server-side only" icon={<Shield size={15} />} />
          <dl className="sync-definition-list">
            <dt>Repo</dt><dd>{status?.repo || '-'}</dd>
            <dt>Branch</dt><dd>{status?.branch || '-'}</dd>
            <dt>Remote</dt><dd>{status?.remote || '-'}</dd>
            <dt>Vault</dt><dd>{status?.vault_root || '-'}</dd>
            <dt>Author</dt><dd>{status ? `${status.author_name} <${status.author_email}>` : '-'}</dd>
          </dl>
          <details className="sync-advanced">
            <summary>Advanced deletion options</summary>
            <label>
              <input type="checkbox" checked={deleteMissing} onChange={(event) => setDeleteMissing(event.target.checked)} />
              Allow push to delete GitHub files missing from hosted vault
            </label>
            <label>
              <input type="checkbox" checked={deleteExtra} onChange={(event) => setDeleteExtra(event.target.checked)} />
              Allow pull to delete hosted files missing from GitHub
            </label>
          </details>
        </section>

        <GitHubActionsPanel status={status} />

        <section className="zone-good project-work-panel sync-result-panel">
          <ProjectSectionTitle title="Latest result" meta={lastResult ? resultTitle(lastResult) : 'no sync action yet'} icon={<Check size={15} />} />
          {lastResult ? <GitHubSyncResultView result={lastResult} /> : <p className="muted">Run a dry-run to inspect what would change.</p>}
        </section>
      </div>
    </section>
  );
}

function DiagnosticsPanel({ diagnostics, status }: { diagnostics: AppDiagnostics | null; status: GitHubSyncStatus | null }) {
  const cache = diagnostics?.generated_cache;
  const latestAction = diagnostics?.actions.latest || status?.actions?.latest || null;
  const staleFiles = cache?.files.filter((file) => !file.fresh) || [];
  const hosted = diagnostics?.hosted_service;
  const hostedLabel = hosted ? (hosted.configured ? (hosted.ok ? 'online' : 'down') : 'not configured') : '-';
  const seed = diagnostics?.seed;
  const seedLabel = seed ? (seed.exists ? (seed.error ? 'manifest error' : seed.mode || 'seeded') : 'no manifest') : '-';
  return (
    <section className="zone-warn project-work-panel sync-detail-panel">
      <ProjectSectionTitle title="Diagnostics" meta={cache ? (cache.fresh ? 'generated cache fresh' : `${staleFiles.length} stale generated files`) : 'loading'} icon={<SlidersHorizontal size={15} />} />
      <div className="sync-result-summary">
        <ProjectMetric label="Deploy commit" value={shortSha(diagnostics?.app_commit ?? undefined)} />
        <ProjectMetric label="Vault hash" value={shortSha(diagnostics?.vault_hash.value)} />
        <ProjectMetric label="Entries" value={String(diagnostics?.entry_counts?.entries ?? '-')} />
        <ProjectMetric label="Tasks" value={String(diagnostics?.entry_counts?.tasks ?? '-')} />
        <ProjectMetric label="Projects" value={String(diagnostics?.entry_counts?.projects ?? '-')} />
        <ProjectMetric label="Cache" value={cache ? (cache.fresh ? 'fresh' : 'stale') : '-'} />
        <ProjectMetric label="Seed" value={seedLabel} />
        <ProjectMetric label="Hosted" value={hostedLabel} />
        <ProjectMetric label="Actions" value={latestAction ? (latestAction.conclusion || latestAction.status || 'unknown') : actionsLabel(status)} />
      </div>
      <dl className="sync-definition-list">
        <dt>Vault root</dt><dd>{diagnostics?.vault_root || status?.vault_root || '-'}</dd>
        <dt>Vault files</dt><dd>{String(diagnostics?.vault_hash.file_count ?? status?.vault_file_count ?? '-')}</dd>
        <dt>Last vault scan</dt><dd>{diagnostics?.last_vault_scan_at || '-'}</dd>
        <dt>Last Markdown save</dt><dd>{diagnostics?.last_markdown_save_at || '-'}</dd>
        <dt>Seed manifest</dt><dd>{seed?.exists ? `${seed.generated_at || 'unknown time'} · ${seed.seed_source || 'unknown source'}` : seed?.path || '-'}</dd>
        <dt>Seed commit</dt><dd>{shortSha(seed?.app_commit ?? undefined)}</dd>
        <dt>Remote head</dt><dd>{shortSha(diagnostics?.github_sync.remote_head || status?.remote_head)}</dd>
        <dt>GitHub branch</dt><dd>{diagnostics?.github_sync.branch || status?.branch || '-'}</dd>
        <dt>Latest Actions SHA</dt><dd>{shortSha(latestAction?.head_sha)}</dd>
        <dt>Hosted URL</dt><dd>{hosted?.url || '-'}</dd>
        <dt>Hosted status</dt><dd>{hosted?.configured ? `${hosted.status_code || 'no HTTP status'} · ${hosted.error || (hosted.ok ? 'ok' : 'not ok')}` : hosted?.error || '-'}</dd>
        <dt>Hosted last success</dt><dd>{hosted?.last_success_at || '-'}</dd>
      </dl>
      {staleFiles.length ? (
        <SyncFileList title="Stale generated cache files" values={staleFiles.map((file) => file.path)} />
      ) : null}
      {diagnostics?.github_sync.errors.length ? <p className="sync-safety-note">{diagnostics.github_sync.errors.join(' ')}</p> : null}
      {diagnostics?.actions.errors.length ? <p className="sync-safety-note">{diagnostics.actions.errors.join(' ')}</p> : null}
      {seed?.error ? <p className="sync-safety-note">{seed.error}</p> : null}
    </section>
  );
}

function GitHubActionsPanel({ status }: { status: GitHubSyncStatus | null }) {
  const actions = status?.actions;
  const latest = actions?.latest;
  const errors = actions?.errors || [];
  const runTitle = latest ? latest.workflow_name || latest.name || 'Latest workflow run' : 'No run loaded';
  const runState = latest ? latest.conclusion || latest.status || 'unknown' : '-';
  const meta = !actions
    ? 'status not loaded'
    : actions.configured
      ? `${actions.branch || 'branch'} · ${actions.runs.length} recent`
      : actions.token_configured
        ? 'repo not configured'
        : 'token missing';
  return (
    <section className="zone-blue project-work-panel sync-detail-panel">
      <ProjectSectionTitle title="GitHub Actions" meta={meta} icon={<FolderGit2 size={15} />} />
      {latest ? (
        <div className="sync-ci-card">
          <div>
            <span className={`sync-ci-state ${ciTone(runState)}`}>{runState}</span>
            <strong>{runTitle}</strong>
          </div>
          <dl className="sync-definition-list">
            <dt>Event</dt><dd>{latest.event || '-'}</dd>
            <dt>Head</dt><dd>{shortSha(latest.head_sha)}</dd>
            <dt>Updated</dt><dd>{latest.updated_at || '-'}</dd>
          </dl>
          {latest.html_url && (
            <a href={latest.html_url} target="_blank" rel="noreferrer" className="button-link">
              Open Actions run
            </a>
          )}
        </div>
      ) : (
        <p className="muted">No workflow run is available from the server-side GitHub status check.</p>
      )}
      {errors.length ? <p className="sync-safety-note">{errors.join(' ')}</p> : null}
    </section>
  );
}

function GitHubSyncResultView({ result }: { result: GitHubSyncResult }) {
  if (result.kind === 'push') {
    const push = result.result;
    return (
      <div className="sync-result-body">
        <div className="sync-result-summary">
          <ProjectMetric label="Changed" value={String(push.changed.length)} />
          <ProjectMetric label="Copied" value={String(push.copied)} />
          <ProjectMetric label="Deleted" value={String(push.deleted)} />
          <ProjectMetric label="Missing from vault" value={String(push.missing_from_vault.length)} />
        </div>
        {push.head && <p className="sync-safety-note">Pushed commit `{shortSha(push.head)}`.</p>}
        <SyncFileList title="Changed files" values={push.changed.map((change) => `${change.status || '?'} ${change.path}`)} />
        <SyncFileList title="GitHub files missing from hosted vault" values={push.missing_from_vault} />
      </div>
    );
  }
  const reset = result.result;
  return (
    <div className="sync-result-body">
      <div className="sync-result-summary">
        <ProjectMetric label="Missing locally" value={String(reset.missing.length)} />
        <ProjectMetric label="Changed" value={String(reset.changed.length)} />
        <ProjectMetric label="Extra locally" value={String(reset.extra.length)} />
        <ProjectMetric label="Copied" value={String(reset.copied)} />
      </div>
      {reset.backup && <p className="sync-safety-note">Backup written to `{reset.backup}`.</p>}
      <SyncFileList title="Missing locally" values={reset.missing} />
      <SyncFileList title="Changed locally" values={reset.changed} />
      <SyncFileList title="Extra local files" values={reset.extra} />
    </div>
  );
}

function SyncFileList({ title, values }: { title: string; values: string[] }) {
  if (!values.length) return null;
  return (
    <details className="sync-file-list">
      <summary>{title} · {values.length}</summary>
      <div>
        {values.slice(0, 24).map((value) => <code key={value}>{value}</code>)}
        {values.length > 24 && <span className="muted">+{values.length - 24} more</span>}
      </div>
    </details>
  );
}

function boolLabel(value: boolean | undefined): string {
  if (value === undefined) return '-';
  return value ? 'yes' : 'no';
}

function actionsLabel(status: GitHubSyncStatus | null): string {
  const actions = status?.actions;
  if (!actions) return '-';
  if (!actions.configured) return actions.token_configured ? 'not configured' : 'token missing';
  const latest = actions.latest;
  if (!latest) return actions.errors.length ? 'error' : 'no run';
  return latest.conclusion || latest.status || 'unknown';
}

function ciTone(value: string): string {
  const normalized = value.toLowerCase();
  if (normalized === 'success') return 'success';
  if (['failure', 'cancelled', 'timed_out', 'action_required'].includes(normalized)) return 'failure';
  if (['queued', 'requested', 'waiting', 'in_progress', 'pending'].includes(normalized)) return 'running';
  return 'unknown';
}

function shortSha(value: string | undefined): string {
  return value ? value.slice(0, 8) : '-';
}

function resultTitle(result: GitHubSyncResult): string {
  if (result.kind === 'push') return result.result.dry_run ? 'push dry-run' : result.result.pushed ? 'pushed' : 'push result';
  return result.result.dry_run ? 'pull dry-run' : 'pull result';
}

function ViewHeader({ eyebrow, title, meta, actions }: { eyebrow: string; title: string; meta: string; actions?: ReactNode }) {
  return (
    <header className="view-header">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{meta}</p>
      </div>
      {actions && <div className="header-actions">{actions}</div>}
    </header>
  );
}

const CODEX_LANE_TONE: Record<string, { zone: string; icon: ReactNode }> = {
  queued: { zone: 'zone-blue', icon: <ClipboardList size={15} /> },
  blocked: { zone: 'zone-danger', icon: <Shield size={15} /> },
  processed: { zone: 'zone-good', icon: <Check size={15} /> },
  cancelled: { zone: 'zone-neutral', icon: <X size={15} /> },
};

export function CodexBacklogView({ data, onOpen }: { data: CodexBacklogData; onOpen: (path: string) => void }) {
  return (
    <section className="work-view codex-backlog-view">
      <ViewHeader
        eyebrow="AI workflow"
        title="Codex Backlog"
        meta={`${data.counts.queued} queued · ${data.counts.blocked} blocked · ${data.total} total task-local instructions`}
      />
      <div className="codex-metric-grid" aria-label="Codex backlog summary">
        <ProjectMetric label="Queued" value={String(data.counts.queued)} />
        <ProjectMetric label="Blocked" value={String(data.counts.blocked)} />
        <ProjectMetric label="Processed" value={String(data.counts.processed)} />
        <ProjectMetric label="Cancelled" value={String(data.counts.cancelled)} />
      </div>
      <p className="privacy-note">
        These are manual, inspectable task-local requests. Sync moves the Markdown; it does not automatically run queued instructions.
      </p>
      <div className="codex-backlog-lanes">
        {data.lanes.map((lane) => {
          const tone = CODEX_LANE_TONE[lane.status] ?? { zone: 'zone-neutral', icon: <Bot size={15} /> };
          return (
          <section className={`zone-card ${tone.zone} codex-backlog-lane instruction-${lane.status}`} key={lane.status}>
            <TriageLaneTitle title={lane.label} detail={lane.description} count={lane.items.length} icon={tone.icon} />
            {lane.items.length === 0 ? (
              <p className="muted">No {lane.label.toLowerCase()} instructions.</p>
            ) : (
              <div className="codex-backlog-list">
                {lane.items.map((item) => (
                  <button
                    type="button"
                    key={`${item.task.path}:${item.line || item.date || item.text}`}
                    className={`codex-backlog-card ${entryToneClass(item.task)}`}
                    onClick={() => onOpen(item.task.path)}
                  >
                    <span className="codex-backlog-card-meta">
                      {item.date || 'undated'}
                      {item.task.project ? ` · ${item.task.project}` : ''}
                    </span>
                    <strong>{item.task.title}</strong>
                    <span>{item.text}</span>
                  </button>
                ))}
              </div>
            )}
          </section>
          );
        })}
      </div>
    </section>
  );
}

function PanelLoading({ label }: { label: string }) {
  return (
    <div className="empty-state">
      <Clock3 size={22} />
      <p>{label}</p>
    </div>
  );
}

export function Overview({
  data,
  travelStrip = [],
  adminCenter,
  performanceEvaluation,
  scholar,
  focus,
  loading,
  error,
  privateMode,
  onOpen,
  onOpenProject,
  onCreate,
  onOpenPalette,
  onOpenView,
  onPatchTaskMetadata,
  patchingTaskPath,
}: {
  data: OverviewData;
  travelStrip?: VaultEntry[];
  adminCenter: AdminCenterData;
  performanceEvaluation: PerformanceEvaluationData;
  scholar: ScholarStats | null;
  focus: string;
  loading: boolean;
  error: string;
  privateMode: boolean;
  onOpen: (path: string) => void;
  onOpenProject: (path: string) => void;
  onCreate: (kind: string) => void;
  onOpenPalette: () => void;
  onOpenView: (view: AppView) => void;
  onPatchTaskMetadata: (path: string, updates: TaskMetadataUpdates, currentModifiedAt?: number) => Promise<void> | void;
  patchingTaskPath: string;
}) {
  useEffect(() => {
    if (focus === 'overview') return;
    document.getElementById(focus)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [focus]);

  const researchTasks = data.taskGroups.find((group) => group.key === 'research');
  const otherTasks = data.taskGroups.find((group) => group.key === 'other');
  const totalWaiting = data.taskGroups.reduce((sum, group) => sum + group.waiting.length, 0);
  const hasOutstandingSubmissions = monitoredSubmissions(data.submissions).length > 0;
  const hasOutstandingReferee = outstandingRefereeReports(data.refereeReports).length > 0;
  const hasSideColumn = data.upcomingDeadlines.length > 0 || hasOutstandingSubmissions || hasOutstandingReferee || Boolean(scholar?.available);
  const focusPaths = new Set(data.mustNotSlip.map((entry) => entry.path));
  const hardDeadlines = data.openTasks
    .filter((entry) => !focusPaths.has(entry.path) && isHardDeadline(entry) && !isConferenceSubmissionDeadline(entry))
    .sort((a, b) => {
      const dueDiff = (daysUntil(a.due || a.date || a.start_date) ?? 9999) - (daysUntil(b.due || b.date || b.start_date) ?? 9999);
      if (dueDiff !== 0) return dueDiff;
      return a.title.localeCompare(b.title);
    });

  return (
    <section className="overview-shell work-view" aria-label="Overview command center">
      <header className="overview-command-header" id="overview">
        <div>
          <span className="eyebrow">Triage desk</span>
          <h1>Today</h1>
          <p>
            {loading ? 'Loading vault...' : `${researchTasks?.totalCount || 0} research · ${otherTasks?.totalCount || 0} other · ${data.coauthorTasks.length} coauthor · ${totalWaiting} waiting`}
            {privateMode ? ` · ${privateHiddenLabel}` : ` · ${privateVisibleLabel}`}
          </p>
          {error && <p className="error">{error}</p>}
        </div>
        <div className="overview-command-actions">
          <button onClick={onOpenPalette}><TerminalSquare size={15} /> Cmd-K</button>
          <button onClick={() => onCreate('task')}><Plus size={15} /> Task</button>
          <button onClick={() => onCreate('note')}><Plus size={15} /> Note</button>
        </div>
      </header>

      <ProjectPulsePanel pulse={data.projectPulse} onOpen={onOpen} />

      <OverviewActivityHeatmap data={data.activityHeatmap} recentEntries={data.recentActivity.slice(0, 3)} onOpen={onOpen} />

      {travelStrip.length > 0 && (
        <TravelCalendarStrip entries={travelStrip} onOpen={onOpen} title="Upcoming travel" meta="Conferences & seminars, next 3 months" />
      )}

      <AvailabilityCalendar entries={data.visibleEntries} />

      <div className={`overview-body${hasSideColumn ? '' : ' overview-body-single'}`}>
        <div className="overview-col overview-col-main">
          <OverviewFocusSection
            entries={data.mustNotSlip}
            onOpen={onOpen}
            onPatch={onPatchTaskMetadata}
            patchingTaskPath={patchingTaskPath}
          />

          <OverviewDecisionStrip
            data={data}
            adminCenter={adminCenter}
            hardDeadlines={hardDeadlines}
            onOpen={onOpen}
            onOpenView={onOpenView}
          />

          <OverviewWorkQueue
            data={data}
            focusPaths={focusPaths}
            onOpen={onOpen}
            onOpenProject={onOpenProject}
            onOpenView={onOpenView}
            onPatch={onPatchTaskMetadata}
            patchingTaskPath={patchingTaskPath}
          />
        </div>

        {hasSideColumn && (
          <div className="overview-col overview-col-side">
            <SubmissionsPanel submissions={data.submissions} onOpen={onOpen} />
            <RefereeReportsPanel reports={data.refereeReports} onOpen={onOpen} />
            <OverviewDeadlineRail entries={data.upcomingDeadlines} onOpen={onOpen} />
            <OverviewScholarCard scholar={scholar} />
          </div>
        )}
      </div>
    </section>
  );
}

export function activityDayCountForWidth(width: number, totalDays: number): number {
  if (totalDays <= 0) return 0;
  if (!Number.isFinite(width) || width <= 0) return Math.min(totalDays, 56);
  const cellWidth = 4;
  const cellGap = 2;
  const fit = Math.floor((width + cellGap) / (cellWidth + cellGap)) - 1;
  const minimum = Math.min(totalDays, 14);
  return Math.max(minimum, Math.min(totalDays, fit));
}

function OverviewDecisionStrip({
  data,
  adminCenter,
  hardDeadlines,
  onOpen,
  onOpenView,
}: {
  data: OverviewData;
  adminCenter: AdminCenterData;
  hardDeadlines: VaultEntry[];
  onOpen: (path: string) => void;
  onOpenView: (view: AppView) => void;
}) {
  const nextTrip = data.travelSummary.nextTrip;
  const nextHard = hardDeadlines[0];
  const researchCount = data.taskGroups.find((group) => group.key === 'research')?.totalCount || 0;
  const otherCount = data.taskGroups.find((group) => group.key === 'other')?.totalCount || 0;
  return (
    <section className="overview-zone zone-plan overview-decision-section" aria-label="Planning shortcuts">
      <div className="overview-zone-head">
        <span className="zone-icon" aria-hidden="true"><SlidersHorizontal size={15} /></span>
        <div className="triage-lane-title-text">
          <h2>Jump to</h2>
          <span>Planning shortcuts across travel, calendar, time, and admin</span>
        </div>
      </div>
      <div className="overview-decision-strip">
      <OverviewDecisionButton
        tone="travel"
        icon={<Plane size={14} />}
        label="Travel"
        title={nextTrip ? nextTrip.title : 'No upcoming trip'}
        detail={nextTrip ? `${travelDateLabel(nextTrip)} · ${data.travelSummary.approvalNeeded} approvals` : 'Travel planning is clear'}
        onClick={() => onOpenView('travel-center')}
      />
      <OverviewDecisionButton
        tone="deadline"
        icon={<CalendarDays size={14} />}
        label="Calendar"
        title={nextHard ? nextHard.title : 'No hard deadline queued'}
        detail={nextHard ? `${dueLabel(nextHard, 'relative')} · ${hardDeadlines.length} outside focus` : `${data.upcomingDates.length} dated items`}
        onClick={() => nextHard ? onOpen(nextHard.path) : onOpenView('calendar')}
      />
      <OverviewDecisionButton
        tone="time"
        icon={<Clock3 size={14} />}
        label="Time Plan"
        title={`${researchCount} research · ${otherCount} admin/other`}
        detail={`${data.taskGroups.reduce((sum, group) => sum + group.waiting.length, 0)} waiting · build allocation`}
        onClick={() => onOpenView('time-plan')}
      />
      <OverviewDecisionButton
        tone="admin"
        icon={<SlidersHorizontal size={14} />}
        label="Admin risk"
        title={`${adminCenter.metrics.urgent} urgent · ${adminCenter.metrics.waiting} waiting`}
        detail={`${data.openTasks.length} open tasks · ${data.projectReview.length} projects`}
        onClick={() => onOpenView('admin-center')}
      />
      </div>
    </section>
  );
}

function OverviewDecisionButton({
  tone,
  icon,
  label,
  title,
  detail,
  onClick,
}: {
  tone: 'travel' | 'deadline' | 'time' | 'admin';
  icon: ReactNode;
  label: string;
  title: string;
  detail: string;
  onClick: () => void;
}) {
  return (
    <button className={`overview-decision-button ${tone}`} type="button" onClick={onClick}>
      <span className="overview-decision-label">{icon}{label}</span>
      <strong>{title}</strong>
      <small>{detail}</small>
    </button>
  );
}

type OverviewWorkQueueTab = 'research' | 'other' | 'waiting' | 'coauthor' | 'later';

function OverviewWorkQueue({
  data,
  focusPaths,
  onOpen,
  onOpenProject,
  onOpenView,
  onPatch,
  patchingTaskPath,
}: {
  data: OverviewData;
  focusPaths: Set<string>;
  onOpen: (path: string) => void;
  onOpenProject: (path: string) => void;
  onOpenView: (view: AppView) => void;
  onPatch: (path: string, updates: TaskMetadataUpdates, currentModifiedAt?: number) => Promise<void> | void;
  patchingTaskPath: string;
}) {
  const [activeTab, setActiveTab] = useState<OverviewWorkQueueTab>('research');
  const researchGroup = data.taskGroups.find((group) => group.key === 'research');
  const otherGroup = data.taskGroups.find((group) => group.key === 'other');
  const tabEntries = (group?: OverviewTaskGroup) => uniqueEntries([...(group?.now || []), ...(group?.next || [])]).filter((entry) => !focusPaths.has(entry.path));
  const waitingEntries = uniqueEntries(data.taskGroups.flatMap((group) => group.waiting)).filter((entry) => !focusPaths.has(entry.path));
  const researchAnchor = tabEntries(researchGroup)[0] || researchGroup?.waiting.find((entry) => !focusPaths.has(entry.path)) || null;
  const hardDeadlineEntries = data.openTasks
    .filter((entry) => !focusPaths.has(entry.path) && isHardDeadline(entry))
    .sort((a, b) => (daysUntil(a.due || a.date || a.start_date) ?? 9999) - (daysUntil(b.due || b.date || b.start_date) ?? 9999));
  const adminBottleneck = (otherGroup?.waiting.find((entry) => !focusPaths.has(entry.path)) || tabEntries(otherGroup)[0] || null);
  const coauthorWaiting = data.coauthorTasks.find((entry) => !focusPaths.has(entry.path)) || waitingEntries[0] || null;
  const laterEntries = uniqueEntries(data.upcomingDates.filter((entry) => isTask(entry))).filter((entry) => !focusPaths.has(entry.path));
  const tabs: Array<{ key: OverviewWorkQueueTab; label: string; detail: string; entries: VaultEntry[]; total: number }> = [
    { key: 'research', label: 'Research', detail: 'Papers, models, slides, writing', entries: tabEntries(researchGroup), total: researchGroup?.totalCount || 0 },
    { key: 'other', label: 'Admin', detail: 'Admin, travel-adjacent, personal/process work', entries: tabEntries(otherGroup), total: otherGroup?.totalCount || 0 },
    { key: 'waiting', label: 'Waiting', detail: 'Blocked or externally owned', entries: waitingEntries, total: waitingEntries.length },
    { key: 'coauthor', label: 'Coauthor', detail: 'Assigned out or waiting on collaborators', entries: data.coauthorTasks.filter((entry) => !focusPaths.has(entry.path)), total: data.coauthorTasks.length },
    { key: 'later', label: 'Later', detail: 'Dated items not already surfaced', entries: laterEntries, total: laterEntries.length },
  ];
  const current = tabs.find((tab) => tab.key === activeTab) || tabs[0];
  const visibleEntries = current.entries.slice(0, 6);
  const hiddenCount = Math.max(0, current.total - visibleEntries.length);
  return (
    <section className="overview-zone zone-queue overview-work-queue" id="work-queue" aria-label="Work Queue" data-testid="overview-work-queue">
      <div className="overview-work-queue-header">
        <span className="zone-icon" aria-hidden="true"><Layers size={15} /></span>
        <div className="triage-lane-title-text">
          <h2>Work Queue</h2>
          <span>One queue, filtered by what kind of work it is.</span>
        </div>
        <button type="button" onClick={() => onOpenView('open-tasks')}>Open Tasks</button>
      </div>
      <div className="overview-work-summary" aria-label="Cross-lane work summary">
        <OverviewWorkSummaryButton
          label="Research anchor"
          count={researchGroup?.totalCount || 0}
          entry={researchAnchor}
          empty="No research anchor"
          onOpen={onOpen}
        />
        <OverviewWorkSummaryButton
          label="Hard deadlines"
          count={hardDeadlineEntries.length}
          entry={hardDeadlineEntries[0] || null}
          empty="No hard deadline outside focus"
          onOpen={onOpen}
        />
        <OverviewWorkSummaryButton
          label="Admin bottleneck"
          count={(otherGroup?.waiting.length || 0) + tabEntries(otherGroup).length}
          entry={adminBottleneck}
          empty="No admin bottleneck"
          onOpen={onOpen}
        />
        <OverviewWorkSummaryButton
          label="Waiting on others"
          count={waitingEntries.length + data.coauthorTasks.filter((entry) => !focusPaths.has(entry.path)).length}
          entry={coauthorWaiting}
          empty="No external wait"
          onOpen={onOpen}
        />
      </div>
      <details className="overview-work-queue-details">
        <summary>
          <div>
            <strong>Queue tabs</strong>
            <span>Research, admin, waiting, coauthor, and later work</span>
          </div>
          <span className="lane-summary-meta">
            <b>{data.openTasks.length}</b>
            <ChevronRight size={13} aria-hidden="true" />
          </span>
        </summary>
        <div className="overview-work-tabs" role="tablist" aria-label="Work queue filters">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.key}
              className={activeTab === tab.key ? 'active' : ''}
              onClick={() => setActiveTab(tab.key)}
            >
              <strong>{tab.label}</strong>
              <span>{tab.total}</span>
            </button>
          ))}
        </div>
        <div className="overview-work-panel" role="tabpanel">
          <div className="triage-lane-title">
            <div>
              <h2>{current.label}</h2>
              <span>{current.detail}</span>
            </div>
            <b>{current.total}</b>
          </div>
          <div className="triage-list">
            {visibleEntries.length === 0 ? <p className="muted">No items in this queue.</p> : visibleEntries.map((entry) => (
              <OverviewRow key={entry.path} entry={entry} onOpen={onOpen} onPatch={onPatch} disabled={patchingTaskPath === entry.path} />
            ))}
            {hiddenCount > 0 && (
              <button type="button" className="overview-work-more" onClick={() => onOpenView('open-tasks')}>
                {hiddenCount} more in Open Tasks
              </button>
            )}
          </div>
        </div>
        <details className="overview-task-lane overview-task-lane-collapsible overview-review-group" id="project-review">
          <summary className="triage-lane-title">
            <div>
              <h2>Project review</h2>
              <span>Projects needing attention</span>
            </div>
            <span className="lane-summary-meta">
              <b>{data.triage.review.length}</b>
              <ChevronRight size={13} aria-hidden="true" />
            </span>
          </summary>
          <div className="triage-list">
            {data.triage.review.length === 0 ? <p className="muted">No project review flags.</p> : data.triage.review.map((item) => (
              <OverviewProjectTriageRow key={item.project.path} item={item} onOpen={onOpenProject} />
            ))}
          </div>
        </details>
      </details>
    </section>
  );
}

function OverviewWorkSummaryButton({
  label,
  count,
  entry,
  empty,
  onOpen,
}: {
  label: string;
  count: number;
  entry: VaultEntry | null;
  empty: string;
  onOpen: (path: string) => void;
}) {
  return (
    <button
      type="button"
      className="overview-work-summary-card"
      onClick={() => entry && onOpen(entry.path)}
      disabled={!entry}
    >
      <span>{label}</span>
      <strong>{entry ? entry.title : empty}</strong>
      <small>{entry ? `${dueLabel(entry, 'relative')} · ${entry.project || entryLens(entry)}` : `${count} linked`}</small>
    </button>
  );
}

function OverviewActivityHeatmap({
  data,
  recentEntries = [],
  onOpen,
}: {
  data: OverviewData['activityHeatmap'];
  recentEntries?: VaultEntry[];
  onOpen?: (path: string) => void;
}) {
  const heatmapRef = useRef<HTMLDivElement | null>(null);
  const [visibleDayCount, setVisibleDayCount] = useState(() => Math.min(data.days.length, 56));

  useEffect(() => {
    const node = heatmapRef.current;
    if (!node) return;

    const update = (width: number) => {
      setVisibleDayCount(activityDayCountForWidth(width, data.days.length));
    };

    update(node.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver((entries) => {
      update(entries[0]?.contentRect.width || node.clientWidth);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [data.days.length]);

  const visibleDays = data.days.slice(-visibleDayCount);
  const mostRecent = recentEntries[0];
  return (
    <section className="overview-activity" aria-label="Task activity heatmap">
      <div className="overview-activity-head">
        <span className="overview-activity-label"><Activity size={12} aria-hidden="true" /> Activity</span>
        <span className="overview-activity-counts">
          <b>{data.totalCompleted}</b> cleared · <b>{data.totalEdits}</b> edited · <b>{data.activeDays}</b> active days
          {mostRecent && (
            <>
              {' · '}
              <button type="button" className="overview-activity-recent-link" onClick={() => onOpen?.(mostRecent.path)} title={`Latest: ${mostRecent.title}`}>
                latest: {mostRecent.title}
              </button>
            </>
          )}
        </span>
      </div>
      <div className="overview-activity-heatmap-wrap" ref={heatmapRef} aria-hidden={visibleDays.length === 0}>
        <div
          className="overview-activity-grid"
          role="img"
          aria-label={`Recent activity from ${visibleDays[0]?.date || data.startDate} to ${data.endDate}`}
          data-visible-days={visibleDays.length}
        >
          {visibleDays.map((day) => (
            <span
              key={day.date}
              className={`overview-activity-cell level-${day.level}`}
              title={`${day.date}: ${day.completed} cleared, ${day.edits} edited`}
              aria-label={`${day.date}: ${day.completed} cleared, ${day.edits} edited`}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function moneyLabel(value: number, currency = 'USD'): string {
  if (!value) return '$0';
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    maximumFractionDigits: value >= 100 ? 0 : 2,
  }).format(value);
}

function percentLabel(value: number): string {
  if (!Number.isFinite(value)) return '0%';
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)}%`;
}

function travelDateLabel(trip: Pick<TravelTrip, 'startDate' | 'endDate'>): string {
  if (!trip.startDate) return 'TBD';
  const base = trip.endDate && trip.endDate !== trip.startDate ? `${trip.startDate} to ${trip.endDate}` : trip.startDate;
  const days = daysUntil(trip.startDate);
  if (days === null) return base;
  if (days === 0) return `${base} · today`;
  if (days < 0) return `${base} · ${Math.abs(days)}d ago`;
  return `${base} · in ${days}d`;
}

function OverviewTravelCenterJump({
  summary,
  trackedCount,
  onOpenView,
  onOpen,
}: {
  summary: OverviewData['travelSummary'];
  trackedCount: number;
  onOpenView: (view: AppView) => void;
  onOpen: (path: string) => void;
}) {
  const nextTrip = summary.nextTrip;
  return (
    <section className="overview-travel-panel overview-travel-compact" id="upcoming-travel" aria-label="Travel Center summary">
      <button type="button" className="overview-travel-center-card" onClick={() => onOpenView('travel-center')}>
        <Plane size={17} aria-hidden="true" />
        <div>
          <span className="eyebrow">Travel Center</span>
          <strong>{nextTrip ? nextTrip.title : 'No upcoming travel window'}</strong>
          <small>{nextTrip ? travelDateLabel(nextTrip) : 'Track approvals, bookings, receipts, and reimbursements'}</small>
        </div>
        <div className="overview-travel-center-stats" aria-label="Travel summary">
          <span>{trackedCount} tracked</span>
          <span>{summary.approvalNeeded} approvals</span>
          <span>{summary.reimbursementItems} reimbursements</span>
          <span>{moneyLabel(summary.plannedUsd)} planned</span>
        </div>
        <ChevronRight size={16} aria-hidden="true" />
      </button>
      {summary.urgentBlocker && (
        <button type="button" className="overview-travel-blocker" onClick={() => onOpen(summary.urgentBlocker?.path || '')}>
          <span>Travel blocker</span>
          <strong>{summary.urgentBlocker.title}</strong>
          <small>{dueLabel(summary.urgentBlocker, 'relative')}</small>
        </button>
      )}
    </section>
  );
}

function OverviewCoauthorSection({
  entries,
  totalCount,
  onOpen,
  onPatch,
  patchingTaskPath,
}: {
  entries: VaultEntry[];
  totalCount: number;
  onOpen: (path: string) => void;
  onPatch: (path: string, updates: TaskMetadataUpdates, currentModifiedAt?: number) => Promise<void> | void;
  patchingTaskPath: string;
}) {
  return (
    <details className="overview-task-lane overview-task-lane-collapsible overview-coauthor-group" id="coauthor-tasks">
      <summary className="triage-lane-title">
        <div>
          <h2>Coauthors</h2>
          <span>Assigned out or waiting on collaborators</span>
        </div>
        <span className="lane-summary-meta">
          <b>{totalCount}</b>
          <ChevronRight size={13} aria-hidden="true" />
        </span>
      </summary>
      <div className="triage-list">
        {entries.length === 0 ? <p className="muted">No tasks are assigned to coauthors.</p> : entries.map((entry) => (
          <OverviewRow key={entry.path} entry={entry} onOpen={onOpen} onPatch={onPatch} disabled={patchingTaskPath === entry.path} />
        ))}
      </div>
    </details>
  );
}

function OverviewScholarCard({ scholar }: { scholar: ScholarStats | null }) {
  if (!scholar || !scholar.available) return null;
  const metrics = scholar.metrics || {};
  const citations = metrics.citations?.all ?? 0;
  const hIndex = metrics.h_index?.all ?? 0;
  const i10 = metrics.i10_index?.all ?? 0;
  const byYear = Object.entries(scholar.citations_by_year || {}).sort(([a], [b]) => a.localeCompare(b));
  const maxYear = Math.max(1, ...byYear.map(([, value]) => value));
  const topPub = (scholar.top_publications || [])[0];
  return (
    <section className="overview-zone zone-research overview-scholar" aria-label="Research impact" data-testid="overview-scholar">
      <div className="overview-scholar-top">
        <span className="overview-scholar-label"><GraduationCap size={13} /> Google Scholar</span>
        {scholar.profile_url && (
          <a className="overview-scholar-link" href={scholar.profile_url} target="_blank" rel="noreferrer">View profile</a>
        )}
      </div>
      <div className="overview-scholar-stats">
        <span><strong>{citations}</strong> citations</span>
        <span><strong>{hIndex}</strong> h-index</span>
        <span><strong>{i10}</strong> i10-index</span>
      </div>
      {byYear.length > 0 && (
        <div className="overview-scholar-spark" role="img" aria-label="Citations by year">
          {byYear.map(([year, count]) => (
            <span key={year} title={`${year}: ${count}`} style={{ height: `${Math.max(10, Math.round((count / maxYear) * 100))}%` }} />
          ))}
        </div>
      )}
      {topPub && (
        <div className="overview-scholar-top-pub" title={`${topPub.title}${topPub.year ? ` (${topPub.year})` : ''} · ${topPub.citations} citations`}>
          Top: {topPub.title}{topPub.year ? ` (${topPub.year})` : ''} · {topPub.citations}
        </div>
      )}
    </section>
  );
}

function OverviewDeadlineRail({ entries, onOpen }: { entries: VaultEntry[]; onOpen: (path: string) => void }) {
  if (entries.length === 0) return null;
  return (
    <section className="overview-zone zone-deadline overview-deadline-rail" id="upcoming-deadlines" aria-label="Upcoming deadlines" data-testid="overview-upcoming-deadlines">
      <TriageLaneTitle title="Upcoming deadlines" count={entries.length} detail="Referee, registration, travel, and other hard dates in the next 30 days (submissions have their own panel)" icon={<AlarmClock size={15} />} />
      <ul className="overview-deadline-list">
        {entries.map((entry) => (
          <li key={entry.path}>
            <button
              type="button"
              className={`overview-deadline-row ${urgencyTone(entry)} deadline-${deadlineTypeLabel(entry)}`}
              onClick={() => onOpen(entry.path)}
              title={`${entry.title} · ${dueLabel(entry, 'full')}`}
            >
              <span className="overview-deadline-dot" aria-hidden="true" />
              <span className="overview-deadline-name">{entry.title}</span>
              <span className="overview-deadline-due">{dueLabel(entry, 'relative')}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

const AVAILABILITY_DOW = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const AVAILABILITY_LABEL: Record<AvailabilityStatus, string> = { free: 'Available', busy: 'Busy', away: 'Away' };

function availabilityMonthCount(): number {
  if (typeof window === 'undefined') return 3;
  const width = window.innerWidth;
  if (width < 360) return 1; // very narrow phones
  if (width < 900) return 2; // phones / tablets / narrow windows
  return 3; // wide
}

function AvailabilityMonth({ year, month, availability, todayKey }: { year: number; month: number; availability: Map<string, AvailabilityDay>; todayKey: string }) {
  const first = new Date(year, month, 1);
  const monthName = first.toLocaleDateString('en-US', { month: 'long' });
  const firstDow = first.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells: Array<Date | null> = [];
  for (let i = 0; i < firstDow; i += 1) cells.push(null);
  for (let d = 1; d <= daysInMonth; d += 1) cells.push(new Date(year, month, d));

  return (
    <div className="availability-month">
      <div className="availability-month-name">{monthName}</div>
      <div className="availability-grid">
        {AVAILABILITY_DOW.map((d) => <span key={d} className="availability-dow">{d}</span>)}
        {cells.map((date, i) => {
          if (!date) return <span key={`blank-${i}`} className="availability-cell availability-blank" aria-hidden="true" />;
          const key = ymd(date);
          const day = availabilityForDate(availability, date);
          const dow = date.getDay();
          const classes = [
            'availability-cell',
            `avail-${day.status}`,
            key === todayKey ? 'is-today' : '',
            key < todayKey ? 'is-past' : '',
            dow === 0 || dow === 6 ? 'is-weekend' : '',
          ].filter(Boolean).join(' ');
          const tip = `${date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} — ${AVAILABILITY_LABEL[day.status]}${day.reasons.length ? `: ${day.reasons.join('; ')}` : ''}`;
          return <span key={key} className={classes} title={tip}>{date.getDate()}</span>;
        })}
      </div>
    </div>
  );
}

function AvailabilityCalendar({ entries }: { entries: VaultEntry[] }) {
  const today = useMemo(() => new Date(), []);
  const todayKey = ymd(today);
  const availability = useMemo(() => buildAvailability(entries), [entries]);
  const [monthOffset, setMonthOffset] = useState(0);
  const [monthCount, setMonthCount] = useState(availabilityMonthCount);
  useEffect(() => {
    const onResize = () => setMonthCount(availabilityMonthCount());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const months = Array.from({ length: monthCount }, (_, i) => new Date(today.getFullYear(), today.getMonth() + monthOffset + i, 1));
  const rangeStart = months[0];
  const rangeEnd = months[months.length - 1];
  const rangeLabel = monthCount === 1
    ? rangeStart.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    : rangeStart.getFullYear() === rangeEnd.getFullYear()
      ? `${rangeStart.toLocaleDateString('en-US', { month: 'short' })} – ${rangeEnd.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}`
      : `${rangeStart.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })} – ${rangeEnd.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}`;

  const todayStatus = availabilityForDate(availability, today);

  return (
    <section className="overview-zone zone-research availability-calendar" aria-label="Availability calendar" data-testid="overview-availability">
      <div className="availability-head">
        <div className="overview-zone-head">
          <span className="zone-icon" aria-hidden="true"><CalendarDays size={15} /></span>
          <div className="triage-lane-title-text">
            <h2>Availability</h2>
            <span>By travel and commitments — color-coded, three months</span>
          </div>
        </div>
        <span className={`availability-now avail-${todayStatus.status}`} data-testid="availability-now">
          <span className="availability-dot" aria-hidden="true" />
          {AVAILABILITY_LABEL[todayStatus.status]} now{todayStatus.reasons.length ? ` · ${todayStatus.reasons[0]}` : ''}
        </span>
      </div>

      <div className="availability-nav">
        <button type="button" onClick={() => setMonthOffset((m) => m - monthCount)} aria-label="Previous months"><ChevronLeft size={14} /></button>
        <strong>{rangeLabel}</strong>
        <button type="button" onClick={() => setMonthOffset((m) => m + monthCount)} aria-label="Next months"><ChevronRight size={14} /></button>
      </div>

      <div className="availability-months">
        {months.map((m) => (
          <AvailabilityMonth key={`${m.getFullYear()}-${m.getMonth()}`} year={m.getFullYear()} month={m.getMonth()} availability={availability} todayKey={todayKey} />
        ))}
      </div>

      <div className="availability-legend">
        <span className="avail-free"><span className="availability-dot" aria-hidden="true" /> Available</span>
        <span className="avail-busy"><span className="availability-dot" aria-hidden="true" /> Busy / event</span>
        <span className="avail-away"><span className="availability-dot" aria-hidden="true" /> Away / travel</span>
      </div>
    </section>
  );
}

function SubmissionRow({ submission, mode, onOpen }: { submission: ConferenceSubmission; mode: 'upcoming' | 'awaiting'; onOpen: (path: string) => void }) {
  const conf = conferenceDateLabel(submission);
  let toneClass: string;
  let rightLabel: string;
  let tip: string;
  if (mode === 'upcoming') {
    toneClass = urgencyTone({ path: submission.path, filename: '', title: submission.title, due: submission.due });
    rightLabel = dueDateLabel(submission.due, 'relative');
    tip = `${submission.title} · submit by ${dueDateLabel(submission.due, 'full')}`;
  } else {
    // Awaiting a decision: show the expected-decision date if known (with urgency so
    // an overdue decision flags a chase-up), otherwise just mark it submitted.
    rightLabel = submission.decisionExpected
      ? dueDateLabel(submission.decisionExpected, 'relative')
      : (submission.submittedOn ? 'submitted' : 'awaiting');
    toneClass = submission.decisionExpected
      ? urgencyTone({ path: submission.path, filename: '', title: submission.title, due: submission.decisionExpected })
      : 'awaiting';
    tip = submission.decisionExpected
      ? `${submission.title} · decision expected ${submission.decisionExpected}`
      : (submission.submittedOn ? `${submission.title} · submitted ${submission.submittedOn}` : submission.title);
  }
  return (
    <li>
      <button
        type="button"
        className={`overview-deadline-row ${toneClass}`}
        onClick={() => onOpen(submission.path)}
        title={conf ? `${tip} · conference ${conf}` : tip}
      >
        <span className="overview-deadline-dot" aria-hidden="true" />
        <span className="submissions-row-text">
          <span className="submissions-row-label">{submission.label}</span>
          {conf && <span className="submissions-conf-date">Conf · {conf}</span>}
        </span>
        <span className="overview-deadline-due">{rightLabel}</span>
      </button>
    </li>
  );
}

function SubmissionsPanel({
  submissions,
  onOpen,
  wrapperClass = 'overview-zone zone-queue',
  title = 'Conference submissions',
  detail = 'Upcoming deadlines and submissions awaiting a decision',
  showAwaiting = true,
}: {
  submissions: ConferenceSubmission[];
  onOpen: (path: string) => void;
  wrapperClass?: string;
  title?: string;
  detail?: string;
  showAwaiting?: boolean;
}) {
  const upcoming = upcomingSubmissions(submissions);
  const awaiting = showAwaiting ? awaitingSubmissions(submissions) : [];
  if (upcoming.length === 0 && awaiting.length === 0) return null;
  return (
    <section className={`${wrapperClass} submissions-panel`} aria-label="Conference submissions" data-testid="overview-submissions">
      <TriageLaneTitle title={title} count={upcoming.length + awaiting.length} detail={detail} icon={<Send size={15} />} />
      {upcoming.length > 0 && (
        <div className="submissions-group" data-testid="submissions-upcoming">
          <p className="submissions-group-label">Upcoming</p>
          <ul className="overview-deadline-list submissions-list">
            {upcoming.map((submission) => (
              <SubmissionRow key={submission.path} submission={submission} mode="upcoming" onOpen={onOpen} />
            ))}
          </ul>
        </div>
      )}
      {awaiting.length > 0 && (
        <div className="submissions-group" data-testid="submissions-awaiting">
          <p className="submissions-group-label">Awaiting response</p>
          <ul className="overview-deadline-list submissions-list">
            {awaiting.map((submission) => (
              <SubmissionRow key={submission.path} submission={submission} mode="awaiting" onOpen={onOpen} />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function RefereeReportsPanel({ reports, onOpen }: { reports: RefereeReport[]; onOpen: (path: string) => void }) {
  const outstanding = outstandingRefereeReports(reports);
  if (outstanding.length === 0) return null;
  return (
    <section className="overview-zone zone-plan referee-panel" aria-label="Referee reports" data-testid="overview-referee-reports">
      <TriageLaneTitle title="Referee reports" count={outstanding.length} detail="Outstanding referee assignments and due dates" icon={<ClipboardList size={15} />} />
      <ul className="overview-deadline-list referee-list">
        {outstanding.map((report) => (
          <li key={report.path}>
            <button
              type="button"
              className={`overview-deadline-row ${urgencyTone({ path: report.path, filename: '', title: report.title, due: report.due })}`}
              onClick={() => onOpen(report.path)}
              title={`${report.title} · ${dueDateLabel(report.due, 'full')}`}
            >
              <span className="overview-deadline-dot" aria-hidden="true" />
              <span className="overview-deadline-name">{report.label}</span>
              <span className="overview-deadline-due">{dueDateLabel(report.due, 'relative')}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ProjectPulsePanel({ pulse, onOpen }: { pulse: ProjectPulse[]; onOpen: (path: string) => void }) {
  if (pulse.length === 0) return null;
  const { featured, rest } = splitProjectPulse(pulse, 3);
  return (
    <section className="overview-zone zone-research project-pulse-panel" aria-label="Project overview" data-testid="overview-project-pulse">
      <TriageLaneTitle title="Projects" count={pulse.length} detail="Most recently active first — expand for the rest" icon={<FolderGit2 size={15} />} />
      <div className="project-pulse-grid project-pulse-featured">
        {featured.map((project) => (
          <ProjectPulseCard key={project.path} pulse={project} onOpen={onOpen} />
        ))}
      </div>
      {rest.length > 0 && (
        <details className="project-pulse-more">
          <summary className="project-pulse-more-toggle">
            <ChevronRight size={14} className="project-pulse-more-chevron" aria-hidden="true" />
            <span>{rest.length} more {rest.length === 1 ? 'project' : 'projects'}</span>
          </summary>
          <div className="project-pulse-grid project-pulse-rest">
            {rest.map((project) => (
              <ProjectPulseCard key={project.path} pulse={project} onOpen={onOpen} />
            ))}
          </div>
        </details>
      )}
    </section>
  );
}

function ProjectPulseCard({ pulse, onOpen }: { pulse: ProjectPulse; onOpen: (path: string) => void }) {
  const due = pulse.nextDeadline;
  const dueTone = due ? urgencyTone({ path: pulse.path, filename: '', title: pulse.name, due: due.date, deadline_type: due.type }) : '';
  const activityBits = [
    `${pulse.openTaskCount} open`,
    pulse.coauthorTaskCount > 0 ? `${pulse.coauthorTaskCount} delegated` : '',
    pulse.recentCompletionCount > 0 ? `${pulse.recentCompletionCount} closed in 3 weeks` : '',
  ].filter(Boolean);
  const activityTitle = `Activity — ${activityBits.join(' · ')}`;
  return (
    <button
      type="button"
      className={`project-pulse-card status-${statusTone(pulse.status)}`}
      onClick={() => onOpen(pulse.path)}
      title={`${pulse.name}${pulse.status ? ` · ${pulse.status}` : ''}`}
    >
      <span className="project-pulse-head">
        <span className="project-pulse-state-dot" aria-hidden="true" />
        <span className="project-pulse-name">{pulse.name}</span>
        {pulse.priority <= 3 && <span className={`priority-chip ${priorityTone(String(pulse.priority))}`}>P{pulse.priority}</span>}
      </span>
      <span className="project-pulse-statusline">
        <span className="project-pulse-status-text">{pulse.status || 'active'}</span>
        {pulse.activityLevel === 0 && <span className="project-pulse-idle" title={activityTitle}>quiet</span>}
      </span>
      <span className="project-pulse-foot">
        <span className="project-pulse-meter" data-level={pulse.activityLevel} title={activityTitle} aria-label={activityTitle}>
          <i aria-hidden="true" /><i aria-hidden="true" /><i aria-hidden="true" />
        </span>
        <span className="project-pulse-load">
          {pulse.openTaskCount} open
          {pulse.urgentTaskCount > 0 && <b className="project-pulse-urgent"> · {pulse.urgentTaskCount} urgent</b>}
        </span>
        {due && (
          <span className={`project-pulse-due ${dueTone}`} title={`${due.label} · ${dueDateLabel(due.date, 'full')}`}>
            {dueDateLabel(due.date, 'relative')}
          </span>
        )}
      </span>
    </button>
  );
}

function OverviewFocusSection({
  entries,
  onOpen,
  onPatch,
  patchingTaskPath,
}: {
  entries: VaultEntry[];
  onOpen: (path: string) => void;
  onPatch: (path: string, updates: TaskMetadataUpdates, currentModifiedAt?: number) => Promise<void> | void;
  patchingTaskPath: string;
}) {
  return (
    <section className="overview-zone zone-focus overview-focus-section" id="must-not-slip" aria-label="Focus tasks" data-testid="overview-focus-tasks">
      <TriageLaneTitle title="Focus tasks" count={entries.length} detail="Ranked focus list, capped at six" icon={<Target size={15} />} />
      <div className="triage-list overview-focus-list">
        {entries.length === 0 ? <p className="muted">No focus tasks.</p> : entries.map((entry) => (
          <OverviewRow key={entry.path} entry={entry} onOpen={onOpen} onPatch={onPatch} disabled={patchingTaskPath === entry.path} />
        ))}
      </div>
    </section>
  );
}

function OverviewTaskGroupSection({
  group,
  focusPaths,
  onOpen,
  onPatch,
  patchingTaskPath,
}: {
  group: OverviewTaskGroup;
  focusPaths: Set<string>;
  onOpen: (path: string) => void;
  onPatch: (path: string, updates: TaskMetadataUpdates, currentModifiedAt?: number) => Promise<void> | void;
  patchingTaskPath: string;
}) {
  const queueEntries = uniqueEntries([...group.now, ...group.next]).filter((entry) => !focusPaths.has(entry.path));
  const waitingEntries = group.waiting.filter((entry) => !focusPaths.has(entry.path));

  return (
    <section className={`overview-task-group overview-task-group-${group.key}`} aria-label={group.title}>
      <div className="overview-task-group-heading">
        <div>
          <h2>{group.title}</h2>
          <span>{group.detail}</span>
        </div>
        <b>{group.totalCount} open</b>
      </div>
      <div className="overview-task-lanes">
        <OverviewTaskMiniLane
          title="Next"
          detail={queueEntries.length > 0 ? `${queueEntries.length} ready after focus` : 'Less urgent ready work'}
          entries={queueEntries}
          empty={group.key === 'research' ? 'No queued research tasks.' : 'No queued other tasks.'}
          onOpen={onOpen}
          onPatch={onPatch}
          patchingTaskPath={patchingTaskPath}
          collapsible
        />
        <OverviewTaskMiniLane
          title="Waiting"
          detail="Blocked or waiting"
          entries={waitingEntries}
          empty={group.key === 'research' ? 'No waiting research tasks.' : 'No waiting other tasks.'}
          onOpen={onOpen}
          onPatch={onPatch}
          patchingTaskPath={patchingTaskPath}
          collapsible
        />
      </div>
    </section>
  );
}

function OverviewTaskMiniLane({
  title,
  detail,
  entries,
  empty,
  onOpen,
  onPatch,
  patchingTaskPath,
  collapsible = false,
  emphasis = 'normal',
}: {
  title: string;
  detail: string;
  entries: VaultEntry[];
  empty: string;
  onOpen: (path: string) => void;
  onPatch: (path: string, updates: TaskMetadataUpdates, currentModifiedAt?: number) => Promise<void> | void;
  patchingTaskPath: string;
  collapsible?: boolean;
  emphasis?: 'normal' | 'focus';
}) {
  const body = (
    <div className="triage-list">
      {entries.length === 0 ? <p className="muted">{empty}</p> : entries.map((entry) => (
        <OverviewRow key={entry.path} entry={entry} onOpen={onOpen} onPatch={onPatch} disabled={patchingTaskPath === entry.path} />
      ))}
    </div>
  );
  const className = `overview-task-lane overview-task-lane-${emphasis}${collapsible ? ' overview-task-lane-collapsible' : ''}`;
  if (collapsible) {
    return (
      <details className={className}>
        <summary className="triage-lane-title">
          <div>
            <h2>{title}</h2>
            <span>{detail}</span>
          </div>
          <span className="lane-summary-meta">
            <b>{entries.length}</b>
            <ChevronRight size={13} aria-hidden="true" />
          </span>
        </summary>
        {body}
      </details>
    );
  }

  return (
    <section className={className}>
      <TriageLaneTitle title={title} count={entries.length} detail={detail} />
      {body}
    </section>
  );
}

function TriageLaneTitle({ title, detail, count, icon }: { title: string; detail: string; count: number; icon?: ReactNode }) {
  return (
    <div className="triage-lane-title">
      {icon && <span className="zone-icon" aria-hidden="true">{icon}</span>}
      <div className="triage-lane-title-text">
        <h2>{title}</h2>
        <span>{detail}</span>
      </div>
      <b className="zone-count">{count}</b>
    </div>
  );
}

function OverviewProjectTriageRow({ item, onOpen }: { item: ProjectReview; onOpen: (path: string) => void }) {
  return (
    <button className={`overview-project-row ${entryToneClass(item.project)} ${item.stale ? 'stale' : ''}`} onClick={() => onOpen(item.project.path)}>
      <div>
        <strong>{item.project.title}</strong>
        <span>{item.openTaskCount} open · {item.stale ? item.staleReason : item.project.status || 'current'}</span>
      </div>
      {item.stale ? <span className="status blocked">review</span> : <span className="status neutral">current</span>}
    </button>
  );
}

function PriorityChip({ value }: { value?: string | null }) {
  if (!value) return null;
  return <span className={`priority-chip ${priorityTone(value)}`}>P{value}</span>;
}

function UrgentChip() {
  return <span className="urgent-chip">urgent</span>;
}

function StatusChip({ value }: { value?: string | null }) {
  if (!value) return null;
  return <span className={`status ${statusTone(value)}`}>{value}</span>;
}

function AssigneeChip({ value }: { value?: string | null }) {
  if (!value) return null;
  return <span className="assignee-chip">to {value}</span>;
}

function DateChip({ entry, mode = 'full' }: { entry: VaultEntry; mode?: DateLabelMode }) {
  const kind = deadlineType(entry);
  const fullLabel = kind ? `${kind} deadline · ${dueLabel(entry, 'full')}` : dueLabel(entry, 'full');
  return <span className={`date-chip ${urgencyTone(entry)} ${kind ? `deadline-${kind}` : ''}`} title={mode === 'relative' ? fullLabel : undefined}>{dueLabel(entry, mode)}</span>;
}

function DeadlineTypeChip({ entry }: { entry: VaultEntry }) {
  const kind = deadlineTypeLabel(entry);
  return <span className={`deadline-chip ${kind}`}>{kind}</span>;
}

function TaskMetadataChips({ entry, dateMode = 'full' }: { entry: VaultEntry; dateMode?: DateLabelMode }) {
  return (
    <>
      {isManualUrgent(entry) && <UrgentChip />}
      {entry.priority && <PriorityChip value={entry.priority} />}
      {entry.status && <StatusChip value={entry.status} />}
      <AssigneeChip value={taskAssignee(entry)} />
      {isTask(entry) && <DeadlineTypeChip entry={entry} />}
      <DateChip entry={entry} mode={dateMode} />
    </>
  );
}

const OVERVIEW_STATUS_SEQUENCE = ['open', 'active', 'waiting', 'blocked', 'done'];
const OVERVIEW_PRIORITY_SEQUENCE = ['1', '2', '3', '4'];

function nextOverviewStatus(value?: string | null): string {
  const current = value || 'open';
  const index = OVERVIEW_STATUS_SEQUENCE.indexOf(current);
  return OVERVIEW_STATUS_SEQUENCE[(index + 1) % OVERVIEW_STATUS_SEQUENCE.length] || 'open';
}

function nextOverviewPriority(value?: string | null): string {
  const index = OVERVIEW_PRIORITY_SEQUENCE.indexOf(String(value || ''));
  return OVERVIEW_PRIORITY_SEQUENCE[(index + 1) % OVERVIEW_PRIORITY_SEQUENCE.length] || '1';
}

function TaskMetadataDisclosure({ entry, detail, dateMode = 'full' }: { entry: VaultEntry; detail: string; dateMode?: DateLabelMode }) {
  const [open, setOpen] = useState(false);
  if (!isTask(entry)) return null;
  return (
    <div className={`task-metadata-disclosure ${open ? 'open' : ''}`}>
      <button
        type="button"
        className="task-metadata-trigger"
        aria-expanded={open}
        aria-label={`Show metadata for ${entry.title}`}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((current) => !current);
        }}
      >
        <span>Details</span>
        <span>{dueLabel(entry, dateMode)}</span>
      </button>
      {open && (
        <div className="task-metadata-disclosure-body">
          <span>{detail}</span>
          <div className="row-meta">
            <TaskMetadataChips entry={entry} dateMode={dateMode} />
          </div>
        </div>
      )}
    </div>
  );
}

function TaskEssentialPills({ entry, showFocus = true }: { entry: VaultEntry; showFocus?: boolean }) {
  const estimate = estimateLabel(entry);
  const dateText = dueLabel(entry, 'relative');
  const focusLabel = focusReason(entry);
  return (
    <div className="overview-task-pill-strip overview-task-pill-strip-essential" aria-label={`Essential metadata for ${entry.title}`}>
      {(entry.project || entryLens(entry)) && <span className="overview-pill project-pill">{entry.project || entryLens(entry)}</span>}
      {showFocus && focusLabel && <span className="urgent-chip">{focusLabel}</span>}
      {(entry.due || entry.date || entry.start_date) && (
        <span className={`date-chip ${urgencyTone(entry)} deadline-${deadlineTypeLabel(entry)}`} title={dueLabel(entry, 'full')}>
          {dateText}
        </span>
      )}
      {estimate && <span className="overview-pill estimate-pill">{estimate}</span>}
    </div>
  );
}

function OverviewMetadataPills({
  entry,
  onPatch,
  disabled,
  context = 'Overview',
}: {
  entry: VaultEntry;
  onPatch: (path: string, updates: TaskMetadataUpdates, currentModifiedAt?: number) => Promise<void> | void;
  disabled: boolean;
  context?: string;
}) {
  const estimate = estimateLabel(entry);
  const status = entry.status || 'open';
  const deadlineKind = deadlineTypeLabel(entry);
  const patch = (updates: TaskMetadataUpdates) => {
    if (disabled) return;
    void onPatch(entry.path, updates, entry.modified_at);
  };
  const promptProject = () => {
    const next = window.prompt('Project', entry.project || '');
    if (next === null) return;
    patch({ project: next.trim() });
  };
  const promptDue = () => {
    const next = window.prompt('Due date (YYYY-MM-DD, blank to clear)', entry.due || entry.date || '');
    if (next === null) return;
    patch({ due: next.trim() });
  };
  const promptEstimate = () => {
    const next = window.prompt('Estimate minutes (blank to clear)', String(entry.estimate_minutes || ''));
    if (next === null) return;
    patch({ estimate_minutes: next.trim() });
  };
  const assignee = taskAssignee(entry);
  const promptAssignee = () => {
    const next = window.prompt('Assignee (blank to clear)', assignee || '');
    if (next === null) return;
    patch({ assignee: next.trim() });
  };
  return (
    <div className="overview-task-pill-strip" aria-label={`${context} metadata for ${entry.title}`}>
      <button
        type="button"
        className="overview-pill overview-edit-pill project-pill"
        disabled={disabled}
        title="Change project"
        onClick={promptProject}
      >
        {entry.project || entryLens(entry)}
      </button>
      <button
        type="button"
        className={`overview-edit-pill priority-chip ${priorityTone(entry.priority)}`}
        disabled={disabled}
        title="Cycle priority"
        onClick={() => patch({ priority: nextOverviewPriority(entry.priority) })}
      >
        {entry.priority ? `P${entry.priority}` : 'P-'}
      </button>
      <button
        type="button"
        className={`overview-edit-pill urgent-chip ${isManualUrgent(entry) ? 'on' : 'off'}`}
        disabled={disabled}
        title={isManualUrgent(entry) ? 'Remove from Focus tasks' : 'Mark urgent for Focus tasks'}
        onClick={() => patch({ urgent: !isManualUrgent(entry) })}
      >
        {isManualUrgent(entry) ? 'Urgent' : 'Focus'}
      </button>
      <button
        type="button"
        className={`overview-edit-pill status ${statusTone(status)}`}
        disabled={disabled}
        title="Cycle status"
        onClick={() => patch({ status: nextOverviewStatus(status) })}
      >
        {status}
      </button>
      {assignee && (
        <button
          type="button"
          className="overview-edit-pill assignee-chip"
          disabled={disabled}
          title="Change assignee"
          onClick={promptAssignee}
        >
          to {assignee}
        </button>
      )}
      <button
        type="button"
        className={`overview-edit-pill deadline-chip ${deadlineKind}`}
        disabled={disabled}
        title="Toggle hard/soft deadline"
        onClick={() => patch({ deadline_type: nextDeadlineType(entry) })}
      >
        {deadlineKind}
      </button>
      <button
        type="button"
        className={`overview-edit-pill date-chip ${urgencyTone(entry)} deadline-${deadlineKind}`}
        disabled={disabled}
        title={`${deadlineKind} deadline · ${dueLabel(entry, 'full')}`}
        onClick={promptDue}
      >
        {dueLabel(entry, 'relative')}
      </button>
      {estimate && (
        <button
          type="button"
          className="overview-pill overview-edit-pill estimate-pill"
          disabled={disabled}
          title="Change estimate"
          onClick={promptEstimate}
        >
          {estimate}
        </button>
      )}
    </div>
  );
}

function TaskEditDrawer({
  entry,
  onPatch,
  disabled,
  context = 'Task',
}: {
  entry: VaultEntry;
  onPatch: (path: string, updates: TaskMetadataUpdates, currentModifiedAt?: number) => Promise<void> | void;
  disabled: boolean;
  context?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className={`task-edit-drawer task-edit-drawer-trigger ${open ? 'open' : ''}`}
        aria-label={`Show more controls for ${entry.title}`}
        aria-expanded={open}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((current) => !current);
        }}
      >
        <span>{open ? 'Less' : 'More'}</span>
      </button>
      {open && (
        <div className="task-edit-drawer-body">
          <div className="task-edit-drawer-section">
            <span className="task-edit-drawer-label">Metadata</span>
            <OverviewMetadataPills entry={entry} onPatch={onPatch} disabled={disabled} context={context} />
          </div>
          <div className="task-edit-drawer-section task-edit-drawer-actions">
            <span className="task-edit-drawer-label">Actions</span>
            <TaskDirectActions path={entry.path} title={entry.title} priority={entry.priority} assignee={taskAssignee(entry)} onPatch={onPatch} disabled={disabled} />
          </div>
        </div>
      )}
    </>
  );
}

export function OverviewRow({
  entry,
  onOpen,
  onPatch,
  disabled,
}: {
  entry: VaultEntry;
  onOpen: (path: string) => void;
  onPatch: (path: string, updates: TaskMetadataUpdates, currentModifiedAt?: number) => Promise<void> | void;
  disabled: boolean;
}) {
  const days = daysUntil(entry.due || entry.date || entry.start_date);
  const urgent = Boolean(focusReason(entry)) || (days !== null && days <= 3 && isHardDeadline(entry));
  const taskRow = isTask(entry);
  return (
    <article className={`overview-row managed-row ${entryToneClass(entry)} ${urgent ? 'urgent' : ''}`}>
      <button className={`managed-row-main ${taskRow ? 'overview-task-main' : ''}`} onClick={() => onOpen(entry.path)}>
        <div>
          <strong>{entry.title}</strong>
          {!taskRow && <span>{entry.project || entryLens(entry)} · {entry.path}</span>}
        </div>
        {!taskRow && (
          <div className="row-meta">
            <TaskMetadataChips entry={entry} dateMode="relative" />
          </div>
        )}
      </button>
      {taskRow && <TaskEssentialPills entry={entry} />}
      {taskRow && <TaskEditDrawer entry={entry} onPatch={onPatch} disabled={disabled} context="Overview" />}
    </article>
  );
}

function TaskDirectActions({
  path,
  title,
  priority,
  assignee,
  onPatch,
  disabled,
}: {
  path: string;
  title: string;
  priority?: string | null;
  assignee?: string | null;
  onPatch: (path: string, updates: TaskMetadataUpdates, currentModifiedAt?: number) => Promise<void> | void;
  disabled?: boolean;
}) {
  const [assigneeDraft, setAssigneeDraft] = useState(assignee || '');
  useEffect(() => {
    setAssigneeDraft(assignee || '');
  }, [assignee, path]);
  const patch = (updates: TaskMetadataUpdates) => {
    void onPatch(path, updates);
  };
  const commitAssignee = () => {
    const next = assigneeDraft.trim();
    if (next !== (assignee || '')) patch({ assignee: next });
  };
  return (
    <div className="task-direct-actions" aria-label={`Task actions for ${title}`}>
      <button type="button" disabled={disabled} onClick={() => patch({ status: 'active' })}>Active</button>
      <button type="button" disabled={disabled} onClick={() => patch({ status: 'waiting' })}>Wait</button>
      <button type="button" disabled={disabled} onClick={() => patch({ status: 'blocked' })}>Block</button>
      <button type="button" disabled={disabled} onClick={() => patch({ status: 'done' })}>Done</button>
      <select
        aria-label={`Priority for ${title}`}
        value={priority || ''}
        disabled={disabled}
        onChange={(event) => patch({ priority: event.target.value })}
      >
        <option value="">P-</option>
        <option value="1">P1</option>
        <option value="2">P2</option>
        <option value="3">P3</option>
        <option value="4">P4</option>
      </select>
      <input
        aria-label={`Assignee for ${title}`}
        value={assigneeDraft}
        disabled={disabled}
        placeholder="Assign"
        onChange={(event) => setAssigneeDraft(event.target.value)}
        onBlur={commitAssignee}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
        }}
      />
    </div>
  );
}

export function OpenTasksView({
  data,
  filters,
  setFilters,
  taskProjects,
  onOpen,
  onPatchTaskMetadata,
  patchingTaskPath,
}: {
  data: WorkbenchData;
  filters: EntryFilters;
  setFilters: (next: EntryFilters | ((current: EntryFilters) => EntryFilters)) => void;
  taskProjects: string[];
  onOpen: (path: string) => void;
  onPatchTaskMetadata: (path: string, updates: TaskMetadataUpdates, currentModifiedAt?: number) => Promise<void> | void;
  patchingTaskPath: string;
}) {
  const [mode, setMode] = useState<TaskViewMode>('preview');
  const [editingTaskPath, setEditingTaskPath] = useState('');

  const meta = taskViewMeta[mode];

  useEffect(() => {
    setEditingTaskPath('');
  }, [mode]);

  return (
    <section className="work-view open-tasks-view">
      <ViewHeader
        eyebrow="Task view"
        title="Open Tasks"
        meta={`${data.openTasks.length} open tasks · ${filters.domain ? `${domainLabel(filters.domain)} only · ` : ''}${meta}`}
        actions={(
          <>
            <div className="segmented-control" aria-label="Open tasks domain">
              <button className={!filters.domain ? 'active' : ''} onClick={() => setFilters((current) => ({ ...current, domain: '' }))}>All</button>
              <button className={filters.domain === 'research' ? 'active' : ''} onClick={() => setFilters((current) => ({ ...current, domain: 'research' }))}>Research</button>
              <button className={filters.domain === 'admin' ? 'active' : ''} onClick={() => setFilters((current) => ({ ...current, domain: 'admin' }))}>Admin</button>
              <button className={filters.domain === 'personal' ? 'active' : ''} onClick={() => setFilters((current) => ({ ...current, domain: 'personal' }))}>Personal</button>
            </div>
            <div className="segmented-control" aria-label="Open tasks view mode">
              <button className={mode === 'preview' ? 'active' : ''} onClick={() => setMode('preview')}>Preview</button>
              <button className={mode === 'kanban' ? 'active' : ''} onClick={() => setMode('kanban')}>Kanban</button>
              <button className={mode === 'next-four-weeks' ? 'active' : ''} onClick={() => setMode('next-four-weeks')}>4 Weeks</button>
              <button className={mode === 'active' ? 'active' : ''} onClick={() => setMode('active')}>Active</button>
              <button className={mode === 'queue' ? 'active' : ''} onClick={() => setMode('queue')}>Queue</button>
              <button className={mode === 'list' ? 'active' : ''} onClick={() => setMode('list')}>List</button>
            </div>
            <details className="toolbar-drawer">
              <summary><ListFilter size={14} /> Filters</summary>
              <TaskFilterControls filters={filters} setFilters={setFilters} taskProjects={taskProjects} compact />
            </details>
          </>
        )}
      />
      {mode === 'preview' && (
        <TaskPreviewGroups
          groups={data.taskBoard}
          onOpen={onOpen}
          onPatch={onPatchTaskMetadata}
          patchingTaskPath={patchingTaskPath}
        />
      )}
      {mode === 'kanban' && (
        <TaskBoard
          groups={data.taskBoard}
          onOpen={onOpen}
          onPatch={onPatchTaskMetadata}
          projectOptions={taskProjects}
          patchingTaskPath={patchingTaskPath}
          editingTaskPath={editingTaskPath}
          setEditingTaskPath={setEditingTaskPath}
          ariaLabel="Open task Kanban board"
        />
      )}
      {mode === 'next-four-weeks' && (
        <TaskBoard
          groups={data.taskTimeline}
          onOpen={onOpen}
          onPatch={onPatchTaskMetadata}
          projectOptions={taskProjects}
          patchingTaskPath={patchingTaskPath}
          editingTaskPath={editingTaskPath}
          setEditingTaskPath={setEditingTaskPath}
          ariaLabel="Open task four week runway"
          className="timeline-board"
        />
      )}
      {mode === 'active' && (
        <TaskList
          entries={data.activeTasks}
          onOpen={onOpen}
          onPatch={onPatchTaskMetadata}
          projectOptions={taskProjects}
          patchingTaskPath={patchingTaskPath}
          editingTaskPath={editingTaskPath}
          setEditingTaskPath={setEditingTaskPath}
          emptyMessage="No active near-term or high-priority tasks match these filters."
        />
      )}
      {mode === 'queue' && (
        <TaskBoard
          groups={data.taskQueue}
          onOpen={onOpen}
          onPatch={onPatchTaskMetadata}
          projectOptions={taskProjects}
          patchingTaskPath={patchingTaskPath}
          editingTaskPath={editingTaskPath}
          setEditingTaskPath={setEditingTaskPath}
          ariaLabel="Open task queue board"
          className="queue-board"
        />
      )}
      {mode === 'list' && (
        <TaskList
          entries={data.openTasks}
          onOpen={onOpen}
          onPatch={onPatchTaskMetadata}
          projectOptions={taskProjects}
          patchingTaskPath={patchingTaskPath}
          editingTaskPath={editingTaskPath}
          setEditingTaskPath={setEditingTaskPath}
          emptyMessage="No open tasks match these filters."
        />
      )}
    </section>
  );
}

function raPublicPageHref(record: RARecord): string {
  return `/dashboard/collaborators/${dashboardSlug(record.slug)}.html`;
}

function openRAPublicPage(record: RARecord): void {
  openStandalonePage(raPublicPageHref(record));
}

function openRAPublicIndex(): void {
  openStandalonePage('/dashboard/collaborators/index.html');
}

export function AdminCenterView({
  data,
  onOpen,
  onPatchTaskMetadata,
  patchingTaskPath,
}: {
  data: AdminCenterData;
  onOpen: (path: string) => void;
  onPatchTaskMetadata: (path: string, updates: TaskMetadataUpdates, currentModifiedAt?: number) => Promise<void> | void;
  patchingTaskPath: string;
}) {
  return (
    <section className="work-view admin-center-view">
      <ViewHeader
        eyebrow="Admin management"
        title="Admin Center"
        meta={`${data.metrics.total} open admin tasks · ${data.metrics.urgent} urgent · ${data.metrics.waiting} waiting`}
      />

      <div className="admin-metric-grid" aria-label="Admin Center summary">
        <ProjectMetric label="Urgent admin" value={String(data.metrics.urgent)} />
        <ProjectMetric label="Due soon" value={String(data.metrics.dueSoon)} />
        <ProjectMetric label="Waiting" value={String(data.metrics.waiting)} />
        <ProjectMetric label="Forms / approvals" value={String(data.metrics.formsApprovals)} />
        <ProjectMetric label="Personal / life" value={String(data.metrics.lifeAdmin)} />
      </div>

      <div className="admin-lane-grid" aria-label="Admin task lanes">
        {data.lanes.map((lane) => (
          <AdminLanePanel
            key={lane.id}
            lane={lane}
            onOpen={onOpen}
            onPatchTaskMetadata={onPatchTaskMetadata}
            patchingTaskPath={patchingTaskPath}
          />
        ))}
      </div>
    </section>
  );
}

const ADMIN_LANE_TONE: Record<string, { zone: string; icon: ReactNode }> = {
  urgent: { zone: 'zone-danger', icon: <AlarmClock size={15} /> },
  forms: { zone: 'zone-blue', icon: <ClipboardList size={15} /> },
  'policy-service': { zone: 'zone-accent', icon: <Shield size={15} /> },
  'life-admin': { zone: 'zone-good', icon: <HeartPulse size={15} /> },
  waiting: { zone: 'zone-warn', icon: <Clock3 size={15} /> },
  later: { zone: 'zone-neutral', icon: <Layers size={15} /> },
};

function AdminLanePanel({
  lane,
  onOpen,
  onPatchTaskMetadata,
  patchingTaskPath,
}: {
  lane: AdminCenterData['lanes'][number];
  onOpen: (path: string) => void;
  onPatchTaskMetadata: (path: string, updates: TaskMetadataUpdates, currentModifiedAt?: number) => Promise<void> | void;
  patchingTaskPath: string;
}) {
  const tone = ADMIN_LANE_TONE[lane.id] ?? { zone: 'zone-neutral', icon: <Layers size={15} /> };
  return (
    <section className={`zone-card ${tone.zone} admin-lane admin-lane-${lane.id}`}>
      <TriageLaneTitle title={lane.title} detail={lane.detail} count={lane.entries.length} icon={tone.icon} />
      <ProjectTaskList
        entries={lane.entries.slice(0, 8)}
        onOpen={onOpen}
        onPatch={onPatchTaskMetadata}
        patchingTaskPath={patchingTaskPath}
        empty="No admin tasks in this lane."
      />
      {lane.entries.length > 8 && <p className="muted">+{lane.entries.length - 8} more admin tasks in this lane.</p>}
    </section>
  );
}

function performanceStatusLabel(status: PerformanceEvaluationData['categories'][number]['status']): string {
  if (status === 'ready') return 'ready';
  if (status === 'supported') return 'supported';
  if (status === 'needs-verification') return 'verify';
  return 'check first';
}

export function PerformanceEvaluationView({
  data,
  onOpen,
}: {
  data: PerformanceEvaluationData;
  onOpen: (path: string) => void;
}) {
  const academic = data.categories.filter((category) => category.group === 'academic');
  const policy = data.categories.filter((category) => category.group === 'policy');
  const academicEntries = data.entries.filter((entry) => entry.group === 'academic');
  const policyEntries = data.entries.filter((entry) => entry.group === 'policy');
  const sourcePath = data.sourceNote?.path;
  const taskPath = data.task?.path;
  return (
    <section className="work-view performance-evaluation-view">
      <ViewHeader
        eyebrow="Review packet"
        title="Performance Evaluation"
        meta={`${data.metrics.readyEntries}/${data.metrics.individualEntries} individual entries ready · ${data.metrics.needsVerification} checks · ${data.metrics.evidenceLinks} evidence links`}
        actions={(
          <>
            {sourcePath && <button onClick={() => onOpen(sourcePath)}><FileText size={14} /> Accomplishments note</button>}
            {taskPath && <button onClick={() => onOpen(taskPath)}><ClipboardList size={14} /> Entry task</button>}
          </>
        )}
      />

      <div className="admin-metric-grid" aria-label="Performance Evaluation summary">
        <ProjectMetric label="Individual items" value={String(data.metrics.individualEntries)} />
        <ProjectMetric label="Ready items" value={String(data.metrics.readyEntries)} />
        <ProjectMetric label="Academic categories" value={String(data.metrics.academicCategories)} />
        <ProjectMetric label="Policy categories" value={String(data.metrics.policyCategories)} />
        <ProjectMetric label="Verify before submit" value={String(data.metrics.needsVerification)} />
        <ProjectMetric label="Open entry task" value={String(data.metrics.openTasks)} />
      </div>

      <section className="zone-card zone-blue performance-eval-section">
        <ProjectSectionTitle title="Individual Entry Queue" meta={`${data.entries.length} items · enter one at a time`} icon={<ClipboardList size={15} />} />
        <div className="performance-entry-board">
          <PerformanceEntryLane title="Academic entries" entries={academicEntries} onOpen={onOpen} />
          <PerformanceEntryLane title="Policy entries" entries={policyEntries} onOpen={onOpen} />
        </div>
      </section>

      <section className="zone-card zone-warn performance-check-panel">
        <ProjectSectionTitle title="Verify Before Submitting" meta={`${data.verification.length} checks`} icon={<Shield size={15} />} />
        <div className="performance-verification-list">
          {data.verification.map((item) => (
            <article key={item.id} className={`performance-verification-item ${item.status}`}>
              <span className={`status ${item.status === 'supported' ? 'done' : 'waiting'}`}>{item.status}</span>
              <div>
                <strong>{item.title}</strong>
                <p>{item.detail}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <details className="performance-eval-drawer">
        <summary><span>Academic category reference</span><b>{academic.length}</b></summary>
        <div className="performance-category-grid">
          {academic.map((category) => (
            <PerformanceCategoryCard key={category.id} category={category} onOpen={onOpen} />
          ))}
        </div>
      </details>

      <details className="performance-eval-drawer">
        <summary><span>Policy category reference</span><b>{policy.length}</b></summary>
        <div className="performance-category-grid">
          {policy.map((category) => (
            <PerformanceCategoryCard key={category.id} category={category} onOpen={onOpen} />
          ))}
        </div>
      </details>

      <details className="performance-eval-drawer">
        <summary><span>Evidence links</span><b>{data.evidenceEntries.length}</b></summary>
        <div className="performance-evidence-grid">
          {data.evidenceEntries.length === 0 ? <p className="muted">No supporting Markdown entries found.</p> : data.evidenceEntries.map((entry) => (
            <button key={entry.path} className="performance-evidence-link" onClick={() => onOpen(entry.path)}>
              <span>{entryLens(entry)}</span>
              <strong>{entry.title}</strong>
              <small>{entry.path}</small>
            </button>
          ))}
        </div>
      </details>
    </section>
  );
}

function PerformanceEntryLane({
  title,
  entries,
  onOpen,
}: {
  title: string;
  entries: PerformanceEvaluationData['entries'];
  onOpen: (path: string) => void;
}) {
  const groupedEntries = entries.reduce<Array<{ category: string; entries: PerformanceEvaluationData['entries'] }>>((groups, entry) => {
    const existing = groups.find((group) => group.category === entry.narrowCategory);
    if (existing) {
      existing.entries.push(entry);
    } else {
      groups.push({ category: entry.narrowCategory, entries: [entry] });
    }
    return groups;
  }, []);

  return (
    <section className="performance-entry-lane">
      <header>
        <strong>{title}</strong>
        <span>{entries.length} items</span>
      </header>
      <div className="performance-entry-list">
        {groupedEntries.map((group) => (
          <section key={group.category} className="performance-entry-category-group">
            <header>
              <strong>{group.category}</strong>
              <span>{group.entries.length}</span>
            </header>
            <div>
              {group.entries.map((entry) => (
                <PerformanceEntryCard key={entry.id} entry={entry} onOpen={onOpen} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </section>
  );
}

function PerformanceEntryCard({
  entry,
  onOpen,
}: {
  entry: PerformanceEvaluationData['entries'][number];
  onOpen: (path: string) => void;
}) {
  const copyEntry = async () => {
    const fieldText = entry.formFields.map((field) => `${field.label}: ${field.value}`).join('\n');
    await navigator.clipboard?.writeText(`${fieldText}\n\nSuggested description:\n${entry.suggestedText}`);
  };
  return (
    <details className={`performance-entry-card ${entry.status}`}>
      <summary>
        <div className="performance-entry-summary-main">
          <span className="eyebrow">{entry.period}</span>
          <h3>{entry.title}</h3>
          <span className="performance-entry-category">{entry.broadCategory} / {entry.narrowCategory}</span>
        </div>
        <span className={`status ${entry.status === 'ready' || entry.status === 'supported' ? 'done' : 'waiting'}`}>
          {performanceStatusLabel(entry.status)}
        </span>
      </summary>
      <div className="performance-entry-details">
        <div className="performance-entry-field-grid">
          {entry.formFields.map((field) => (
            <div key={`${entry.id}-${field.label}`} className="performance-entry-field">
              <span>{field.label}</span>
              <strong>{field.value}</strong>
            </div>
          ))}
        </div>
        <p>{entry.suggestedText}</p>
        <div className="performance-entry-evidence">
          {entry.evidence.map((item) => <span key={item}>{item}</span>)}
        </div>
        <footer>
          <button onClick={() => void copyEntry()}><Copy size={14} /> Copy wording</button>
          {entry.evidencePath && (
            <button onClick={() => onOpen(entry.evidencePath || '')}><FileText size={14} /> Evidence</button>
          )}
        </footer>
      </div>
    </details>
  );
}

function PerformanceCategoryCard({
  category,
  onOpen,
}: {
  category: PerformanceEvaluationData['categories'][number];
  onOpen: (path: string) => void;
}) {
  return (
    <article className={`performance-category-card ${category.status}`}>
      <header>
        <div>
          <span className="eyebrow">{category.group}</span>
          <h3>{category.title}</h3>
        </div>
        <span className={`status ${category.status === 'ready' || category.status === 'supported' ? 'done' : 'waiting'}`}>
          {performanceStatusLabel(category.status)}
        </span>
      </header>
      <p>{category.summary}</p>
      <ul>
        {category.bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}
      </ul>
      {category.sourcePath && (
        <button onClick={() => onOpen(category.sourcePath || '')}><FileText size={14} /> Source note</button>
      )}
    </article>
  );
}

export function TravelCenterView({
  data,
  onOpen,
  onPatchTaskMetadata,
  patchingTaskPath,
}: {
  data: TravelCenterData;
  onOpen: (path: string) => void;
  onPatchTaskMetadata: (path: string, updates: TaskMetadataUpdates, currentModifiedAt?: number) => Promise<void> | void;
  patchingTaskPath: string;
}) {
  const [selectedTripKey, setSelectedTripKey] = useState('');
  const [boardMode, setBoardMode] = useState<'overview' | 'accounting'>('overview');
  const resetTravelScroll = useCallback(() => {
    const reset = () => {
      const panel = typeof document !== 'undefined' ? document.querySelector<HTMLElement>('.travel-center-view') : null;
      if (typeof panel?.scrollTo === 'function') panel.scrollTo({ top: 0 });
      else if (panel) panel.scrollTop = 0;
    };
    reset();
    if (typeof window !== 'undefined') {
      window.requestAnimationFrame?.(reset);
      window.setTimeout(reset, 0);
      window.setTimeout(reset, 80);
      window.setTimeout(reset, 240);
      window.setTimeout(reset, 600);
      window.setTimeout(reset, 1000);
    }
  }, []);
  useEffect(() => {
    if (selectedTripKey && !data.trips.some((trip) => trip.key === selectedTripKey)) {
      setSelectedTripKey('');
    }
  }, [data.trips, selectedTripKey]);
  useEffect(() => {
    resetTravelScroll();
  }, [resetTravelScroll, selectedTripKey]);
  const openTripOverview = useCallback((key: string) => {
    setSelectedTripKey(key);
    resetTravelScroll();
  }, [resetTravelScroll]);
  const openTravelBoard = useCallback(() => {
    setSelectedTripKey('');
    resetTravelScroll();
  }, [resetTravelScroll]);

  const ledgerPath = data.ledgerPath;
  const selectedTrip = data.trips.find((trip) => trip.key === selectedTripKey) || null;
  const hostCoveredUsd = Math.max(0, data.summary.ytdActualUsd - data.summary.researchAccountYtdActualUsd);

  if (selectedTrip) {
    return (
      <section key={`travel-trip-${selectedTrip.key}`} className="work-view travel-center-view">
        <ViewHeader
          eyebrow="Travel management"
          title={selectedTrip.title}
          meta={`${travelDateLabel(selectedTrip)} · ${selectedTrip.laneLabel} · ${moneyLabel(selectedTrip.plannedEstimate)} planned`}
          actions={(
            <>
              <button onClick={openTravelBoard}><ChevronLeft size={14} /> Travel board</button>
              <button onClick={() => onOpen(selectedTrip.anchor.path)}><FileText size={14} /> Logistics task</button>
              {ledgerPath && <button onClick={() => onOpen(ledgerPath)}><FileText size={14} /> Expense ledger</button>}
            </>
          )}
        />
        <TravelTripOverviewPage
          trip={selectedTrip}
          onOpen={onOpen}
          onPatchTaskMetadata={onPatchTaskMetadata}
          patchingTaskPath={patchingTaskPath}
        />
      </section>
    );
  }

  return (
    <section key="travel-board" className="work-view travel-center-view">
      <ViewHeader
        eyebrow="Travel management"
        title="Travel Center"
        meta={boardMode === 'accounting'
          ? `${moneyLabel(data.summary.ytdActualUsd)} YTD · ${moneyLabel(data.summary.plannedUsd)} planned · ${moneyLabel(data.summary.expectedNetUsd)} expected net`
          : `${data.trips.length} trips/leads · ${data.summary.approvalNeeded} approvals · ${data.summary.reimbursementItems} reimbursements`}
        actions={(
          <div className="segmented-control travel-center-mode-switcher" aria-label="Travel Center section">
            <button className={boardMode === 'overview' ? 'active' : ''} onClick={() => setBoardMode('overview')}>Overview</button>
            <button className={boardMode === 'accounting' ? 'active' : ''} onClick={() => setBoardMode('accounting')}>Accounting</button>
          </div>
        )}
      />

      {boardMode === 'overview' ? (
        <>
          <div className="travel-headline" aria-label="Travel cost summary">
            <div className="travel-headline-stat">
              <span>Total cost YTD</span>
              <strong>{moneyLabel(data.summary.ytdActualUsd)}</strong>
              <small>all tracked travel this year, gross of reimbursement</small>
            </div>
            <div className="travel-headline-stat research">
              <span>Against research account</span>
              <strong>{moneyLabel(data.summary.researchAccountYtdActualUsd)}</strong>
              <small>
                of {moneyLabel(data.summary.researchAccountLimitUsd)} ({percentLabel(data.summary.researchAccountUsedPct)} used)
                {hostCoveredUsd > 0 ? ` · ${moneyLabel(hostCoveredUsd)} host-covered, excluded` : ''}
              </small>
            </div>
          </div>
          <div className="travel-metric-grid" aria-label="Travel Center summary">
            <ProjectMetric label="Next trip" value={data.summary.nextTrip ? data.summary.nextTrip.title : 'None'} />
            <ProjectMetric label="Approvals" value={String(data.summary.approvalNeeded)} />
            <ProjectMetric label="Booked" value={String(data.summary.bookedUpcoming)} />
            <ProjectMetric label="Reimbursement" value={String(data.summary.reimbursementItems)} />
            <ProjectMetric label="Planned remaining" value={moneyLabel(data.summary.plannedUsd)} />
          </div>

          <div className="travel-top-row" aria-label="Events and submissions">
            <TravelCalendarStrip entries={data.calendarItems} onOpen={onOpen} />

            <SubmissionsPanel
              submissions={data.submissions}
              onOpen={onOpen}
              wrapperClass="zone-card zone-blue"
              title="Submission deadlines"
              detail="Open calls still to submit — block the date"
              showAwaiting={false}
            />

            <TravelSubmittedPanel submissions={data.submissions} onOpen={onOpen} />
          </div>

          <section className="travel-trip-board travel-trip-board-overview" aria-label="Travel planning lanes">
            {data.lanes.map((lane) => (
              <TravelLanePanel
                key={lane.id}
                lane={lane}
                onSelectTrip={openTripOverview}
                onOpen={onOpen}
              />
            ))}
          </section>
        </>
      ) : (
        <div className="travel-center-accounting" aria-label="Travel accounting page">
          <TravelSpendOverview summary={data.summary} ledgerPath={ledgerPath} onOpen={onOpen} />
          <TravelAccountingSemantics summary={data.summary} />
          <section className="zone-card zone-warn travel-ledger-panel travel-ledger-page">
            <ProjectSectionTitle title="Expense ledger" meta={`${data.ledgerItems.length} safe rows`} icon={<Receipt size={15} />} />
            <TravelLedgerTable items={data.ledgerItems} onOpen={onOpen} />
          </section>
        </div>
      )}
    </section>
  );
}

function TravelAccountingSemantics({ summary }: { summary: TravelCenterData['summary'] }) {
  const nonFedYtd = Math.max(0, summary.ytdActualUsd - summary.researchAccountYtdActualUsd);
  const nonFedPlanned = Math.max(0, summary.plannedUsd - summary.researchAccountPlannedUsd);
  const rows = [
    {
      label: 'Actual paid by traveler',
      value: moneyLabel(summary.ytdActualUsd),
      detail: 'Tracked YTD actual rows, before reimbursements.',
    },
    {
      label: 'Submitted / pending reimbursement',
      value: moneyLabel(summary.pendingExpectedReimbursementUsd),
      detail: 'Expected back, but not yet received; reduces expected net only.',
    },
    {
      label: 'Reimbursed received',
      value: moneyLabel(summary.ytdReimbursedUsd),
      detail: 'Cash already received back; reduces current out-of-pocket.',
    },
    {
      label: 'Planned, not yet booked',
      value: moneyLabel(summary.plannedUsd),
      detail: 'Estimate rows without actuals; planning exposure, not spend.',
    },
    {
      label: 'Research travel account',
      value: `${moneyLabel(summary.researchAccountYtdPlusPlannedUsd)} / ${moneyLabel(summary.researchAccountLimitUsd)}`,
      detail: `${moneyLabel(summary.researchAccountYtdActualUsd)} YTD covered + ${moneyLabel(summary.researchAccountPlannedUsd)} planned coverage.`,
    },
    {
      label: 'External / personal coverage',
      value: `${moneyLabel(nonFedYtd)} YTD · ${moneyLabel(nonFedPlanned)} planned`,
      detail: 'Rows outside the configured research-travel budget, including host, external, or personal coverage.',
    },
  ];
  return (
    <section className="zone-card zone-neutral travel-accounting-glossary" aria-label="Travel accounting glossary">
      <ProjectSectionTitle title="Accounting legend" meta="How to read the totals" icon={<ListFilter size={15} />} />
      <div className="travel-accounting-glossary-grid">
        {rows.map((row) => (
          <div key={row.label} className="travel-accounting-glossary-row">
            <span>{row.label}</span>
            <strong>{row.value}</strong>
            <small>{row.detail}</small>
          </div>
        ))}
      </div>
    </section>
  );
}

function TravelSpendOverview({ summary, ledgerPath, onOpen }: { summary: TravelCenterData['summary']; ledgerPath: string | null; onOpen: (path: string) => void }) {
  return (
    <section className="zone-card zone-blue travel-spend-panel" aria-label="Travel spend overview">
      <div className="project-section-title project-section-title-iconed travel-spend-title">
        <span className="zone-icon" aria-hidden="true"><Wallet size={15} /></span>
        <div>
          <h2>Expenditure tracking</h2>
          <span>Year-to-date actuals and planned travel exposure</span>
        </div>
        {ledgerPath && (
          <button type="button" className="quiet-inline-action" onClick={() => onOpen(ledgerPath)}>
            <FileText size={13} /> Open ledger
          </button>
        )}
      </div>
      <div className="travel-spend-grid">
        <ProjectMetric label="Year to date spent" value={moneyLabel(summary.ytdActualUsd)} />
        <ProjectMetric label="YTD reimbursed" value={moneyLabel(summary.ytdReimbursedUsd)} />
        <ProjectMetric label="YTD out of pocket" value={moneyLabel(summary.ytdOutOfPocketUsd)} />
        <ProjectMetric label="Planned remaining" value={moneyLabel(summary.plannedUsd)} />
        <ProjectMetric label="YTD + planned" value={moneyLabel(summary.ytdPlusPlannedUsd)} />
        <ProjectMetric label="Expected net" value={moneyLabel(summary.expectedNetUsd)} />
      </div>
      <ResearchAccountOverview summary={summary} />
      {summary.pendingExpectedReimbursementUsd > 0 && (
        <p className="travel-spend-note">
          {moneyLabel(summary.pendingExpectedReimbursementUsd)} is submitted or pending reimbursement and reduces expected final net, not current cash exposure.
        </p>
      )}
      <p className="travel-spend-note">
        Planned remaining counts estimate rows that are not yet actuals. YTD includes tracked actuals in the current calendar year; undated actuals are included rather than hidden.
      </p>
    </section>
  );
}

function ResearchAccountOverview({ summary }: { summary: TravelCenterData['summary'] }) {
  const progress = Math.max(0, Math.min(100, summary.researchAccountUsedPct));
  return (
    <div
      className="travel-account-card"
      style={{ '--travel-account-pct': `${progress}%` } as CSSProperties}
      aria-label="Research travel account coverage"
    >
      <div className="travel-account-head">
        <div>
          <span>Research travel account</span>
          <strong>{moneyLabel(summary.researchAccountYtdPlusPlannedUsd)} / {moneyLabel(summary.researchAccountLimitUsd)}</strong>
        </div>
        <b>{percentLabel(summary.researchAccountUsedPct)}</b>
      </div>
      <div className="travel-account-bar" aria-hidden="true"><span /></div>
      <div className="travel-account-grid">
        <ProjectMetric label="YTD covered" value={moneyLabel(summary.researchAccountYtdActualUsd)} />
        <ProjectMetric label="YTD received" value={moneyLabel(summary.researchAccountYtdReimbursedUsd)} />
        <ProjectMetric label="Planned account coverage" value={moneyLabel(summary.researchAccountPlannedUsd)} />
        <ProjectMetric
          label={summary.researchAccountOverPlannedUsd > 0 ? 'Over planned limit' : 'Remaining after planned'}
          value={moneyLabel(summary.researchAccountOverPlannedUsd || summary.researchAccountRemainingAfterPlannedUsd)}
        />
      </div>
      {summary.researchAccountOverPlannedUsd > 0 && (
        <p className="travel-spend-note">
          Planned account-covered travel is {moneyLabel(summary.researchAccountOverPlannedUsd)} above the current research-account limit.
        </p>
      )}
      {summary.researchAccountYtdPendingUsd > 0 && (
        <p className="travel-spend-note">
          {moneyLabel(summary.researchAccountYtdPendingUsd)} of YTD account-covered expenses is submitted or pending reimbursement.
        </p>
      )}
    </div>
  );
}

function TravelCalendarStrip({ entries, onOpen, title = 'Event strip', meta = 'Conference/seminar dates, next 3 months' }: { entries: VaultEntry[]; onOpen: (path: string) => void; title?: string; meta?: string }) {
  const upcoming = entries.slice(0, 8);
  return (
    <section className="zone-card zone-accent travel-calendar-strip" aria-label="Travel calendar strip">
      <ProjectSectionTitle title={title} meta={meta} icon={<CalendarDays size={15} />} />
      {upcoming.length === 0 ? (
        <p className="muted">No conference or seminar events are visible in the next 3 months.</p>
      ) : (
        <div className="travel-calendar-row">
          {upcoming.map((entry) => (
            <button key={entry.path} className={`travel-calendar-item ${kindToneClass(entry)}`} onClick={() => onOpen(entry.path)}>
              <span>{entry.start_date || entry.date || entry.due || 'TBD'}</span>
              <strong>{entry.title}</strong>
              <small>{entry.project || entryLens(entry)}</small>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

const TRAVEL_LANE_TONE: Record<string, { zone: string; icon: ReactNode }> = {
  'needs-approval': { zone: 'zone-danger', icon: <Shield size={15} /> },
  'ready-book': { zone: 'zone-blue', icon: <Plane size={15} /> },
  booked: { zone: 'zone-good', icon: <Check size={15} /> },
  reimbursement: { zone: 'zone-warn', icon: <FileText size={15} /> },
  leads: { zone: 'zone-accent', icon: <Sparkles size={15} /> },
};

function TravelLanePanel({
  lane,
  onSelectTrip,
  onOpen,
}: {
  lane: TravelCenterData['lanes'][number];
  onSelectTrip: (key: string) => void;
  onOpen: (path: string) => void;
}) {
  const tone = TRAVEL_LANE_TONE[lane.id] ?? { zone: 'zone-neutral', icon: <Plane size={15} /> };
  return (
    <section className={`zone-card ${tone.zone} travel-lane travel-lane-${lane.id}`}>
      <TriageLaneTitle title={lane.title} detail={lane.detail} count={lane.trips.length} icon={tone.icon} />
      <div className="travel-trip-list">
        {lane.trips.length === 0 ? (
          <p className="muted">No trips in this lane.</p>
        ) : lane.trips.map((trip) => (
          <TravelTripCard
            key={trip.key}
            trip={trip}
            onSelect={() => onSelectTrip(trip.key)}
            onOpen={onOpen}
          />
        ))}
      </div>
    </section>
  );
}

function TravelSubmittedPanel({ submissions, onOpen }: { submissions: ConferenceSubmission[]; onOpen: (path: string) => void }) {
  const awaiting = awaitingSubmissions(submissions);
  return (
    <section className="zone-card travel-submitted-panel submissions-panel" aria-label="Submitted conference papers">
      <TriageLaneTitle title="Submitted" detail="Papers submitted, awaiting a decision" count={awaiting.length} icon={<Send size={15} />} />
      {awaiting.length === 0 ? (
        <p className="muted">No submissions awaiting a decision.</p>
      ) : (
        <ul className="overview-deadline-list submissions-list">
          {awaiting.map((submission) => (
            <SubmissionRow key={submission.path} submission={submission} mode="awaiting" onOpen={onOpen} />
          ))}
        </ul>
      )}
    </section>
  );
}

function TravelTripCard({
  trip,
  onSelect,
  onOpen,
}: {
  trip: TravelTrip;
  onSelect: () => void;
  onOpen: (path: string) => void;
}) {
  const itineraryPath = travelItineraryPath(trip);
  return (
    <article className={`travel-trip-card ${entryToneClass(trip.anchor)}`}>
      <button type="button" className="travel-trip-main" aria-label={`Open ${trip.title} overview`} onClick={onSelect}>
        <span>{travelDateLabel(trip)}</span>
        <strong>{trip.title}</strong>
        <small>{trip.statusLabel} · {trip.project || 'unassigned'}</small>
      </button>

      <div className="travel-trip-pills" aria-label={`${trip.title} travel status`}>
        <span className={`status ${trip.lane === 'needs-approval' ? 'blocked' : trip.lane === 'reimbursement' ? 'waiting' : 'neutral'}`}>{trip.laneLabel}</span>
        {trip.plannedEstimate > 0 && <span className="overview-pill estimate-pill">{moneyLabel(trip.plannedEstimate)} planned</span>}
        {trip.ytdActual > 0 && <span className="overview-pill estimate-pill">{moneyLabel(trip.ytdActual)} YTD</span>}
      </div>

      <div className="travel-readiness-grid" aria-label={`${trip.title} conference overview`}>
        {trip.readiness.map((item) => (
          <span key={item.id} className={`travel-readiness travel-readiness-${item.state}`}>
            <b>{item.label}</b>
            <small>{item.detail}</small>
          </span>
        ))}
      </div>

      <div className="travel-trip-card-actions">
        <button type="button" onClick={onSelect}><Layers size={12} /> Overview</button>
        {itineraryPath && <button type="button" onClick={() => onOpen(itineraryPath)}><Plane size={12} /> Itinerary</button>}
        <button type="button" onClick={() => onOpen(trip.anchor.path)}><FileText size={12} /> Task file</button>
        {trip.missing.length > 0 && (
          <button type="button" onClick={onSelect}><ClipboardList size={12} /> {trip.missing.length} task{trip.missing.length === 1 ? '' : 's'}</button>
        )}
      </div>
    </article>
  );
}

function travelItineraryPath(trip?: Pick<TravelTrip, 'key' | 'briefs' | 'anchor'> | null, item?: TravelLedgerItem): string {
  const firstBrief = trip?.briefs[0];
  if (firstBrief?.path) return firstBrief.path;
  return item?.privatePointer || item?.receiptPointer || item?.notePath || '';
}

function bookingPrimaryPath(trip: Pick<TravelTrip, 'key' | 'briefs' | 'anchor'> | null, item: TravelLedgerItem): string {
  return travelItineraryPath(trip, item) || item.privatePointer || item.receiptPointer || item.notePath;
}

function travelBookingRows(trip: TravelTrip): TravelLedgerItem[] {
  return trip.ledgerItems.filter((item) => {
    const text = `${item.category} ${item.item}`.toLowerCase();
    return item.estimateUsd !== null && /\b(flight|round trip|transport|hotel|lodging|accommodation|room)\b/.test(text);
  });
}

function TravelTripOverviewPage({
  trip,
  onOpen,
  onPatchTaskMetadata,
  patchingTaskPath,
}: {
  trip: TravelTrip;
  onOpen: (path: string) => void;
  onPatchTaskMetadata: (path: string, updates: TaskMetadataUpdates, currentModifiedAt?: number) => Promise<void> | void;
  patchingTaskPath: string;
}) {
  const bookingRows = travelBookingRows(trip);
  return (
    <>
      <section className={`travel-trip-detail-hero ${entryToneClass(trip.anchor)}`}>
        <div className="travel-trip-detail-title">
          <span>{travelDateLabel(trip)}</span>
          <h2>{trip.title}</h2>
          <p>{trip.statusLabel} · {trip.project || 'unassigned'}</p>
          <div className="travel-trip-pills" aria-label={`${trip.title} detail status`}>
            <span className={`status ${trip.lane === 'needs-approval' ? 'blocked' : trip.lane === 'reimbursement' ? 'waiting' : 'neutral'}`}>{trip.laneLabel}</span>
            {trip.plannedEstimate > 0 && <span className="overview-pill estimate-pill">{moneyLabel(trip.plannedEstimate)} planned</span>}
            {trip.ytdActual > 0 && <span className="overview-pill estimate-pill">{moneyLabel(trip.ytdActual)} YTD</span>}
            {trip.unreimbursedActual > 0 && <span className="overview-pill estimate-pill">{moneyLabel(trip.unreimbursedActual)} out of pocket</span>}
          </div>
        </div>
        <div className="travel-trip-detail-metrics">
          <ProjectMetric label="Itinerary" value={readinessValue(trip, 'itinerary')} />
          <ProjectMetric label="Flights" value={readinessValue(trip, 'flights')} />
          <ProjectMetric label="Hotel" value={readinessValue(trip, 'hotel')} />
          <ProjectMetric label="Reimbursement" value={readinessValue(trip, 'reimbursement')} />
        </div>
      </section>

      <TravelTripItinerarySnapshot trip={trip} onOpen={onOpen} />

      <div className="travel-trip-detail-grid">
        <section className="project-work-panel travel-trip-detail-card travel-trip-itinerary-card">
          <ProjectSectionTitle title="Trip file map" meta="Overview stays here; buttons open the specific trip file role" />
          <TravelTripLanding trip={trip} onOpen={onOpen} />
        </section>

        <section className="project-work-panel travel-trip-detail-card">
          <ProjectSectionTitle title="Suggested flights and hotels" meta={`${bookingRows.length} estimate rows`} />
          {bookingRows.length === 0 ? (
            <p className="muted">No flight or hotel estimate rows are linked yet.</p>
          ) : (
            <div className="travel-booking-option-list">
              {bookingRows.map((item) => (
                <TravelBookingOptionCard key={item.id} trip={trip} item={item} onOpen={onOpen} />
              ))}
            </div>
          )}
        </section>

        <section className="project-work-panel travel-trip-detail-card">
          <ProjectSectionTitle title="Related tasks" meta={`${trip.missing.length} open/waiting`} />
          <ProjectTaskList
            entries={trip.missing}
            onOpen={onOpen}
            onPatch={onPatchTaskMetadata}
            patchingTaskPath={patchingTaskPath}
            empty="No open travel tasks for this trip."
          />
        </section>

        <section className="project-work-panel travel-trip-detail-card">
          <ProjectSectionTitle title="Calendar and expenses" meta={`${trip.events.length} events · ${trip.ledgerItems.length} ledger rows`} />
          <div className="travel-trip-event-list">
            {trip.events.length === 0 ? (
              <p className="muted">No dated event is linked yet.</p>
            ) : trip.events.map((event) => (
              <button key={event.path} type="button" onClick={() => onOpen(event.path)}>
                <span>{event.start_date || event.date || event.due || 'TBD'}</span>
                <strong>{event.title}</strong>
                <small>{event.end_date ? `Ends ${event.end_date}` : event.project || entryLens(event)}</small>
              </button>
            ))}
          </div>
          <TravelLedgerTable items={trip.ledgerItems} onOpen={onOpen} />
        </section>
      </div>
    </>
  );
}

function TravelTripItinerarySnapshot({ trip, onOpen }: { trip: TravelTrip; onOpen: (path: string) => void }) {
  const itineraryPath = travelItineraryPath(trip);
  const bookingRows = travelBookingRows(trip);
  const flightRows = bookingRows.filter((item) => itemMatchesBookingKind(item, 'flight'));
  const hotelRows = bookingRows.filter((item) => itemMatchesBookingKind(item, 'hotel'));
  const localRows = bookingRows.filter((item) => itemMatchesBookingKind(item, 'local'));
  const primaryFlight = flightRows[0] || bookingRows[0] || null;
  const primaryHotel = hotelRows[0] || bookingRows.find((item) => itemMatchesBookingKind(item, 'hotel')) || null;
  const primaryLocal = localRows[0] || bookingRows.find((item) => itemMatchesBookingKind(item, 'local')) || null;
  const timeline = travelTimelineItems(trip);
  return (
    <section className={`travel-itinerary-snapshot ${entryToneClass(trip.anchor)}`} aria-label={`${trip.title} visual itinerary`}>
      <div className="travel-itinerary-snapshot-head">
        <div>
          <span className="eyebrow">Visual itinerary</span>
          <h2>{trip.title}</h2>
          <p>{travelDateLabel(trip)} · {trip.laneLabel} · {trip.statusLabel}</p>
        </div>
        <div className="travel-itinerary-snapshot-actions">
          {itineraryPath && (
            <button type="button" onClick={() => onOpen(itineraryPath)}>
              <Plane size={13} /> Open itinerary note
            </button>
          )}
          <button type="button" onClick={() => onOpen(trip.anchor.path)}>
            <FileText size={13} /> Open logistics task
          </button>
        </div>
      </div>

      <div className="travel-itinerary-timeline" aria-label="Trip timeline">
        {timeline.map((item) => (
          <div key={`${item.label}-${item.detail}`} className="travel-itinerary-step">
            <span>{item.date}</span>
            <strong>{item.label}</strong>
            <small>{item.detail}</small>
          </div>
        ))}
      </div>

      <div className="travel-itinerary-snapshot-grid">
        <TravelItineraryCallout
          label="Flight / route"
          item={primaryFlight}
          fallback="No flight estimate linked yet"
          onOpen={() => primaryFlight ? onOpen(bookingPrimaryPath(trip, primaryFlight)) : itineraryPath && onOpen(itineraryPath)}
        />
        <TravelItineraryCallout
          label="Hotel / lodging"
          item={primaryHotel}
          fallback="No hotel estimate linked yet"
          onOpen={() => primaryHotel ? onOpen(bookingPrimaryPath(trip, primaryHotel)) : itineraryPath && onOpen(itineraryPath)}
        />
        <TravelItineraryCallout
          label="Local / reimbursement"
          item={primaryLocal}
          fallback={trip.unreimbursedActual > 0 ? `${moneyLabel(trip.unreimbursedActual)} outstanding` : 'Approval and receipts tracked in task'}
          onOpen={() => primaryLocal ? onOpen(bookingPrimaryPath(trip, primaryLocal)) : itineraryPath && onOpen(itineraryPath)}
        />
      </div>
    </section>
  );
}

function TravelItineraryCallout({
  label,
  item,
  fallback,
  onOpen,
}: {
  label: string;
  item: TravelLedgerItem | null;
  fallback: string;
  onOpen: () => void;
}) {
  const disabled = !item && !fallback;
  return (
    <button type="button" className="travel-itinerary-callout" onClick={onOpen} disabled={disabled}>
      <span>{label}</span>
      <strong>{item ? item.item : fallback}</strong>
      <small>{item ? `${ledgerEstimateLabel(item)} · ${item.status.replace(/_/g, ' ')} · ${ledgerCoverageLabel(item)}` : 'Open itinerary note for detail'}</small>
    </button>
  );
}

function itemMatchesBookingKind(item: TravelLedgerItem, kind: 'flight' | 'hotel' | 'local'): boolean {
  const category = item.category.toLowerCase();
  const itemText = item.item.toLowerCase();
  const text = `${category} ${itemText}`;
  if (kind === 'flight') {
    return (
      /\b(air|airfare|flight|route|transport)\b/.test(category) ||
      /\b(flight|airfare|round trip|atl-|bcn-|bdl-|hvn-|dub-|tbs-|bos-)\b/.test(itemText)
    );
  }
  if (kind === 'hotel') {
    return (
      /\b(lodging|hotel|accommodation|room)\b/.test(category) ||
      (!/\b(transport|ground|local|flight|airfare|route)\b/.test(category) &&
        /\b(hotel|lodging|accommodation|hostel|inn|room)\b/.test(itemText))
    );
  }
  return (
    /\b(ground|local|transfer|taxi|rideshare|uber|bolt)\b/.test(category) ||
    /\b(ground|local|transfer|taxi|rideshare|car|uber|bolt)\b/.test(text)
  );
}

function travelTimelineItems(trip: TravelTrip): Array<{ date: string; label: string; detail: string }> {
  const start = trip.startDate || trip.events.map((event) => event.start_date || event.date || event.due).filter(Boolean).sort()[0] || 'TBD';
  const end = trip.endDate || trip.events.map((event) => event.end_date || event.date || event.due).filter(Boolean).sort().at(-1) || start;
  const event = trip.events[0];
  const eventDate = event?.start_date || event?.date || event?.due || start;
  const eventTitle = event?.title || trip.title;
  const approval = trip.lane === 'needs-approval' ? 'Approval before booking' : trip.lane === 'reimbursement' ? 'Receipts / reimbursement' : 'Booking status';
  return [
    { date: start, label: 'Travel window', detail: start === end ? 'Single-day or local event' : `Through ${end}` },
    { date: eventDate, label: 'Main event', detail: eventTitle },
    { date: end, label: 'Return / closeout', detail: approval },
  ];
}

function TravelBookingOptionCard({ trip, item, onOpen }: { trip: TravelTrip; item: TravelLedgerItem; onOpen: (path: string) => void }) {
  const itineraryPath = travelItineraryPath(trip, item);
  const primaryPath = bookingPrimaryPath(trip, item);
  return (
    <article className="travel-booking-option-card">
      <button type="button" className="travel-booking-option-main" onClick={() => onOpen(primaryPath)}>
        <span>{item.category.replace(/_/g, ' ')}</span>
        <strong>{item.item}</strong>
        <small>{ledgerEstimateLabel(item)} · {item.status.replace(/_/g, ' ')} · {ledgerCoverageLabel(item)}</small>
      </button>
      {item.source && <p>{item.source}</p>}
      <div className="travel-booking-option-actions">
        {itineraryPath && (
          <button type="button" onClick={() => onOpen(itineraryPath)}>
            <Plane size={12} /> Itinerary note
          </button>
        )}
        {(item.privatePointer || item.receiptPointer) && (
          <button type="button" onClick={() => onOpen(item.privatePointer || item.receiptPointer)}>
            <ExternalLink size={12} /> Private details
          </button>
        )}
        <button type="button" onClick={() => onOpen(item.notePath)}>
          <FileText size={12} /> Ledger row
        </button>
      </div>
    </article>
  );
}

function readinessValue(trip: TravelTrip, id: TravelTrip['readiness'][number]['id']): string {
  const item = trip.readiness.find((candidate) => candidate.id === id);
  return item ? item.detail : 'Unknown';
}

function TravelTripLanding({ trip, onOpen }: { trip: TravelTrip; onOpen: (path: string) => void }) {
  const bookingRows = travelBookingRows(trip).slice(0, 4);
  const ledgerRows = trip.ledgerItems.slice(0, 4);
  return (
    <div className="travel-trip-landing" aria-label={`${trip.title} trip landing summary`}>
      <TravelLandingSection title="Itinerary file" empty="No itinerary brief linked.">
        {trip.briefs.map((brief) => (
          <button type="button" key={brief.path} onClick={() => onOpen(brief.path)}>
            <FileText size={12} /> {brief.title}
            <small>Suggested route, hotel options, local transfers, and booking sequence</small>
          </button>
        ))}
      </TravelLandingSection>
      <TravelLandingSection title="Booking options file" empty="No flight or hotel estimate rows yet.">
        {bookingRows.map((item) => (
          <button type="button" key={item.id} onClick={() => onOpen(bookingPrimaryPath(trip, item))}>
            <Plane size={12} /> {item.item}
            <small>{ledgerEstimateLabel(item)} · opens trip itinerary note</small>
          </button>
        ))}
      </TravelLandingSection>
      <TravelLandingSection title="Calendar events" empty="No dated event linked.">
        {trip.events.slice(0, 3).map((event) => (
          <button type="button" key={event.path} onClick={() => onOpen(event.path)}>
            <CalendarDays size={12} /> {event.title}
            <small>{event.start_date || event.date || event.due || 'TBD'}</small>
          </button>
        ))}
      </TravelLandingSection>
      <TravelLandingSection title="Approval email" empty="No email draft linked.">
        {trip.emailTemplates.map((template) => (
          <button type="button" key={template.path} onClick={() => onOpen(template.path)}>
            <FileText size={12} /> {template.title}
            <small>Approval or booking request draft</small>
          </button>
        ))}
      </TravelLandingSection>
      <TravelLandingSection title="Ledger rows" empty="No ledger rows linked.">
        {ledgerRows.map((item) => (
          <button type="button" key={item.id} onClick={() => onOpen(item.notePath)}>
            <FileText size={12} /> Ledger row: {item.item}
            <small>{ledgerEstimateLabel(item)} estimate · {ledgerActualLabel(item)} actual · opens travel ledger</small>
          </button>
        ))}
      </TravelLandingSection>
      <TravelLandingSection title="Task/source file" empty="No logistics task linked.">
        <button type="button" onClick={() => onOpen(trip.anchor.path)}>
          <ClipboardList size={12} /> {trip.anchor.title}
          <small>Canonical task or travel source note</small>
        </button>
      </TravelLandingSection>
    </div>
  );
}

function TravelLandingSection({ title, empty, children }: { title: string; empty: string; children: ReactNode }) {
  const childArray = Array.isArray(children) ? children.filter(Boolean) : children ? [children] : [];
  return (
    <div className="travel-landing-section">
      <span>{title}</span>
      {childArray.length > 0 ? childArray : <small>{empty}</small>}
    </div>
  );
}

function TravelLedgerTable({ items, onOpen, compact = false }: { items: TravelLedgerItem[]; onOpen: (path: string) => void; compact?: boolean }) {
  if (!items.length) return <p className="muted">No safe ledger rows found. Add rows to the travel ledger note to track totals.</p>;
  const totals = ledgerTotals(items);
  return (
    <div className={`travel-ledger-table${compact ? ' travel-ledger-table-compact' : ''}`} role="table" aria-label="Travel expense ledger">
      <div className="travel-ledger-row travel-ledger-head" role="row">
        <span>Trip</span>
        <span>Item</span>
        <span>Coverage</span>
        <span>Status</span>
        <span>Estimate</span>
        <span>Actual</span>
        <span>Reimbursed</span>
        <span>Net owed</span>
      </div>
      {items.map((item) => (
        <button type="button" className="travel-ledger-row" role="row" key={item.id} onClick={() => onOpen(item.notePath)} title={item.source || item.item}>
          <span>{item.tripTitle}</span>
          <span>{item.item}<small>{item.category.replace(/_/g, ' ')}{item.reimbursable ? '' : ' · not reimbursable'}</small></span>
          <span className={`travel-ledger-coverage ${item.countsAgainstResearchAccount ? 'account' : 'external'}`}>
            {ledgerCoverageShort(item)}<small>{item.countsAgainstResearchAccount ? 'counts toward account' : 'excluded'}</small>
          </span>
          <span><StatusChip value={item.status.replace(/_/g, ' ')} /></span>
          <span>{ledgerEstimateLabel(item)}</span>
          <span>{ledgerActualLabel(item)}</span>
          <span>{ledgerReimbursedLabel(item)}</span>
          <span>{moneyLabel(ledgerCurrentNetUsd(item))}</span>
        </button>
      ))}
      <div className="travel-ledger-row travel-ledger-total" role="row">
        <span>Totals</span>
        <span><small>{items.length} rows</small></span>
        <span className="travel-ledger-coverage account">Account {moneyLabel(totals.accountActual)}<small>host/ext {moneyLabel(totals.externalActual)}</small></span>
        <span aria-hidden="true" />
        <span>{moneyLabel(totals.estimate)}</span>
        <span>{moneyLabel(totals.actual)}</span>
        <span>{moneyLabel(totals.reimbursed)}</span>
        <span>{moneyLabel(totals.net)}</span>
      </div>
    </div>
  );
}

function ledgerCoverageShort(item: TravelLedgerItem): string {
  if (item.countsAgainstResearchAccount) return 'Research account';
  const src = item.coverageSource || '';
  if (/host/i.test(src)) return src.replace(/\s*\(host\)\s*/i, '').trim();
  if (/cancel/i.test(src)) return 'cancelled';
  if (/local|no cost/i.test(src)) return 'no cost';
  return src || (item.reimbursable ? 'source TBD' : 'not reimbursable');
}

function ledgerTotals(items: TravelLedgerItem[]) {
  const sum = (pick: (i: TravelLedgerItem) => number) => items.reduce((acc, i) => acc + pick(i), 0);
  const actual = sum((i) => i.actualUsd || 0);
  const accountActual = sum((i) => (i.countsAgainstResearchAccount ? (i.actualUsd || 0) : 0));
  return {
    estimate: sum((i) => i.estimateUsd || 0),
    actual,
    reimbursed: sum((i) => (['reimbursed', 'paid', 'complete', 'done'].includes(i.status.toLowerCase()) ? (i.reimbursedAmountUsd || 0) : 0)),
    net: sum((i) => ledgerCurrentNetUsd(i)),
    accountActual,
    externalActual: actual - accountActual,
  };
}

function ledgerEstimateLabel(item: TravelLedgerItem): string {
  if (item.estimateUsd !== null) return moneyLabel(item.estimateUsd);
  if (item.estimate !== null) return moneyLabel(item.estimate, item.currency);
  return '-';
}

function ledgerActualLabel(item: TravelLedgerItem): string {
  if (item.actual === null) return item.actualUsd !== null ? moneyLabel(item.actualUsd) : '-';
  return moneyLabel(item.actual, item.currency);
}

function ledgerReimbursedLabel(item: TravelLedgerItem): string {
  if (item.reimbursedAmount !== null) return moneyLabel(item.reimbursedAmount, item.currency);
  if (item.reimbursedAmountUsd !== null) return moneyLabel(item.reimbursedAmountUsd);
  return '-';
}

function ledgerCoverageLabel(item: TravelLedgerItem): string {
  if (item.countsAgainstResearchAccount) return 'Research travel account';
  if (item.coverageSource) return item.coverageSource.replace(/_/g, ' ');
  if (item.budgetAccount) return item.budgetAccount.replace(/_/g, ' ');
  return item.reimbursable ? 'reimbursable source TBD' : 'not reimbursable';
}

function ledgerCurrentNetUsd(item: TravelLedgerItem): number {
  const actual = item.actualUsd || 0;
  const status = item.status.toLowerCase();
  const received = ['reimbursed', 'paid', 'complete', 'done'].includes(status) ? item.reimbursedAmountUsd || 0 : 0;
  return Math.max(0, actual - received);
}

function isTravelLedgerFile(entry: VaultEntry | null, file: VaultFile | null): boolean {
  const kind = String(file?.frontmatter?.kind || entry?.kind || '').toLowerCase();
  return kind === 'travel-ledger';
}

function isTravelItineraryFile(entry: VaultEntry | null, file: VaultFile | null): boolean {
  const path = file?.path || entry?.path || '';
  const kind = String(file?.frontmatter?.kind || entry?.kind || '').toLowerCase();
  const title = String(file?.frontmatter?.title || entry?.title || '').toLowerCase();
  if (isTravelLedgerFile(entry, file)) return false;
  if (path.includes('/private/')) return false;
  return kind.includes('travel') || kind === 'itinerary' || /itinerary|routing|logistics|booking/.test(title);
}

function travelLedgerRowsFromFile(file: VaultFile, content: string): TravelLedgerItem[] {
  const fileFrontmatter = file.frontmatter || {};
  const fallbackFrontmatter = frontmatterFromContent(content, fileFrontmatter);
  const frontmatter = Array.isArray(fileFrontmatter.ledger) ? fileFrontmatter : fallbackFrontmatter;
  const entry: VaultEntry = {
    path: file.path,
    filename: file.path.split('/').pop() || file.path,
    title: scalarDisplay(frontmatter.title) || 'Travel expense ledger',
    kind: scalarDisplay(frontmatter.kind) || 'travel-ledger',
    project: scalarDisplay(frontmatter.project) || 'travel',
    properties: frontmatter,
  };
  return parseLedgerRows(entry);
}

function numberFromMetadata(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/[$,]/g, '').trim());
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function travelLedgerTripGroups(items: TravelLedgerItem[]): Array<{
  key: string;
  title: string;
  items: TravelLedgerItem[];
  planned: number;
  actual: number;
  reimbursed: number;
}> {
  const groups = new Map<string, TravelLedgerItem[]>();
  for (const item of items) {
    const key = item.tripKey || item.tripTitle || item.id;
    groups.set(key, [...(groups.get(key) || []), item]);
  }
  return [...groups.entries()].map(([key, groupItems]) => ({
    key,
    title: groupItems[0]?.tripTitle || key,
    items: groupItems,
    planned: groupItems.reduce((sum, item) => sum + (item.estimateUsd || 0), 0),
    actual: groupItems.reduce((sum, item) => sum + (item.actualUsd || 0), 0),
    reimbursed: groupItems.reduce((sum, item) => sum + (item.reimbursedAmountUsd || 0), 0),
  }));
}

function travelLedgerCategoryIcon(item: TravelLedgerItem) {
  const text = `${item.category} ${item.item}`.toLowerCase();
  if (/\b(flight|transport|airfare|airport|rail|train)\b/.test(text)) return <Plane size={15} />;
  if (/\b(hotel|lodging|room|accommodation)\b/.test(text)) return <Home size={15} />;
  return <FileText size={15} />;
}

interface ParsedMarkdownTable {
  heading: string;
  headers: string[];
  rows: string[][];
}

function cleanMarkdownInline(value: string): string {
  return value
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[\[([^\]|]+)\|?([^\]]*)\]\]/g, (_match, path, label) => label || path)
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitMarkdownTableRow(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cleanMarkdownInline(cell));
}

function parseMarkdownTables(content: string): ParsedMarkdownTable[] {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const tables: ParsedMarkdownTable[] = [];
  let heading = '';
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] || '';
    const headingMatch = line.match(/^#{2,4}\s+(.+)$/);
    if (headingMatch) {
      heading = cleanMarkdownInline(headingMatch[1] || '');
      continue;
    }
    const next = lines[index + 1] || '';
    if (!line.trim().startsWith('|') || !/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(next)) continue;
    const headers = splitMarkdownTableRow(line);
    const rows: string[][] = [];
    index += 2;
    while (index < lines.length && (lines[index] || '').trim().startsWith('|')) {
      rows.push(splitMarkdownTableRow(lines[index] || ''));
      index += 1;
    }
    index -= 1;
    tables.push({ heading, headers, rows });
  }
  return tables;
}

function parseMarkdownBullets(content: string, headingPattern: RegExp): string[] {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const bullets: string[] = [];
  let active = false;
  for (const line of lines) {
    const headingMatch = line.match(/^#{2,4}\s+(.+)$/);
    if (headingMatch) {
      active = headingPattern.test(headingMatch[1] || '');
      continue;
    }
    if (active) {
      const bulletMatch = line.match(/^\s*[-*]\s+(.+)$/);
      if (bulletMatch) bullets.push(cleanMarkdownInline(bulletMatch[1] || ''));
    }
  }
  return bullets.slice(0, 5);
}

function markdownTitle(file: VaultFile, content: string): string {
  const frontmatterTitle = scalarDisplay(file.frontmatter?.title);
  if (frontmatterTitle) return frontmatterTitle;
  return cleanMarkdownInline(content.match(/^#\s+(.+)$/m)?.[1] || file.path.split('/').pop()?.replace(/\.md$/, '') || 'Travel itinerary');
}

function tableMatches(table: ParsedMarkdownTable, pattern: RegExp): boolean {
  return pattern.test(`${table.heading} ${table.headers.join(' ')}`.toLowerCase());
}

function tableCostValue(row: string[]): string {
  return row.find((cell) => /\$|€|eur|usd|about|reprice|\d/.test(cell.toLowerCase())) || row[1] || '-';
}

export function TravelItineraryVisualPreview({ file, content, onOpen }: { file: VaultFile; content: string; onOpen: (path: string) => void }) {
  const title = markdownTitle(file, content);
  const tables = parseMarkdownTables(content);
  const statusBullets = parseMarkdownBullets(content, /current status|trip purpose|fixed constraints|hard constraints/i);
  const itinerary = tables.find((table) => tableMatches(table, /book-ready itinerary|itinerary|routing/)) || null;
  const optionTables = tables
    .filter((table) => table !== itinerary && tableMatches(table, /flight|hotel|lodging|specific options|shortlist|airport|transfer/))
    .slice(0, 3);
  const costTable = tables.find((table) => tableMatches(table, /approval cost snapshot|cost|estimate|planning estimate/)) || null;
  const related = [...String(content).matchAll(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g)]
    .map((match) => match[1] || '')
    .filter((path) => path.endsWith('.md'))
    .slice(0, 5);

  return (
    <section className="travel-itinerary-visual" aria-label="Visual travel itinerary">
      <header className="travel-itinerary-visual-hero">
        <div>
          <span className="eyebrow">Travel itinerary</span>
          <h1>{title}</h1>
          <p>{scalarDisplay(file.frontmatter?.destination) || scalarDisplay(file.frontmatter?.project) || 'Travel'} · {scalarDisplay(file.frontmatter?.status) || 'planning'}</p>
        </div>
        <div className="travel-itinerary-visual-meta">
          <ProjectMetric label="Start" value={scalarDisplay(file.frontmatter?.start_date) || scalarDisplay(file.frontmatter?.date) || 'TBD'} />
          <ProjectMetric label="End" value={scalarDisplay(file.frontmatter?.end_date) || 'TBD'} />
          <ProjectMetric label="Kind" value={scalarDisplay(file.frontmatter?.kind) || 'travel note'} />
        </div>
      </header>

      {statusBullets.length > 0 && (
        <div className="travel-itinerary-status-strip">
          {statusBullets.map((bullet) => <span key={bullet}>{bullet}</span>)}
        </div>
      )}

      {itinerary && (
        <section className="travel-itinerary-visual-card">
          <ProjectSectionTitle title={itinerary.heading || 'Book-ready itinerary'} meta={`${itinerary.rows.length} planning segments`} />
          <div className="travel-itinerary-visual-timeline">
            {itinerary.rows.slice(0, 8).map((row, index) => (
              <article key={`${row[0]}-${index}`} className="travel-itinerary-visual-step">
                <span>{row[0] || `Step ${index + 1}`}</span>
                <strong>{row[1] || row[0] || 'Plan item'}</strong>
                {row[2] && <p>{row[2]}</p>}
              </article>
            ))}
          </div>
        </section>
      )}

      <div className="travel-itinerary-visual-grid">
        {optionTables.map((table) => (
          <section key={`${table.heading}-${table.headers.join('-')}`} className="travel-itinerary-visual-card">
            <ProjectSectionTitle title={table.heading || 'Booking options'} meta={`${table.rows.length} options`} />
            <div className="travel-itinerary-option-list">
              {table.rows.slice(0, 5).map((row, index) => (
                <article key={`${row[0]}-${index}`} className="travel-itinerary-option">
                  <span>{row[0] || table.headers[0] || `Option ${index + 1}`}</span>
                  <strong>{row[1] || row[0] || 'Option'}</strong>
                  {row[2] && <p>{row[2]}</p>}
                  {row[3] && <small>{row[3]}</small>}
                </article>
              ))}
            </div>
          </section>
        ))}

        {costTable && (
          <section className="travel-itinerary-visual-card">
            <ProjectSectionTitle title={costTable.heading || 'Cost snapshot'} meta="Estimate only" />
            <div className="travel-itinerary-cost-grid">
              {costTable.rows.slice(0, 6).map((row, index) => (
                <article key={`${row[0]}-${index}`}>
                  <span>{row[0] || 'Item'}</span>
                  <strong>{tableCostValue(row)}</strong>
                  {row[2] && <small>{row[2]}</small>}
                </article>
              ))}
            </div>
          </section>
        )}
      </div>

      {related.length > 0 && (
        <section className="travel-itinerary-related">
          <span>Linked planning files</span>
          <div>
            {related.map((path) => (
              <button key={path} type="button" onClick={() => onOpen(path)}>
                <FileText size={12} /> {path.split('/').pop()?.replace(/\.md$/, '') || path}
              </button>
            ))}
          </div>
        </section>
      )}

      <details className="travel-itinerary-source-note">
        <summary>Source Markdown</summary>
        <Suspense fallback={<div className="preview-lazy-fallback">Rendering source note...</div>}>
          <MarkdownRenderer content={content} />
        </Suspense>
      </details>
    </section>
  );
}

export function TravelLedgerVisualPreview({ file, content, onOpen }: { file: VaultFile; content: string; onOpen: (path: string) => void }) {
  const items = travelLedgerRowsFromFile(file, content);
  const groups = travelLedgerTripGroups(items);
  const planned = items.reduce((sum, item) => sum + (item.estimateUsd || 0), 0);
  const actual = items.reduce((sum, item) => sum + (item.actualUsd || 0), 0);
  const reimbursed = items.reduce((sum, item) => sum + (item.reimbursedAmountUsd || 0), 0);
  const researchAccountLimit = numberFromMetadata(file.frontmatter?.research_account_limit_usd) || 12000;
  const researchAccountPlanned = items
    .filter((item) => item.countsAgainstResearchAccount)
    .reduce((sum, item) => sum + (item.actualUsd || item.estimateUsd || 0), 0);

  if (!items.length) {
    return (
      <section className="travel-ledger-visual travel-ledger-visual-empty">
        <h1>Travel planning board</h1>
        <p>No structured ledger rows were found. Add rows to the ledger frontmatter to see itinerary and booking cards here.</p>
      </section>
    );
  }

  return (
    <section className="travel-ledger-visual" aria-label="Travel ledger visual planning board">
      <header className="travel-ledger-visual-hero">
        <div>
          <span className="eyebrow">Travel ledger preview</span>
          <h1>Suggested itinerary and booking board</h1>
          <p>Grouped from the travel ledger. Use the Itinerary buttons for the trip-specific flight/hotel note; Private buttons open local-only booking-cart details where they exist.</p>
        </div>
        <div className="travel-ledger-visual-metrics" aria-label="Travel ledger totals">
          <ProjectMetric label="Trips" value={String(groups.length)} />
          <ProjectMetric label="Planned" value={moneyLabel(planned)} />
          <ProjectMetric label="Actual" value={moneyLabel(actual)} />
          <ProjectMetric label="Reimbursed" value={moneyLabel(reimbursed)} />
          <ProjectMetric label="Research account" value={`${percentLabel((researchAccountPlanned / researchAccountLimit) * 100)} of ${moneyLabel(researchAccountLimit)}`} />
        </div>
      </header>

      <div className="travel-ledger-trip-grid">
        {groups.map((group) => (
          <article key={group.key} className="travel-ledger-trip-card">
            <header className="travel-ledger-trip-head">
              <div>
                <span>{group.items.length} item{group.items.length === 1 ? '' : 's'}</span>
                <h2>{group.title}</h2>
              </div>
              <div className="travel-ledger-trip-totals">
                <strong>{moneyLabel(group.planned)}</strong>
                <small>planned{group.actual > 0 ? ` · ${moneyLabel(group.actual)} actual` : ''}</small>
                {travelItineraryPath(null, group.items[0]) && (
                  <button type="button" onClick={() => onOpen(travelItineraryPath(null, group.items[0]))}>
                    <Plane size={12} /> Itinerary
                  </button>
                )}
              </div>
            </header>

            <div className="travel-ledger-trip-rows">
              {group.items.map((item) => (
                <div key={item.id} className="travel-ledger-trip-row">
                  <div className="travel-ledger-trip-icon" aria-hidden="true">{travelLedgerCategoryIcon(item)}</div>
                  <div className="travel-ledger-trip-row-main">
                    <span>{item.category.replace(/_/g, ' ')}</span>
                    <strong>{item.item}</strong>
                    {item.source && <p>{item.source}</p>}
                    <div className="travel-ledger-trip-row-meta">
                      <StatusChip value={item.status.replace(/_/g, ' ')} />
                      <span className="overview-pill estimate-pill">{ledgerEstimateLabel(item)}</span>
                      {item.actualUsd !== null && <span className="overview-pill estimate-pill">{ledgerActualLabel(item)} actual</span>}
                      <span className="overview-pill">{ledgerCoverageLabel(item)}</span>
                    </div>
                  </div>
                  <div className="travel-ledger-trip-actions">
                    {travelItineraryPath(null, item) && (
                      <button type="button" onClick={() => onOpen(travelItineraryPath(null, item))}>
                        <Plane size={12} /> Itinerary
                      </button>
                    )}
                    {(item.privatePointer || item.receiptPointer) && (
                      <button type="button" onClick={() => onOpen(item.privatePointer || item.receiptPointer)}>
                        <ExternalLink size={12} /> Private
                      </button>
                    )}
                    <button type="button" onClick={() => onOpen(item.notePath)}>
                      <FileText size={12} /> Ledger
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

export function RAManagementView({
  data,
  onOpen,
  onPatchTaskMetadata,
  patchingTaskPath,
}: {
  data: RAManagementData;
  onOpen: (path: string) => void;
  onPatchTaskMetadata: (path: string, updates: TaskMetadataUpdates, currentModifiedAt?: number) => Promise<void> | void;
  patchingTaskPath: string;
}) {
  const parkedTasks = uniqueEntries(data.allTasks.filter(isParkedRATask));
  const parkedPaths = new Set(parkedTasks.map((entry) => entry.path));
  const waitingOnRA = uniqueEntries(data.waitingOnRA.filter((entry) => !parkedPaths.has(entry.path)));
  const waitingPaths = new Set(waitingOnRA.map((entry) => entry.path));
  const readyForReviewTasks = uniqueEntries(data.allTasks.filter((entry) => (
    !parkedPaths.has(entry.path) &&
    !waitingPaths.has(entry.path) &&
    isReadyForReviewRATask(entry)
  )));
  const readyPaths = new Set(readyForReviewTasks.map((entry) => entry.path));
  const needsOwner = uniqueEntries(data.needsOwner.filter((entry) => !parkedPaths.has(entry.path) && !readyPaths.has(entry.path)));
  const needsOwnerPaths = new Set(needsOwner.map((entry) => entry.path));
  const dueSoon = uniqueEntries(data.dueSoon.filter((entry) => (
    !parkedPaths.has(entry.path) &&
    !waitingPaths.has(entry.path) &&
    !readyPaths.has(entry.path) &&
    !needsOwnerPaths.has(entry.path)
  )));

  return (
    <section className="work-view ra-management-view">
      <ViewHeader
        eyebrow="Research management"
        title="Collaborators"
        meta={`${data.metrics.activeCollaborators} active collaborators · ${data.metrics.openTasks} open collaborator tasks · ${data.metrics.waiting} waiting`}
        actions={(
          <button onClick={openRAPublicIndex}><ExternalLink size={14} /> Collaborator index</button>
        )}
      />

      <div className="ra-metric-grid" aria-label="Collaborator management summary">
        <ProjectMetric label="Active collaborators" value={String(data.metrics.activeCollaborators)} />
        <ProjectMetric label="Open tasks" value={String(data.metrics.openTasks)} />
        <ProjectMetric label="Needs owner" value={String(needsOwner.length)} />
        <ProjectMetric label="Waiting" value={String(waitingOnRA.length)} />
        <ProjectMetric label="Ready review" value={String(readyForReviewTasks.length)} />
        <ProjectMetric label="Parked" value={String(parkedTasks.length)} />
        <ProjectMetric label="Check-ins" value={String(data.metrics.recentCheckins)} />
      </div>

      <section className="ra-action-board" aria-label="Collaborator coordination cockpit">
        <ProjectSectionTitle title="Action lanes" meta="only active lanes" icon={<UsersRound size={15} />} />
        {(() => {
          const raLanes = [
            { key: 'needs-owner', title: 'Needs owner', detail: 'Manager-owned follow-ups and unblockers', entries: needsOwner, zone: 'zone-danger', icon: <Target size={15} /> },
            { key: 'waiting', title: 'Waiting on RA', detail: 'Assigned out, blocked, or pending RA handoff', entries: waitingOnRA, zone: 'zone-warn', icon: <Clock3 size={15} /> },
            { key: 'due-soon', title: 'Due soon', detail: 'Dated RA items not already in another lane', entries: dueSoon, zone: 'zone-blue', icon: <CalendarDays size={15} /> },
            { key: 'ready', title: 'Ready for review', detail: 'Outputs, repos, packages, and QA handoffs', entries: readyForReviewTasks, zone: 'zone-good', icon: <Check size={15} /> },
            { key: 'parked', title: 'Parked', detail: 'Later, low-priority, or paused RA work', entries: parkedTasks, zone: 'zone-neutral', icon: <Layers size={15} /> },
          ].filter((lane) => lane.entries.length > 0);
          if (raLanes.length === 0) {
            return <p className="muted">All RA action lanes are clear — no follow-ups, waiting items, due-soon work, or deliverables in review.</p>;
          }
          return (
            <div className="ra-lane-grid ra-lane-grid-cockpit">
              {raLanes.map((lane) => (
                <RATaskLane
                  key={lane.key}
                  title={lane.title}
                  detail={lane.detail}
                  zone={lane.zone}
                  icon={lane.icon}
                  entries={lane.entries.slice(0, 8)}
                  onOpen={onOpen}
                  onPatch={onPatchTaskMetadata}
                  patchingTaskPath={patchingTaskPath}
                  empty=""
                />
              ))}
            </div>
          );
        })()}
      </section>

      {data.records.length === 0 ? (
        <section className="project-work-panel">
          <ProjectSectionTitle title="RA roster" meta="0 records" />
          <p className="muted">No RA records are visible under the current private-mode filter.</p>
        </section>
      ) : (
        <section className="ra-roster-grid" aria-label="Collaborator workload overview">
          {data.records.map((record) => (
            <RARecordCard
              key={record.slug}
              record={record}
              onOpen={onOpen}
              onPatchTaskMetadata={onPatchTaskMetadata}
              patchingTaskPath={patchingTaskPath}
            />
          ))}
        </section>
      )}

      <details className="project-work-panel ra-secondary-drawer">
        <summary>
          <span>
            <strong>Recent collaborator activity</strong>
            <small>Check-ins, assignments, and communication drafts</small>
          </span>
          <b>{data.recentMemory.length}</b>
        </summary>
        <div className="ra-memory-panel">
          <ProjectSectionTitle title="Recent collaborator activity" meta={`${data.recentMemory.length} notes`} />
          <RAMemoryList entries={data.recentMemory.slice(0, 10)} onOpen={onOpen} />
        </div>
      </details>
    </section>
  );
}

function raTaskText(entry: VaultEntry): string {
  return [
    entry.title,
    entry.status,
    entry.next,
    entry.snippet,
    entry.path,
    entry.kind,
    entry.type,
    taskAssignee(entry),
  ].filter(Boolean).join(' ').toLowerCase();
}

function isParkedRATask(entry: VaultEntry): boolean {
  const status = String(entry.status || '').toLowerCase();
  const priority = Number(entry.priority || 0);
  return ['someday', 'later', 'parked', 'paused'].some((token) => status.includes(token)) ||
    entry.path.includes('/someday/') ||
    priority >= 4;
}

function isReadyForReviewRATask(entry: VaultEntry): boolean {
  return /\b(review|ready|handoff|output|outputs|package|replication|manifest|qa|validate|validation|repo|script|deliverable)\b/.test(raTaskText(entry));
}

function taskWaitingForRAReview(entry: VaultEntry): boolean {
  const status = String(entry.status || '').toLowerCase();
  return ['waiting', 'blocked', 'pending'].some((token) => status.includes(token));
}

function raEntryDateText(entry?: VaultEntry): string {
  if (!entry) return 'none';
  return entry.due || entry.date || entry.start_date || 'undated';
}

function currentRADeliverable(record: RARecord): VaultEntry | undefined {
  return record.waitingOnRA.find((task) => !isParkedRATask(task)) ||
    record.needsOwner.find((task) => !isParkedRATask(task) && isReadyForReviewRATask(task)) ||
    record.dueSoon.find((task) => !isParkedRATask(task)) ||
    record.tasks.find((task) => !isParkedRATask(task));
}

function raRecordBlocker(record: RARecord): VaultEntry | undefined {
  return record.waitingOnRA.find((task) => !isParkedRATask(task)) ||
    record.tasks.find((task) => taskWaitingForRAReview(task) && !isParkedRATask(task));
}

function raRecordLastTouched(record: RARecord): string {
  const datedEntries = [
    record.latestCheckin,
    record.currentDraft,
    record.assignments[0]?.entry,
    record.tasks[0],
  ].filter(Boolean) as VaultEntry[];
  const latest = datedEntries
    .map((entry) => entry.date || entry.due || entry.start_date || entry.modified_at)
    .find(Boolean);
  return latest ? String(latest) : 'none';
}

function raRecordDueText(record: RARecord): string {
  return raEntryDateText(record.dueSoon[0] || record.tasks.find((task) => task.due));
}

function raDeliverableQAItems(record: RARecord): Array<{ label: string; value: string }> {
  const deliverable = currentRADeliverable(record);
  const text = deliverable ? raTaskText(deliverable) : '';
  return [
    { label: 'Expected output', value: deliverable?.title || 'No active deliverable listed' },
    { label: 'Repo / path', value: deliverable?.path || record.person?.path || 'Not recorded' },
    { label: 'Run command', value: /\b(command|script|repo|replication|package)\b/.test(text) ? 'Check package instructions' : 'Not recorded' },
    { label: 'Data restrictions', value: /\b(attachment|raw|licensed|proprietary)\b/.test(text) ? 'Keep restricted data out of Markdown' : 'No special restriction flagged' },
    { label: 'Validation', value: /\b(validate|validation|qa|check|review)\b/.test(text) ? 'Review required' : 'Not recorded' },
    { label: 'Handoff', value: record.currentDraft?.title || record.latestCheckin?.title || 'No handoff note listed' },
  ];
}

function RARecordCard({
  record,
  onOpen,
  onPatchTaskMetadata,
  patchingTaskPath,
}: {
  record: RARecord;
  onOpen: (path: string) => void;
  onPatchTaskMetadata: (path: string, updates: TaskMetadataUpdates, currentModifiedAt?: number) => Promise<void> | void;
  patchingTaskPath: string;
}) {
  const personPath = record.person?.path;
  const deliverable = currentRADeliverable(record);
  const blocker = raRecordBlocker(record);
  const qaItems = raDeliverableQAItems(record);
  return (
    <article className="ra-card">
      <header className="ra-card-header">
        <div className="ra-card-title">
          <span className="project-map-dot" aria-hidden="true" />
          <div>
            <h2>{record.name}</h2>
            <span>{record.status || 'active'} · {record.assignments.length} assignments</span>
          </div>
        </div>
        <div className="ra-card-actions">
          {personPath && <button onClick={() => onOpen(personPath)}><FileText size={14} /> File</button>}
          <button onClick={() => openRAPublicPage(record)}><ExternalLink size={14} /> Collaborator page</button>
        </div>
      </header>

      <p className="ra-focus">{record.focus}</p>

      <div className="ra-scorecard-grid" aria-label={`${record.name} coordination scorecard`}>
        <div>
          <span>Current deliverable</span>
          <strong>{deliverable?.title || 'No active deliverable'}</strong>
          <small>{raEntryDateText(deliverable)}</small>
        </div>
        <div>
          <span>Blocker</span>
          <strong>{blocker?.title || 'No blocker listed'}</strong>
          <small>{blocker ? taskAssignee(blocker) || blocker.status || 'waiting' : 'clear'}</small>
        </div>
        <div>
          <span>Next check-in</span>
          <strong>{record.latestCheckin?.title || 'No check-in note'}</strong>
          <small>{raEntryDateText(record.latestCheckin)}</small>
        </div>
        <div>
          <span>Due date</span>
          <strong>{raRecordDueText(record)}</strong>
          <small>{record.dueSoon.length ? `${record.dueSoon.length} due soon` : 'no imminent due date'}</small>
        </div>
      </div>

      <details className="ra-deliverable-qa ra-card-qa-drawer">
        <summary>
          <span>Deliverable QA</span>
          <small>{deliverable ? 'expected output · repo · validation · handoff' : 'no active output'}</small>
        </summary>
        <dl>
          {qaItems.map((item) => (
            <div key={item.label}>
              <dt>{item.label}</dt>
              <dd>{item.value}</dd>
            </div>
          ))}
        </dl>
      </details>

      <div className="ra-card-links">
        {record.latestCheckin && (
          <button onClick={() => onOpen(record.latestCheckin?.path || '')}>
            <span>Latest check-in</span>
            <strong>{record.latestCheckin.title}</strong>
          </button>
        )}
        {record.currentDraft && (
          <button onClick={() => onOpen(record.currentDraft?.path || '')}>
            <span>Current draft</span>
            <strong>{record.currentDraft.title}</strong>
          </button>
        )}
      </div>

      <details className="ra-card-task-drawer">
        <summary>
          <span>Open collaborator tasks</span>
          <b>{record.tasks.length}</b>
        </summary>
        <ProjectTaskList
          entries={record.tasks.slice(0, 6)}
          onOpen={onOpen}
          onPatch={onPatchTaskMetadata}
          patchingTaskPath={patchingTaskPath}
          empty="No open tasks matched to this collaborator."
        />
      </details>
    </article>
  );
}

function RATaskLane({
  title,
  detail,
  entries,
  onOpen,
  onPatch,
  patchingTaskPath,
  empty,
  zone = 'zone-neutral',
  icon,
}: {
  title: string;
  detail: string;
  entries: VaultEntry[];
  onOpen: (path: string) => void;
  onPatch: (path: string, updates: TaskMetadataUpdates, currentModifiedAt?: number) => Promise<void> | void;
  patchingTaskPath: string;
  empty: string;
  zone?: string;
  icon?: ReactNode;
}) {
  return (
    <section className={`zone-card ${zone} ra-task-lane`}>
      <TriageLaneTitle title={title} detail={detail} count={entries.length} icon={icon} />
      <ProjectTaskList entries={entries} onOpen={onOpen} onPatch={onPatch} patchingTaskPath={patchingTaskPath} empty={empty} />
    </section>
  );
}

function RAMemoryList({ entries, onOpen }: { entries: VaultEntry[]; onOpen: (path: string) => void }) {
  if (!entries.length) return <p className="muted">No collaborator activity found.</p>;
  return (
    <div className="ra-memory-list">
      {entries.map((entry) => (
        <button key={entry.path} onClick={() => onOpen(entry.path)}>
          <span>{entry.date || entry.due || entryLens(entry)}</span>
          <strong>{entry.title}</strong>
          <small>{entry.snippet || entry.path}</small>
        </button>
      ))}
    </div>
  );
}

export function HealthReviewView({
  data,
  entries,
  privateMode,
  onOpen,
  onPatchTaskMetadata,
  patchingTaskPath,
}: {
  data: WorkbenchData;
  entries?: VaultEntry[];
  privateMode: boolean;
  onOpen: (path: string) => void;
  onPatchTaskMetadata: (path: string, updates: TaskMetadataUpdates, currentModifiedAt?: number) => Promise<void> | void;
  patchingTaskPath: string;
}) {
  const sourceEntries = entries || data.visibleEntries;
  const health = useMemo(() => buildHealthReview(sourceEntries), [sourceEntries]);
  const redactedCount = privateMode ? health.privateEntryCount : 0;

  return (
    <section className="work-view health-review-view">
      <ViewHeader
        eyebrow="Personal review"
        title="Wellness"
        meta={`${health.openTasks.length} open wellness tasks · ${health.dueSoonTasks.length} due soon · ${health.routineNotes.length} routine notes${privateMode ? ' · redacted summary' : ` · ${privateVisibleLabel}`}`}
      />

      <section className="health-privacy-card">
        <Shield size={18} aria-hidden="true" />
        <div>
          <strong>{privateMode ? 'Redacted wellness summary is on.' : 'Private wellness details are visible.'}</strong>
          <p>{privateMode ? `${redactedCount} private wellness entries are counted but titles, paths, snippets, and note details stay hidden.` : 'Use the Private toggle before screen sharing. Keep this panel status-only, not diagnostic.'}</p>
        </div>
      </section>

      <div className="health-metric-grid" aria-label="Wellness review summary">
        {health.metrics.map((metric) => (
          <div className="health-metric" key={metric.id}>
            <span>{metric.label}</span>
            <strong>{metric.value}</strong>
            <small>{metric.detail}</small>
          </div>
        ))}
      </div>

      <HealthFitnessPlanOverview weeks={health.fitnessCalendar} privateMode={privateMode} onOpen={onOpen} />
      <HealthFitnessCalendar weeks={health.fitnessCalendar} privateMode={privateMode} onOpen={onOpen} />
      <HealthStravaPanel summary={health.stravaSummary} privateMode={privateMode} onOpen={onOpen} />
      <HealthLogTrendPanel trends={health.healthLogTrends} privateMode={privateMode} onOpen={onOpen} />

      <div className="health-review-grid">
        <section className="zone-good project-work-panel health-focus-panel">
          <ProjectSectionTitle title="Current wellness queue" meta={`${health.openTasks.length} tasks`} icon={<HeartPulse size={15} />} />
          <div className="health-category-list">
            {health.taskGroups.map((group) => (
              <HealthTaskGroupPanel
                key={group.id}
                group={group}
                privateMode={privateMode}
                onOpen={onOpen}
                onPatch={onPatchTaskMetadata}
                patchingTaskPath={patchingTaskPath}
              />
            ))}
          </div>
        </section>

        <section className="zone-accent project-work-panel">
          <ProjectSectionTitle title="Routines and assets" meta={`${health.routineNotes.length} notes`} icon={<RefreshCcw size={15} />} />
          <div className="health-routine-card-grid">
            {health.routineCards.map((card) => (
              <HealthRoutineCardButton key={card.id} card={card} privateMode={privateMode} onOpen={onOpen} />
            ))}
          </div>
        </section>

        <section className="zone-neutral project-work-panel">
          <ProjectSectionTitle title="Recent health memory" meta={`${health.recentMemory.length} shown`} icon={<Activity size={15} />} />
          <HealthMemoryList entries={health.recentMemory} privateMode={privateMode} onOpen={onOpen} />
        </section>

        <section className="zone-warn project-work-panel health-guardrail-panel">
          <ProjectSectionTitle title="Privacy guardrails" meta="status only" icon={<Shield size={15} />} />
          <ul>
            <li>Status only in tracked Markdown: booked, checked, attended, rescheduled, or follow-up needed.</li>
            <li>Fitness charts use public-safe aggregate summaries; source paths and raw activity files stay hidden when private mode is on.</li>
            <li>Private task titles and health-log values stay redacted unless private details are visible.</li>
            <li>No symptoms, diagnoses, portal text, payment details, or confirmation details.</li>
            <li>Use source record, calendar, and provider portals as the private source of truth.</li>
          </ul>
        </section>
      </div>
    </section>
  );
}

function fitnessKindLabel(kind: string): string {
  if (kind === 'cardio') return 'Cardio';
  if (kind === 'strength') return 'Strength';
  if (kind === 'yoga') return 'Yoga';
  if (kind === 'recovery') return 'Recovery';
  if (kind === 'rest') return 'Rest';
  return kind;
}

function fitnessDurationMinutes(duration: string): number {
  const values = duration.match(/\d+/g)?.map((value) => Number(value)).filter(Number.isFinite) || [];
  if (!values.length) return 0;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function formatFitnessMinutes(minutes: number): string {
  if (!minutes) return 'light';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

function formatNullableNumber(value: number | null, suffix = ''): string {
  return value === null ? '-' : `${value}${suffix}`;
}

function HealthLogTrendPanel({
  trends,
  privateMode,
  onOpen,
}: {
  trends: ReturnType<typeof buildHealthReview>['healthLogTrends'];
  privateMode: boolean;
  onOpen: (path: string) => void;
}) {
  const latest = trends.latest;
  const hasPrivateObservations = trends.observations.some((item) => item.private);
  const redactValues = privateMode && hasPrivateObservations;
  return (
    <section className="zone-blue project-work-panel health-log-trend-panel">
      <ProjectSectionTitle
        title="Health log trends"
        meta={trends.observations.length ? `${trends.observations.length} structured observations` : 'needs more filled logs'}
        icon={<Activity size={15} />}
      />
      <div className="health-log-trend-grid" aria-label="Health log trend summary">
        <div>
          <span>Sleep observations</span>
          <strong>{redactValues ? '-' : trends.sleepCount}</strong>
          <small>{redactValues ? 'private details hidden' : formatNullableNumber(trends.averageSleepHours, 'h avg')}</small>
        </div>
        <div>
          <span>Energy observations</span>
          <strong>{redactValues ? '-' : trends.energyCount}</strong>
          <small>{redactValues ? 'private details hidden' : formatNullableNumber(trends.averageEnergy, '/5 avg')}</small>
        </div>
        <div>
          <span>Symptom observations</span>
          <strong>{redactValues ? '-' : trends.symptomCount}</strong>
          <small>{redactValues ? 'private details hidden' : 'count/severity only'}</small>
        </div>
      </div>
      {latest ? (
        <button className="health-log-latest" onClick={() => !redactValues && onOpen(latest.sourcePath)} disabled={redactValues}>
          <span>{redactValues ? 'Latest private log' : latest.date}</span>
          <strong>{redactValues ? 'Health log values hidden' : `${formatNullableNumber(latest.sleepHours, 'h sleep')} · energy ${formatNullableNumber(latest.energy)}`}</strong>
          <small>{redactValues ? 'Show private details to open the source log.' : latest.symptomCount !== null ? `${latest.symptomCount} symptom entries` : 'No symptom count recorded'}</small>
        </button>
      ) : (
        <p className="muted">No filled sleep, energy, or symptom values found yet. Blank template rows are ignored.</p>
      )}
    </section>
  );
}

function HealthFitnessPlanOverview({
  weeks,
  privateMode,
  onOpen,
}: {
  weeks: ReturnType<typeof buildHealthReview>['fitnessCalendar'];
  privateMode: boolean;
  onOpen: (path: string) => void;
}) {
  const items = weeks.flatMap((week) => week.items);
  if (!items.length) return null;
  const today = calendarIso();
  const kindOrder = ['cardio', 'strength', 'yoga', 'recovery', 'rest'] as const;
  const kindStats = kindOrder.map((kind) => ({
    kind,
    label: fitnessKindLabel(kind),
    count: items.filter((item) => item.kind === kind).length,
  })).filter((item) => item.count > 0);
  const weekLoads = weeks.map((week) => {
    const minutes = week.items.reduce((sum, item) => sum + fitnessDurationMinutes(item.duration), 0);
    return {
      week: week.week,
      label: week.week === 1 ? 'Week 1' : 'Week 2',
      detail: week.label,
      minutes,
      sessions: week.items.length,
    };
  });
  const maxMinutes = Math.max(...weekLoads.map((week) => week.minutes), 1);
  const todayItem = items.find((item) => item.date === today);
  const visibleToday = todayItem && (!privateMode || !todayItem.private);
  const planStart = weeks[0]?.startDate || '';
  const planEnd = weeks[weeks.length - 1]?.endDate || '';

  return (
    <section className="zone-accent project-work-panel health-plan-visual-panel">
      <ProjectSectionTitle
        title="Fitness plan overview"
        meta={`${items.length} sessions · ${planStart} to ${planEnd}`}
        icon={<Target size={15} />}
      />
      <div className="health-plan-visual-grid">
        <div className={`health-plan-timeline ${privateMode ? 'redacted' : ''}`} aria-label="Fitness plan day strip">
          {items.map((item) => {
            const reveal = !privateMode || !item.private;
            const state = item.date < today ? 'past' : item.date === today ? 'today' : 'upcoming';
            return (
              <button
                type="button"
                key={item.id}
                className={`health-plan-day health-plan-${item.kind} ${state} ${reveal ? '' : 'redacted'}`}
                disabled={!reveal || !item.sourcePath}
                title={reveal ? `${item.dayLabel}: ${item.label}` : 'Private fitness session'}
                onClick={() => reveal && item.sourcePath && onOpen(item.sourcePath)}
              >
                <span>{item.dayLabel.split(',')[0]}</span>
                <i aria-hidden="true" />
                <strong>{reveal ? item.shortLabel : 'Private'}</strong>
                <small>{reveal ? item.duration : 'hidden'}</small>
              </button>
            );
          })}
        </div>

        <div className="health-plan-side">
          <div className="health-plan-today">
            <span>Today</span>
            <strong>{visibleToday ? todayItem.label : todayItem ? 'Private session' : 'No planned session'}</strong>
            <small>{visibleToday ? `${todayItem.duration} · ${fitnessKindLabel(todayItem.kind)}` : todayItem ? 'Details hidden' : 'Use routine notes for ad hoc movement.'}</small>
          </div>
          <div className="health-plan-kind-grid" aria-label="Fitness plan session mix">
            {kindStats.map((stat) => (
              <span key={stat.kind} className={`health-plan-kind health-plan-${stat.kind}`}>
                <b>{stat.count}</b>
                {privateMode ? 'sessions' : stat.label}
              </span>
            ))}
          </div>
          <div className="health-plan-loads" aria-label="Fitness plan weekly load">
            {weekLoads.map((week) => (
              <div className="health-plan-load" key={week.week}>
                <span>{week.label}</span>
                <i style={barStyle(week.minutes, maxMinutes)} />
                <small>{week.sessions} sessions · {formatFitnessMinutes(week.minutes)}</small>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function HealthFitnessCalendar({
  weeks,
  privateMode,
  onOpen,
}: {
  weeks: ReturnType<typeof buildHealthReview>['fitnessCalendar'];
  privateMode: boolean;
  onOpen: (path: string) => void;
}) {
  const itemCount = weeks.reduce((total, week) => total + week.items.length, 0);
  const firstDate = weeks[0]?.startDate || '';
  const lastWeek = weeks[weeks.length - 1];
  const lastDate = lastWeek?.endDate || '';
  const calendarGrid = (
    <div className="health-fitness-calendar">
      {weeks.map((week) => (
        <section className="health-fitness-week" key={week.week}>
          <header>
            <strong>{week.label}</strong>
            <span>{week.startDate} to {week.endDate}</span>
          </header>
          <div className="health-fitness-days">
            {week.items.map((item) => {
              const reveal = !privateMode || !item.private;
              const label = reveal ? item.label : 'Private fitness session';
              return (
                <button
                  key={item.id}
                  className={`health-fitness-day health-fitness-${item.kind} ${reveal ? '' : 'redacted'}`}
                  disabled={!reveal || !item.sourcePath}
                  onClick={() => reveal && item.sourcePath && onOpen(item.sourcePath)}
                >
                  <span>{item.dayLabel}</span>
                  <strong>{label}</strong>
                  <small>{reveal ? `${item.duration}${item.optional ? ' · optional' : ''}` : 'details hidden'}</small>
                  <em>{reveal ? item.detail : 'Health routine details hidden by the view filter.'}</em>
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
  return (
    <section className="zone-blue project-work-panel health-fitness-calendar-panel">
      <ProjectSectionTitle
        title="Fitness plan calendar"
        meta={itemCount ? `${itemCount} sessions · ${firstDate} to ${lastDate}` : 'no structured plan'}
        icon={<CalendarDays size={15} />}
      />
      {!itemCount ? (
        <p className="muted">No structured fitness plan found yet.</p>
      ) : privateMode ? (
        <details className="health-fitness-calendar-disclosure">
          <summary>
            <span>Show redacted session grid</span>
            <b>{itemCount} sessions</b>
          </summary>
          {calendarGrid}
        </details>
      ) : (
        calendarGrid
      )}
    </section>
  );
}

function formatFitnessNumber(value: number, digits = 0): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function monthShortLabel(month: string): string {
  const [year, monthNumber] = month.split('-').map(Number);
  if (!year || !monthNumber) return month;
  return new Date(year, monthNumber - 1, 1).toLocaleDateString('en-US', { month: 'short' });
}

function weekShortLabel(weekStart: string): string {
  const parsed = parseCalendarIso(weekStart);
  if (!parsed) return weekStart;
  return parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function barStyle(value: number, max: number): CSSProperties {
  const width = max > 0 ? Math.max(4, Math.round((value / max) * 100)) : 0;
  return { '--bar': `${width}%` } as CSSProperties;
}

const STRAVA_DONUT_COLORS = ['#4c8f8f', '#ad7c38', '#8b7aa8', '#6b8f4c', '#9a6262', '#6f7f9b'];

function stravaDonutStyle(types: HealthStravaSummary['activityTypes']): CSSProperties {
  const visibleTypes = types.slice(0, 6);
  const total = visibleTypes.reduce((sum, item) => sum + Math.max(item.movingHours, 0), 0);
  if (!total) return { background: 'color-mix(in srgb, var(--line) 75%, transparent)' };
  let cursor = 0;
  const segments = visibleTypes.map((item, index) => {
    const start = cursor;
    const degrees = Math.max(1, (Math.max(item.movingHours, 0) / total) * 360);
    cursor += degrees;
    return `${STRAVA_DONUT_COLORS[index % STRAVA_DONUT_COLORS.length]} ${start.toFixed(1)}deg ${cursor.toFixed(1)}deg`;
  });
  return { background: `conic-gradient(${segments.join(', ')})` };
}

function HealthStravaPanel({
  summary,
  privateMode,
  onOpen,
}: {
  summary: HealthStravaSummary | null;
  privateMode: boolean;
  onOpen: (path: string) => void;
}) {
  if (!summary) return null;
  const sourceReveal = !privateMode || !summary.private;
  const recentMonths = summary.recentMonths.slice(-12);
  const recentWeeks = summary.recentWeeks.slice(-12);
  const maxMonthHours = Math.max(...recentMonths.map((item) => item.movingHours), 0);
  const maxWeekActivities = Math.max(...recentWeeks.map((item) => item.activities), 0);
  const maxTypeHours = Math.max(...summary.activityTypes.slice(0, 7).map((item) => item.movingHours), 0);
  const topActivity = [...summary.activityTypes].sort((a, b) => b.movingHours - a.movingHours || b.activities - a.activities)[0];
  const weeklyPaceActivities = summary.recent90d.activities / 13;
  const weeklyPaceHours = summary.recent90d.movingHours / 13;

  return (
    <section className="zone-good project-work-panel health-strava-panel">
      <ProjectSectionTitle
        title="Strava activity history"
        meta={privateMode && summary.private ? `aggregate-safe · ${summary.totals.activities} activities counted` : `${summary.periodStart} to ${summary.periodEnd}`}
        icon={<Activity size={15} />}
      />
      <div className="health-strava-header">
        <div className="health-strava-kpis" aria-label="Strava aggregate summary">
          <div><span>Activities</span><strong>{formatFitnessNumber(summary.totals.activities)}</strong></div>
          <div><span>Moving time</span><strong>{formatFitnessNumber(summary.totals.movingHours, 1)}h</strong></div>
          <div><span>Distance</span><strong>{formatFitnessNumber(summary.totals.distanceKm, 1)} km</strong></div>
          <div><span>Last 90d</span><strong>{summary.recent90d.activities} / {formatFitnessNumber(summary.recent90d.movingHours, 1)}h</strong></div>
        </div>
        {sourceReveal ? (
          <button type="button" onClick={() => onOpen(summary.sourcePath)}>
            <FileText size={14} /> Open Strava note
          </button>
        ) : (
          <span className="health-aggregate-badge"><Shield size={14} /> Source note hidden</span>
        )}
      </div>

      {privateMode && summary.private ? (
        <div className="health-strava-redacted">
          <Shield size={18} aria-hidden="true" />
          <div>
            <strong>Showing aggregate-safe fitness history.</strong>
            <p>Monthly volume, weekly consistency, and activity mix are displayed from summarized Strava metadata; raw routes, workout files, source paths, and note text stay hidden.</p>
          </div>
        </div>
      ) : null}

      <div className="health-strava-insights" aria-label="Strava training insights">
        <div>
          <span>90d weekly pace</span>
          <strong>{formatFitnessNumber(weeklyPaceActivities, 1)} activities</strong>
          <small>{formatFitnessNumber(weeklyPaceHours, 1)}h per week</small>
        </div>
        <div>
          <span>Main mode</span>
          <strong>{topActivity?.type || 'None'}</strong>
          <small>{topActivity ? `${topActivity.activities} activities · ${formatFitnessNumber(topActivity.movingHours, 1)}h` : 'No typed activity data'}</small>
        </div>
        <div>
          <span>Recent window</span>
          <strong>{summary.recent90d.activities} activities</strong>
          <small>{formatFitnessNumber(summary.recent90d.distanceKm, 1)} km · {formatFitnessNumber(summary.recent90d.elevationGainM)} m gain</small>
        </div>
      </div>

      <div className="health-strava-visual-grid">
        <section className="health-strava-card">
          <header>
            <strong>Monthly volume</strong>
            <span>moving hours, last 12 months</span>
          </header>
          <div className="health-strava-months" aria-label="Strava monthly moving hours">
            {recentMonths.map((item) => (
              <div className="health-strava-month" key={item.month}>
                <span>{monthShortLabel(item.month)}</span>
                <i style={barStyle(item.movingHours, maxMonthHours)} />
                <small>{formatFitnessNumber(item.movingHours, 1)}h</small>
              </div>
            ))}
          </div>
        </section>

        <section className="health-strava-card">
          <header>
            <strong>Weekly consistency</strong>
            <span>activity count, recent weeks</span>
          </header>
          <div className="health-strava-weeks" aria-label="Strava weekly activity counts">
            {recentWeeks.map((item) => (
              <div className="health-strava-week" key={item.weekStart}>
                <span>{weekShortLabel(item.weekStart)}</span>
                <i style={barStyle(item.activities, maxWeekActivities)} />
                <small>{item.activities}</small>
              </div>
            ))}
          </div>
        </section>

        <section className="health-strava-card health-strava-types">
          <header>
            <strong>Activity mix</strong>
            <span>top categories by moving time</span>
          </header>
          <div className="health-strava-mix">
            <i className="health-strava-donut" style={stravaDonutStyle(summary.activityTypes)} aria-hidden="true" />
            <div>
              <strong>{topActivity?.type || 'No dominant type'}</strong>
              <span>{topActivity ? `${formatFitnessNumber(topActivity.movingHours, 1)}h tracked` : 'Import activity history to populate this.'}</span>
            </div>
          </div>
          {summary.activityTypes.slice(0, 7).map((item) => (
            <div className="health-strava-type" key={item.type}>
              <span>{item.type}</span>
              <i style={barStyle(item.movingHours, maxTypeHours)} />
              <small>{item.activities} / {formatFitnessNumber(item.movingHours, 1)}h</small>
            </div>
          ))}
        </section>
      </div>
    </section>
  );
}

function canRevealHealthEntry(entry: VaultEntry, privateMode: boolean): boolean {
  return !privateMode || !entry.private;
}

function redactedHealthTitle(entry: VaultEntry): string {
  return `Private ${healthCategoryLabel(healthCategory(entry)).toLowerCase()} item`;
}

function healthTaskSafeDetail(entry: VaultEntry, privateMode: boolean): string {
  if (!canRevealHealthEntry(entry, privateMode)) {
    return `${healthCategoryLabel(healthCategory(entry))} · details hidden`;
  }
  return entry.next || `${entry.project || entryLens(entry)} · ${entry.path}`;
}

function HealthTaskGroupPanel({
  group,
  privateMode,
  onOpen,
  onPatch,
  patchingTaskPath,
}: {
  group: HealthTaskGroup;
  privateMode: boolean;
  onOpen: (path: string) => void;
  onPatch: (path: string, updates: TaskMetadataUpdates, currentModifiedAt?: number) => Promise<void> | void;
  patchingTaskPath: string;
}) {
  return (
    <section className="health-category-group">
      <header>
        <div>
          <strong>{group.label}</strong>
          <span>{group.description}</span>
        </div>
        <b>{group.entries.length}</b>
      </header>
      {group.entries.length === 0 ? (
        <p className="muted">No current items.</p>
      ) : (
        <div className="health-task-list">
          {group.entries.map((entry) => (
            <HealthTaskCard
              key={entry.path}
              entry={entry}
              privateMode={privateMode}
              onOpen={onOpen}
              onPatch={onPatch}
              disabled={patchingTaskPath === entry.path}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function HealthTaskCard({
  entry,
  privateMode,
  onOpen,
  onPatch,
  disabled,
}: {
  entry: VaultEntry;
  privateMode: boolean;
  onOpen: (path: string) => void;
  onPatch: (path: string, updates: TaskMetadataUpdates, currentModifiedAt?: number) => Promise<void> | void;
  disabled: boolean;
}) {
  const reveal = canRevealHealthEntry(entry, privateMode);
  const title = reveal ? entry.title : redactedHealthTitle(entry);
  const patch = (updates: TaskMetadataUpdates) => {
    void onPatch(entry.path, updates, entry.modified_at);
  };
  return (
    <article className={`health-task-card ${entryToneClass(entry)} ${reveal ? '' : 'redacted'}`}>
      <button className="health-task-main" onClick={() => reveal && onOpen(entry.path)} disabled={!reveal}>
        <strong>{title}</strong>
        <span>{healthTaskSafeDetail(entry, privateMode)}</span>
        <div className="row-meta">
          <PriorityChip value={entry.priority} />
          <StatusChip value={entry.status || 'open'} />
          <DateChip entry={entry} mode="relative" />
        </div>
      </button>
      <div className="health-task-actions" aria-label={`Health task actions for ${title}`}>
        <button type="button" disabled={disabled} onClick={() => patch({ status: 'active' })}>Active</button>
        <button type="button" disabled={disabled} onClick={() => patch({ status: 'waiting' })}>Wait</button>
        <button type="button" disabled={disabled} onClick={() => patch({ last_touched: calendarIso() })}>Checked today</button>
        <button type="button" disabled={disabled} onClick={() => patch({ status: 'done' })}>Done</button>
      </div>
    </article>
  );
}

function HealthRoutineCardButton({
  card,
  privateMode,
  onOpen,
}: {
  card: ReturnType<typeof buildHealthReview>['routineCards'][number];
  privateMode: boolean;
  onOpen: (path: string) => void;
}) {
  const entry = card.primary;
  const reveal = entry ? canRevealHealthEntry(entry, privateMode) : false;
  return (
    <button
      className={`health-routine-card ${entry && !reveal ? 'redacted' : ''}`}
      disabled={!entry || !reveal}
      onClick={() => entry && reveal && onOpen(entry.path)}
    >
      <span>{card.label}</span>
      <strong>{entry && reveal ? entry.title : card.description}</strong>
      <small>{entry ? `${card.entries.length} linked ${card.entries.length === 1 ? 'entry' : 'entries'}` : 'No linked note yet'}</small>
    </button>
  );
}

function HealthMemoryList({
  entries,
  privateMode,
  onOpen,
}: {
  entries: VaultEntry[];
  privateMode: boolean;
  onOpen: (path: string) => void;
}) {
  if (!entries.length) return <p className="muted">No health memory found.</p>;
  return (
    <div className="health-memory-list">
      {entries.map((entry) => {
        const reveal = canRevealHealthEntry(entry, privateMode);
        return (
          <button key={entry.path} disabled={!reveal} onClick={() => reveal && onOpen(entry.path)} className={reveal ? '' : 'redacted'}>
            <span>{healthEntryDate(entry) || formatStamp(entry.modified_at)}</span>
            <strong>{reveal ? entry.title : redactedHealthTitle(entry)}</strong>
            <small>{reveal ? healthRoutineLabel(entry) : 'details hidden'}</small>
          </button>
        );
      })}
    </div>
  );
}
type TaskViewMode = 'preview' | 'kanban' | 'next-four-weeks' | 'active' | 'queue' | 'list';

const taskViewMeta: Record<TaskViewMode, string> = {
  preview: 'grouped preview of current work',
  kanban: 'bucketed by work state',
  'next-four-weeks': 'date runway for the next four weeks',
  active: 'near-term, high-priority, or in-progress work',
  queue: 'triage across active, queued, waiting, and scheduled tasks',
  list: 'sorted by priority and due date',
};

interface TaskBoardGroup {
  id: string;
  label: string;
  description: string;
  tasks: VaultEntry[];
}

const TASK_PREVIEW_TONE: Record<string, { zone: string; icon: ReactNode }> = {
  now: { zone: 'zone-danger', icon: <Target size={15} /> },
  active: { zone: 'zone-danger', icon: <Target size={15} /> },
  next: { zone: 'zone-blue', icon: <CalendarDays size={15} /> },
  soon: { zone: 'zone-blue', icon: <CalendarDays size={15} /> },
  waiting: { zone: 'zone-warn', icon: <Clock3 size={15} /> },
  scheduled: { zone: 'zone-accent', icon: <CalendarDays size={15} /> },
  later: { zone: 'zone-neutral', icon: <Layers size={15} /> },
};

function TaskPreviewGroups({
  groups,
  onOpen,
  onPatch,
  patchingTaskPath,
}: {
  groups: TaskBoardGroup[];
  onOpen: (path: string) => void;
  onPatch: (path: string, updates: TaskMetadataUpdates, currentModifiedAt?: number) => Promise<void> | void;
  patchingTaskPath: string;
}) {
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set());
  const nonEmptyGroups = groups.filter((group) => group.tasks.length > 0);
  if (nonEmptyGroups.length === 0) return <p className="muted">No open tasks match these filters.</p>;
  return (
    <div className="task-preview-board" aria-label="Open task preview">
      {nonEmptyGroups.map((group) => {
        const expanded = expandedGroups.has(group.id);
        const previewLimit = group.id === 'now' ? 8 : 7;
        const visibleTasks = expanded ? group.tasks : group.tasks.slice(0, previewLimit);
        const hiddenCount = group.tasks.length - visibleTasks.length;
        const tone = TASK_PREVIEW_TONE[group.id] ?? { zone: 'zone-neutral', icon: <Layers size={15} /> };
        return (
          <section className={`zone-card ${tone.zone} task-preview-group task-preview-${group.id}`} key={group.id}>
            <TriageLaneTitle title={group.label} detail={group.description} count={group.tasks.length} icon={tone.icon} />
            <div className="task-preview-list">
              {visibleTasks.map((entry) => (
                <TaskPreviewCard
                  key={entry.path}
                  entry={entry}
                  onOpen={onOpen}
                  onPatch={onPatch}
                  disabled={patchingTaskPath === entry.path}
                />
              ))}
              {(hiddenCount > 0 || expanded) && (
                <button
                  type="button"
                  className="task-preview-show-more"
                  onClick={() => {
                    setExpandedGroups((current) => {
                      const next = new Set(current);
                      if (expanded) next.delete(group.id);
                      else next.add(group.id);
                      return next;
                    });
                  }}
                >
                  {expanded ? 'Show less' : `${hiddenCount} more`}
                </button>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function TaskPreviewCard({
  entry,
  onOpen,
  onPatch,
  disabled,
}: {
  entry: VaultEntry;
  onOpen: (path: string) => void;
  onPatch: (path: string, updates: TaskMetadataUpdates, currentModifiedAt?: number) => Promise<void> | void;
  disabled: boolean;
}) {
  return (
    <article className={`task-preview-card ${entryToneClass(entry)}`}>
      <button className="task-preview-open" onClick={() => onOpen(entry.path)}>
        <strong>{entry.title}</strong>
      </button>
      <TaskEssentialPills entry={entry} showFocus={false} />
      <TaskEditDrawer entry={entry} onPatch={onPatch} disabled={disabled} context="Task" />
    </article>
  );
}

function TaskList({
  entries,
  onOpen,
  onPatch,
  projectOptions,
  patchingTaskPath,
  editingTaskPath,
  setEditingTaskPath,
  emptyMessage = 'No open tasks match these filters.',
}: {
  entries: VaultEntry[];
  onOpen: (path: string) => void;
  onPatch: (path: string, updates: TaskMetadataUpdates, currentModifiedAt?: number) => Promise<void> | void;
  projectOptions: string[];
  patchingTaskPath: string;
  editingTaskPath: string;
  setEditingTaskPath: (path: string) => void;
  emptyMessage?: string;
}) {
  return (
    <div className="work-table">
      {entries.length === 0 ? <p className="muted">{emptyMessage}</p> : entries.map((entry) => (
        <article className={`work-row task-row ${entryToneClass(entry)}`} key={entry.path}>
          <button className="task-open-button" onClick={() => onOpen(entry.path)}>
            <strong>{entry.title}</strong>
            <span className="task-inline-detail">{entry.project || 'no project'} · {entry.path}</span>
            <div className="row-meta task-inline-meta">
              <TaskMetadataChips entry={entry} />
            </div>
          </button>
          <TaskEditDisclosure
            entry={entry}
            projectOptions={projectOptions}
            onPatch={onPatch}
            disabled={patchingTaskPath === entry.path}
            open={editingTaskPath === entry.path}
            onOpenChange={(open) => setEditingTaskPath(open ? entry.path : '')}
          />
          <TaskMetadataDisclosure entry={entry} detail={`${entry.project || 'no project'} · ${entry.path}`} />
        </article>
      ))}
    </div>
  );
}

function TaskBoard({
  groups,
  onOpen,
  onPatch,
  projectOptions,
  patchingTaskPath,
  editingTaskPath,
  setEditingTaskPath,
  ariaLabel,
  className = '',
}: {
  groups: TaskBoardGroup[];
  onOpen: (path: string) => void;
  onPatch: (path: string, updates: TaskMetadataUpdates, currentModifiedAt?: number) => Promise<void> | void;
  projectOptions: string[];
  patchingTaskPath: string;
  editingTaskPath: string;
  setEditingTaskPath: (path: string) => void;
  ariaLabel: string;
  className?: string;
}) {
  const total = groups.reduce((sum, column) => sum + column.tasks.length, 0);
  if (total === 0) return <p className="muted">No open tasks match these filters.</p>;
  return (
    <div className={`kanban-board ${className}`} aria-label={ariaLabel}>
      {groups.map((column) => {
        const tone = TASK_PREVIEW_TONE[column.id] ?? { zone: 'zone-neutral', icon: <Layers size={15} /> };
        return (
        <section
          className={`kanban-column ${tone.zone}`}
          key={column.id}
          aria-label={`${column.label} tasks`}
        >
          <TriageLaneTitle title={column.label} detail={column.description} count={column.tasks.length} icon={tone.icon} />
          <div className="kanban-cards">
            {column.tasks.map((entry) => (
              <article
                className={`kanban-card ${entryToneClass(entry)}`}
                key={entry.path}
              >
                <button className="task-open-button" onClick={() => onOpen(entry.path)}>
                  <strong>{entry.title}</strong>
                  <span className="task-inline-detail">{entry.project || 'no project'}</span>
                  <div className="row-meta task-inline-meta">
                    <TaskMetadataChips entry={entry} />
                  </div>
                </button>
                <TaskEditDisclosure
                  entry={entry}
                  projectOptions={projectOptions}
                  onPatch={onPatch}
                  disabled={patchingTaskPath === entry.path}
                  open={editingTaskPath === entry.path}
                  onOpenChange={(open) => setEditingTaskPath(open ? entry.path : '')}
                />
                <TaskMetadataDisclosure entry={entry} detail={entry.project || 'no project'} />
              </article>
            ))}
          </div>
        </section>
        );
      })}
    </div>
  );
}

function TaskEditDisclosure({
  entry,
  projectOptions,
  onPatch,
  disabled,
  open,
  onOpenChange,
}: {
  entry: VaultEntry;
  projectOptions: string[];
  onPatch: (path: string, updates: TaskMetadataUpdates, currentModifiedAt?: number) => Promise<void> | void;
  disabled: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <div className={`task-card-edit ${open ? 'open' : ''}`}>
      <button
        type="button"
        aria-label={`Edit ${entry.title}`}
        title="Edit task"
        className="task-card-edit-trigger"
        onClick={(event) => {
          event.stopPropagation();
          onOpenChange(!open);
        }}
      >
        <Pencil size={13} aria-hidden="true" />
      </button>
      {open && (
        <div className="task-card-edit-panel">
          <TaskQuickEdit
            task={taskQuickEditFromEntry(entry)}
            projectOptions={projectOptions}
            onPatch={onPatch}
            compact
            disabled={disabled}
          />
        </div>
      )}
    </div>
  );
}

function normalizedProjectToken(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

function projectTokens(project: VaultEntry): Set<string> {
  const parts = project.path.split('/');
  const containerIndex = parts.findIndex((part) => part === 'projects' || part === 'areas');
  const folder = containerIndex >= 0 ? parts[containerIndex + 1] : '';
  return new Set(
    [
      project.id,
      project.project,
      project.inferred_project,
      project.area,
      project.title,
      folder,
    ]
      .map(normalizedProjectToken)
      .filter(Boolean),
  );
}

function belongsToProjectEntry(entry: VaultEntry, project: VaultEntry): boolean {
  if (entry.path === project.path) return true;
  const tokens = projectTokens(project);
  if (tokens.size === 0) return false;
  const candidates = [
    entry.project,
    entry.explicit_project,
    entry.inferred_project,
    entry.area,
    entry.explicit_area,
    entry.inferred_area,
    entry.id,
  ].map(normalizedProjectToken);
  if (candidates.some((candidate) => candidate && tokens.has(candidate))) return true;

  const lowerPath = entry.path.toLowerCase();
  for (const token of tokens) {
    if (lowerPath.includes(`/projects/${token}/`) || lowerPath.startsWith(`projects/${token}/`)) return true;
    if (lowerPath.includes(`/areas/${token}/`) || lowerPath.startsWith(`areas/${token}/`)) return true;
  }
  return false;
}

function projectRelatedEntries(project: VaultEntry, entries: VaultEntry[]): VaultEntry[] {
  return entries
    .filter((entry) => entry.path !== project.path && belongsToProjectEntry(entry, project))
    .sort((a, b) => (b.modified_at || 0) - (a.modified_at || 0));
}

function projectTaskSortValue(entry: VaultEntry): number {
  const days = daysUntil(entry.due || entry.date || entry.start_date);
  return days === null ? 9999 : days;
}

function projectOpenTasks(project: VaultEntry, entries: VaultEntry[]): VaultEntry[] {
  return entries
    .filter((entry) => entry.path !== project.path && isTask(entry) && belongsToProjectEntry(entry, project))
    .filter((entry) => !['done', 'complete', 'completed', 'cancelled', 'dropped', 'archive', 'archived'].includes(String(entry.status || '').toLowerCase()))
    .sort((a, b) => {
      const priorityDiff = projectTaskPriority(a) - projectTaskPriority(b);
      if (priorityDiff !== 0) return priorityDiff;
      const dateDiff = projectTaskSortValue(a) - projectTaskSortValue(b);
      if (dateDiff !== 0) return dateDiff;
      return a.title.localeCompare(b.title);
    });
}

function projectDefaultTasks(tasks: VaultEntry[]): VaultEntry[] {
  return tasks.filter((task) => !isDeferredTask(task));
}

function projectEntryDate(entry: VaultEntry): string | null {
  const value = entry.due || entry.date || entry.start_date || entry.end_date || null;
  return value && daysUntil(value) !== null ? String(value).slice(0, 10) : null;
}

function projectTimelineEntries(project: VaultEntry, entries: VaultEntry[]): Array<{ entry: VaultEntry; date: string }> {
  return entries
    .filter((entry) => entry.path !== project.path && belongsToProjectEntry(entry, project))
    .map((entry) => ({ entry, date: projectEntryDate(entry) }))
    .filter((item): item is { entry: VaultEntry; date: string } => Boolean(item.date))
    .sort((a, b) => {
      const dateDiff = projectTaskSortValue(a.entry) - projectTaskSortValue(b.entry);
      if (dateDiff !== 0) return dateDiff;
      return a.entry.title.localeCompare(b.entry.title);
    });
}

function projectEntryDateSortValue(entry: VaultEntry): string {
  return projectEntryDate(entry) || '';
}

function projectPathBase(entry: VaultEntry): string {
  return entry.path.split('/').pop()?.toLowerCase() || '';
}

function isDatedProjectEntry(entry: VaultEntry): boolean {
  return /^\d{4}-\d{2}-\d{2}/.test(projectPathBase(entry));
}

function isProjectReferenceEntry(entry: VaultEntry): boolean {
  if (isTask(entry)) return false;
  const path = entry.path.toLowerCase();
  const base = projectPathBase(entry);
  if (base === 'readme.md') return true;
  return [
    'linked_sources.md',
    'next.md',
    'paper_status.md',
    'progress.md',
    'questions.md',
    'scratch.md',
    'status.md',
  ].includes(base) || path.includes('/notes/procedural/');
}

type ProjectUpdateKind = 'meeting' | 'code' | 'model' | 'data' | 'writing' | 'decision' | 'note';

export interface ProjectUpdateGroup {
  id: ProjectUpdateKind;
  title: string;
  detail: string;
  entries: VaultEntry[];
}

const PROJECT_UPDATE_GROUPS: Array<Omit<ProjectUpdateGroup, 'entries'>> = [
  { id: 'meeting', title: 'Meetings', detail: 'coauthor calls, conference discussions, email recaps' },
  { id: 'code', title: 'Model and code runs', detail: 'solver checks, implementation runs, diagnostics' },
  { id: 'model', title: 'Methods and modeling', detail: 'derivations, specs, modeling decisions' },
  { id: 'data', title: 'Data and empirics', detail: 'source construction, output checks, empirical updates' },
  { id: 'writing', title: 'Writing and presentations', detail: 'decks, outlines, submission-facing notes' },
  { id: 'decision', title: 'Decisions and feedback', detail: 'decision logs, reviewer/discussant feedback, positioning' },
  { id: 'note', title: 'Project notes', detail: 'dated project updates that do not fit a narrower lane' },
];

function projectUpdateKind(entry: VaultEntry): ProjectUpdateKind | null {
  if (isTask(entry)) return null;
  if (isProjectEvent(entry)) return null;
  const kind = String(entry.kind || entry.type || entry.note_role || '').toLowerCase();
  const path = entry.path.toLowerCase();
  if (isProjectReferenceEntry(entry)) return null;
  if (path.includes('/meetings/') || kind.includes('meeting')) return 'meeting';
  if (path.includes('/code-runs/') || kind.includes('code-run') || kind.includes('run-log')) return 'code';
  if (path.includes('/modeling/') || kind.includes('model') || kind.includes('derivation') || kind.includes('technical')) return 'model';
  if (path.includes('/data/') || path.includes('/empirics/') || kind.includes('data') || kind.includes('result')) return 'data';
  if (path.includes('/writing/') || path.includes('/presentations/') || kind.includes('writing') || kind.includes('presentation')) return 'writing';
  if (path.includes('/feedback/') || path.includes('/literature/') || path.endsWith('/decision_log.md') || kind.includes('feedback') || kind.includes('decision') || kind.includes('literature')) return 'decision';
  if (isDatedProjectEntry(entry)) return 'note';
  return null;
}

function projectUpdateEntries(project: VaultEntry, entries: VaultEntry[]): VaultEntry[] {
  return entries
    .filter((entry) => entry.path !== project.path && belongsToProjectEntry(entry, project) && projectUpdateKind(entry))
    .sort((a, b) => {
      const dateDiff = projectEntryDateSortValue(b).localeCompare(projectEntryDateSortValue(a));
      if (dateDiff !== 0) return dateDiff;
      return (b.modified_at || 0) - (a.modified_at || 0);
    });
}

function projectReferenceEntries(project: VaultEntry, entries: VaultEntry[]): VaultEntry[] {
  return entries
    .filter((entry) => entry.path !== project.path && belongsToProjectEntry(entry, project) && isProjectReferenceEntry(entry))
    .sort((a, b) => {
      const rank = (entry: VaultEntry) => {
        const base = projectPathBase(entry);
        if (base === 'progress.md') return 0;
        if (base === 'status.md' || base === 'paper_status.md') return 1;
        if (base === 'linked_sources.md') return 2;
        if (base === 'next.md') return 3;
        return 4;
      };
      const rankDiff = rank(a) - rank(b);
      if (rankDiff !== 0) return rankDiff;
      return a.title.localeCompare(b.title);
    });
}

function projectUpdateGroups(entries: VaultEntry[]): ProjectUpdateGroup[] {
  return PROJECT_UPDATE_GROUPS
    .map((group) => ({
      ...group,
      entries: entries.filter((entry) => projectUpdateKind(entry) === group.id),
    }))
    .filter((group) => group.entries.length > 0);
}

function projectUpdateLabel(entry: VaultEntry): string {
  const kind = String(entry.kind || entry.type || entry.note_role || entryLens(entry) || 'log').replace(/-/g, ' ');
  const date = projectEntryDate(entry);
  return date ? `${date} · ${kind}` : kind;
}

function projectReferenceLabel(entry: VaultEntry): string {
  const base = projectPathBase(entry).replace(/\.md$/, '').replace(/_/g, ' ');
  if (base === 'paper status') return 'Paper status';
  if (base === 'linked sources') return 'Sources';
  if (base === 'progress') return 'Progress';
  if (base === 'status') return 'Status';
  if (base === 'readme') return 'Readme';
  return base ? base.charAt(0).toUpperCase() + base.slice(1) : entryLens(entry);
}

function isProjectEvent(entry: VaultEntry): boolean {
  const lens = entryLens(entry).toLowerCase();
  return lens === 'event' || lens === 'date' || entry.collection === 'calendar' || entry.path.startsWith('dates/');
}

function isWaitingProjectTask(entry: VaultEntry): boolean {
  return ['waiting', 'blocked', 'pending'].includes(String(entry.status || '').toLowerCase());
}

function isClosedProjectTask(entry: VaultEntry): boolean {
  return ['done', 'complete', 'completed', 'cancelled', 'dropped', 'archive', 'archived'].includes(String(entry.status || '').toLowerCase());
}

function projectTaskDays(entry: VaultEntry): number | null {
  return daysUntil(entry.due || entry.date || entry.start_date);
}

function projectTaskPriority(entry: VaultEntry): number {
  const parsed = Number(String(entry.priority || 99).match(/\d+/)?.[0] || 99);
  return Number.isFinite(parsed) ? parsed : 99;
}

function projectHealthText(item: ProjectReview, openTaskCount: number): string {
  if (item.stale) return item.staleReason;
  if (openTaskCount === 0) return 'no open tasks';
  return 'current';
}

function projectDeadline(project: VaultEntry): string | null {
  return project.deadline || project.due || project.date || project.end_date || null;
}

function projectDeadlineDays(project: VaultEntry): number | null {
  const deadline = projectDeadline(project);
  const dateMatch = String(deadline || '').match(/\d{4}-\d{2}-\d{2}/);
  return dateMatch ? daysUntil(dateMatch[0]) : null;
}

function projectDeadlineText(project: VaultEntry): string {
  const deadline = projectDeadline(project);
  if (!deadline) return 'no deadline';
  const dateMatch = String(deadline).match(/\d{4}-\d{2}-\d{2}/);
  if (!dateMatch) return String(deadline);
  return `${deadlineTypeLabel(project)} · ${dueLabel({ ...project, due: dateMatch[0], date: null })}`;
}

function projectSubtitle(project: VaultEntry): string {
  return project.project || project.id || project.area || project.path;
}

function dashboardSlug(value: unknown): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'unknown';
}

function projectPublicPageHref(project: VaultEntry): string {
  const parts = project.path.split('/');
  const folder = parts[0] === 'projects' || parts[0] === 'areas' ? parts[1] : '';
  return `/dashboard/projects/${dashboardSlug(project.id || project.project || folder || project.title)}.html`;
}

function openStandalonePage(href: string): void {
  const opened = window.open(href, '_blank');
  if (opened) {
    opened.opener = null;
    opened.focus();
    return;
  }
  window.location.assign(href);
}

function uniqueEntries(entries: VaultEntry[]): VaultEntry[] {
  const seen = new Set<string>();
  const unique: VaultEntry[] = [];
  for (const entry of entries) {
    const key = entry.path || entry.title;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(entry);
  }
  return unique;
}

function isProjectFocusTask(entry: VaultEntry): boolean {
  if (isWaitingProjectTask(entry)) return false;
  if (isDeferredTask(entry)) return false;
  const days = projectTaskDays(entry);
  if (days === null || days > 7) return false;
  return projectTaskPriority(entry) <= 1 || isHardDeadline(entry);
}

function projectCalendarFocusDate(items: CalendarItem[]): Date {
  const today = calendarIso();
  const unique = uniqueCalendarItems(items);
  const upcoming = unique.find((item) => (item.rangeEnd || item.date) >= today);
  return parseCalendarIso(upcoming?.rangeStart || upcoming?.date || today);
}

function projectCalendarAgendaItems(items: CalendarItem[], limit = 7): CalendarItem[] {
  const today = calendarIso();
  const unique = uniqueCalendarItems(items);
  const upcoming = unique.filter((item) => (item.rangeEnd || item.date) >= today);
  if (upcoming.length) return upcoming.slice(0, limit);
  return unique.slice(Math.max(0, unique.length - limit));
}

function ProjectsView({
  data,
  onOpenProject,
  onOpenMarkdown,
}: {
  data: WorkbenchData;
  onOpenProject: (path: string) => void;
  onOpenMarkdown: (path: string) => void;
}) {
  const projectRows = data.projectReview.map((item) => {
    const openProjectTasks = projectOpenTasks(item.project, data.visibleEntries);
    const coauthorTaskCount = openProjectTasks.filter(isCoauthorAssignedTask).length;
    const openTaskCount = openProjectTasks.length - coauthorTaskCount;
    const deadlineDays = projectDeadlineDays(item.project);
    return {
      item,
      openTaskCount,
      coauthorTaskCount,
      deadlineDays,
      health: projectHealthText(item, openTaskCount + coauthorTaskCount),
    };
  });
  const needsReview = projectRows.filter(({ item, openTaskCount, deadlineDays }) => item.stale || openTaskCount === 0 || (deadlineDays !== null && deadlineDays <= 7)).length;
  const dueSoon = projectRows.filter(({ deadlineDays }) => deadlineDays !== null && deadlineDays >= 0 && deadlineDays <= 14).length;
  const active = projectRows.filter(({ openTaskCount }) => openTaskCount > 0).length;

  return (
    <section className="work-view project-map-view">
      <header className="project-map-header">
        <div>
          <span className="eyebrow">Project map</span>
          <h1>Projects</h1>
          <p>{data.projectReview.length} records across the current visible vault.</p>
        </div>
        <div className="project-map-metrics">
          <ProjectMapMetric label="Active" value={String(active)} />
          <ProjectMapMetric label="Review" value={String(needsReview)} />
          <ProjectMapMetric label="Coauthors" value={String(projectRows.reduce((sum, row) => sum + row.coauthorTaskCount, 0))} />
          <ProjectMapMetric label="14 days" value={String(dueSoon)} />
        </div>
      </header>
      <div className="project-map-shell">
        <aside className="project-map-rail" aria-label="Project overview totals">
          <ProjectMapMetric label="All projects" value={String(projectRows.length)} detail="indexed" />
          <ProjectMapMetric label="Open tasks" value={String(projectRows.reduce((sum, row) => sum + row.openTaskCount, 0))} detail="linked" />
          <ProjectMapMetric label="Quiet" value={String(projectRows.filter((row) => row.openTaskCount === 0).length)} detail="no open tasks" />
        </aside>
        <div className="project-map-list" aria-label="Project overview">
          <div className="project-map-list-head" aria-hidden="true">
            <span>Project</span>
            <span>State</span>
            <span>Owned / coauthor</span>
            <span>Deadline</span>
          </div>
          {projectRows.map(({ item, openTaskCount, coauthorTaskCount, health, deadlineDays }) => (
            <ProjectIndexRow
              key={item.project.path}
              item={item}
              openTaskCount={openTaskCount}
              coauthorTaskCount={coauthorTaskCount}
              health={health}
              deadlineDays={deadlineDays}
              onOpenProject={onOpenProject}
              onOpenMarkdown={onOpenMarkdown}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function ProjectMapMetric({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="project-map-metric">
      <span>{label}</span>
      <strong>{value}</strong>
      {detail && <small>{detail}</small>}
    </div>
  );
}

function ProjectIndexRow({
  item,
  openTaskCount,
  coauthorTaskCount,
  health,
  deadlineDays,
  onOpenProject,
  onOpenMarkdown,
}: {
  item: ProjectReview;
  openTaskCount: number;
  coauthorTaskCount: number;
  health: string;
  deadlineDays: number | null;
  onOpenProject: (path: string) => void;
  onOpenMarkdown: (path: string) => void;
}) {
  const deadlineKind = deadlineTypeLabel(item.project);
  const deadlineTone = deadlineDays === null ? 'neutral' : deadlineDays < 0 ? 'overdue' : deadlineDays <= 7 ? 'soon' : 'normal';
  return (
    <article className={`project-map-row ${entryToneClass(item.project)} ${item.stale ? 'stale' : ''}`}>
      <button className="project-map-main" onClick={() => onOpenProject(item.project.path)}>
        <span className="project-map-dot" aria-hidden="true" />
        <span className="project-map-title">
          <strong>{item.project.title}</strong>
          <small>{projectSubtitle(item.project)}</small>
        </span>
        <span className="project-map-state">
          <span>{item.project.status || 'active'}</span>
          {health !== 'current' && <small>{health}</small>}
        </span>
        <span className="project-map-count"><strong>{openTaskCount}</strong><small>{coauthorTaskCount ? `${coauthorTaskCount} coauthor` : 'open'}</small></span>
        <span className={`project-map-deadline ${deadlineTone} deadline-${deadlineKind}`}>{projectDeadlineText(item.project)}</span>
        <ChevronRight size={15} aria-hidden="true" />
      </button>
      <button className="project-map-file" aria-label={`Open ${item.project.title} file`} title="Open project file" onClick={() => onOpenMarkdown(item.project.path)}>
        <FileText size={14} />
      </button>
    </article>
  );
}

function ProjectDetailView({
  data,
  projectPath,
  onOpen,
  onOpenProject,
  onOpenView,
  onPatchTaskMetadata,
  patchingTaskPath,
}: {
  data: WorkbenchData;
  projectPath: string;
  onOpen: (path: string) => void;
  onOpenProject: (path: string) => void;
  onOpenView: (view: AppView) => void;
  onPatchTaskMetadata: (path: string, updates: TaskMetadataUpdates, currentModifiedAt?: number) => Promise<void> | void;
  patchingTaskPath: string;
}) {
  const item = data.projectReview.find((candidate) => candidate.project.path === projectPath) || data.projectReview[0];
  if (!item) {
    return (
      <section className="work-view">
        <ViewHeader eyebrow="Project overview" title="Projects" meta="No project records found in the current vault filters." />
        <p className="muted">Create or tag a project entry to populate this view.</p>
      </section>
    );
  }

  const project = item.project;
  const allOpenTasks = projectOpenTasks(project, data.visibleEntries);
  const coauthorTasks = allOpenTasks.filter(isCoauthorAssignedTask);
  const openTasks = allOpenTasks.filter((task) => !isCoauthorAssignedTask(task));
  const deferredTasks = openTasks.filter(isDeferredTask);
  const defaultOpenTasks = projectDefaultTasks(openTasks);
  const projectCalendarItems = data.calendarItems.filter((calendarItem) => belongsToProjectEntry(calendarItem.entry, project));
  const waitingTasks = defaultOpenTasks.filter(isWaitingProjectTask);
  const readyTasks = defaultOpenTasks.filter((task) => !waitingTasks.some((waiting) => waiting.path === task.path));
  const focusTasks = uniqueEntries(readyTasks.filter(isProjectFocusTask));
  const focusTaskPaths = new Set(focusTasks.map((task) => task.path));
  const nextTasks = readyTasks.filter((task) => !focusTaskPaths.has(task.path));
  const closedTasks = data.visibleEntries.filter((entry) => entry.path !== project.path && isTask(entry) && belongsToProjectEntry(entry, project) && isClosedProjectTask(entry));
  const openTaskPaths = new Set(openTasks.map((task) => task.path));
  const related = projectRelatedEntries(project, data.visibleEntries);
  const timeline = projectTimelineEntries(project, data.visibleEntries).filter(({ entry }) => !openTaskPaths.has(entry.path));
  const events = timeline.filter(({ entry }) => isProjectEvent(entry));
  const updates = projectUpdateEntries(project, data.visibleEntries);
  const updateGroups = projectUpdateGroups(updates);
  const references = projectReferenceEntries(project, data.visibleEntries);
  const projectMemoryPaths = new Set([...updates, ...references].map((entry) => entry.path));
  const recent = related.filter((entry) => !isTask(entry) && !projectMemoryPaths.has(entry.path) && !isProjectReferenceEntry(entry)).slice(0, 8);
  const lastActivity = related[0]?.modified_at || project.modified_at;
  const nextTimeline = timeline.find(({ date }) => {
    const days = daysUntil(date);
    return days !== null && days >= 0;
  });
  const next = project.next || project.snippet || 'No next action recorded.';
  const publicPageHref = projectPublicPageHref(project);

  return (
    <section className="work-view project-workspace-view">
      <div className="project-workspace-shell">
        <aside className="project-workspace-spine">
          <div className="project-spine-title">
            <span className="project-map-dot" aria-hidden="true" />
            <div>
              <strong>{project.title}</strong>
              <span>{projectSubtitle(project)}</span>
            </div>
          </div>
          <ProjectMetric label="Stage" value={project.status || 'active'} />
          <ProjectMetric label="Health" value={projectHealthText(item, allOpenTasks.length)} />
          <ProjectMetric label="Deadline" value={projectDeadlineText(project)} />
          <ProjectMetric label="Last touched" value={lastActivity ? formatStamp(lastActivity) : 'unknown'} />
          <div className="project-spine-switcher">
            <strong>Switch project</strong>
            {data.projectReview.filter((candidate) => candidate.project.path !== project.path).slice(0, 7).map((candidate) => (
              <button key={candidate.project.path} onClick={() => onOpenProject(candidate.project.path)}>
                <span>{candidate.project.title}</span>
                <small>{candidate.openTaskCount} open</small>
              </button>
            ))}
          </div>
        </aside>

        <div className="project-workspace-main">
          <div className="project-detail-nav">
            <button onClick={() => onOpenView('projects')}><Layers size={14} /> Projects</button>
            <button onClick={() => onOpen(project.path)}><FileText size={14} /> File</button>
            <button onClick={() => openStandalonePage(publicPageHref)}><ExternalLink size={14} /> Coauthor page</button>
          </div>
          <header className={`project-workspace-hero ${entryToneClass(project)} ${item.stale ? 'stale' : ''}`}>
            <div className="project-workspace-title">
              <span className="eyebrow">Project overview</span>
              <h1>{project.title}</h1>
              <p>{projectSubtitle(project)}</p>
            </div>
            <div className="project-state-card">
              <span>Where this stands</span>
              <p>{next}</p>
            </div>
          </header>

          <div className="project-landing-grid" aria-label="Project landing summary">
            <section className="project-landing-card">
              <span>State of project</span>
              <strong>{project.status || 'active'} · {projectHealthText(item, allOpenTasks.length)}</strong>
              <p>{projectDeadlineText(project)} · last touched {lastActivity ? formatStamp(lastActivity) : 'unknown'}</p>
            </section>
            <section className="project-landing-card project-landing-card-primary">
              <span>Current decision / next milestone</span>
              <strong>{nextTimeline ? nextTimeline.date : 'No dated milestone'}</strong>
              <p>{next}</p>
            </section>
            <section className="project-landing-card">
              <span>My tasks</span>
              <strong>{focusTasks.length} focus · {nextTasks.length} next · {waitingTasks.length} waiting</strong>
              <p>{focusTasks[0]?.title || readyTasks[0]?.title || 'No immediate owned task linked.'}</p>
            </section>
            <section className="project-landing-card">
              <span>Collaboration and files</span>
              <strong>{coauthorTasks.length} coauthor · {updates.length} updates · {references.length} references</strong>
              <p>Public page, project file, recent updates, and source files are linked below.</p>
            </section>
          </div>

          <div className="project-command-strip" aria-label="Project status summary">
            <ProjectMetric label="Focus" value={String(focusTasks.length)} />
            <ProjectMetric label="Next" value={String(nextTasks.length)} />
            <ProjectMetric label="Waiting" value={String(waitingTasks.length)} />
            <ProjectMetric label="Deferred" value={String(deferredTasks.length)} />
            <ProjectMetric label="Coauthors" value={String(coauthorTasks.length)} />
            <ProjectMetric label="Closed" value={String(closedTasks.length)} />
            <ProjectMetric label="Next dated" value={nextTimeline ? `${nextTimeline.date}` : 'none'} />
            <ProjectMetric label="Updates" value={String(updates.length)} />
          </div>

          <div className="project-workspace-grid">
            <section className="zone-accent project-work-panel project-work-panel-wide">
              <ProjectCoauthorCockpit
                project={project}
                focusTasks={focusTasks}
                nextTasks={nextTasks}
                waitingTasks={waitingTasks}
                coauthorTasks={coauthorTasks}
                files={[...updates, ...references]}
                onOpen={onOpen}
              />
            </section>

            <section className="zone-blue project-work-panel project-work-panel-wide">
              <ProjectSectionTitle title="Task lanes" meta={`${defaultOpenTasks.length} current · ${deferredTasks.length} deferred · ${coauthorTasks.length} coauthor`} icon={<Layers size={15} />} />
              <div className="project-task-lanes">
                <ProjectTaskLane title="Focus" detail="Actionable P1 or hard deadlines this week" entries={focusTasks} onOpen={onOpen} onPatch={onPatchTaskMetadata} patchingTaskPath={patchingTaskPath} empty="No immediate tasks." emphasis="focus" />
                <ProjectTaskLane title="Next" detail="ready but less urgent" entries={nextTasks} onOpen={onOpen} onPatch={onPatchTaskMetadata} patchingTaskPath={patchingTaskPath} empty="No queued tasks." collapsible />
                <ProjectTaskLane title="Waiting" detail="blocked, pending, or waiting" entries={waitingTasks} onOpen={onOpen} onPatch={onPatchTaskMetadata} patchingTaskPath={patchingTaskPath} empty="No waiting tasks." collapsible />
                <ProjectTaskLane title="Deferred" detail="P4, someday, or parked" entries={deferredTasks} onOpen={onOpen} onPatch={onPatchTaskMetadata} patchingTaskPath={patchingTaskPath} empty="No deferred tasks." collapsible />
                <ProjectTaskLane title="Coauthors" detail="assigned out to collaborators" entries={coauthorTasks} onOpen={onOpen} onPatch={onPatchTaskMetadata} patchingTaskPath={patchingTaskPath} empty="No coauthor-assigned tasks." collapsible />
              </div>
            </section>

            <section className="zone-warn project-work-panel project-work-panel-wide">
              <ProjectCalendarPanel
                items={projectCalendarItems}
                onOpen={onOpen}
                onOpenCalendar={() => onOpenView('calendar')}
              />
            </section>

            <section className="zone-good project-work-panel project-work-panel-wide">
              <ProjectSectionTitle title="Recent project updates" meta={`${updates.length} curated · ${references.length} reference`} icon={<Activity size={15} />} />
              <ProjectUpdateBoard groups={updateGroups} references={references} onOpen={onOpen} />
            </section>

            <details className="zone-neutral project-work-panel project-work-panel-wide project-secondary-drawer">
              <summary>
                <div>
                  <strong>Timeline and event archive</strong>
                  <span>{timeline.length} dated items · {events.length} events</span>
                </div>
                <ChevronRight size={14} aria-hidden="true" />
              </summary>
              <div className="project-secondary-grid">
                <section>
                  <ProjectSectionTitle title="Timeline" meta={`${timeline.length} dated items`} icon={<CalendarDays size={15} />} />
                  <ProjectTimelineList items={timeline.slice(0, 10)} onOpen={onOpen} empty="No dated tasks or notes are linked." />
                </section>
                <section>
                  <ProjectSectionTitle title="Events" meta={`${events.length} events`} icon={<Sparkles size={15} />} />
                  <ProjectTimelineList items={events.slice(0, 8)} onOpen={onOpen} empty="No events are linked to this project." />
                </section>
              </div>
            </details>

            <section className="zone-neutral project-work-panel project-work-panel-wide">
              <ProjectSectionTitle title="Sources and files" meta={`${recent.length} related notes shown`} icon={<FileText size={15} />} />
              <ProjectNoteList entries={recent} onOpen={onOpen} />
            </section>
          </div>
        </div>
      </div>
    </section>
  );
}

function ProjectCalendarPanel({
  items,
  onOpen,
  onOpenCalendar,
}: {
  items: CalendarItem[];
  onOpen: (path: string) => void;
  onOpenCalendar: () => void;
}) {
  const today = useMemo(() => parseCalendarIso(calendarIso()), []);
  const focusDate = useMemo(() => projectCalendarFocusDate(items), [items]);
  const month = useMemo(() => buildCalendarMonth(items, focusDate, today), [focusDate, items, today]);
  const agenda = useMemo(() => projectCalendarAgendaItems(items), [items]);
  const majorCount = useMemo(
    () => uniqueCalendarItems(items).filter((item) => item.importance === 'major' || item.importance === 'hard-deadline').length,
    [items],
  );

  return (
    <div className="project-calendar-panel">
      <div className="project-calendar-head">
        <ProjectSectionTitle title="Project calendar" meta={`${uniqueCalendarItems(items).length} dated · ${majorCount} highlighted`} icon={<CalendarDays size={15} />} />
        <button type="button" onClick={onOpenCalendar}>
          <CalendarDays size={14} /> Full calendar
        </button>
      </div>
      {items.length === 0 ? (
        <p className="muted">No dated tasks, deadlines, travel, or events are linked to this project.</p>
      ) : (
        <div className="project-calendar-layout">
          <div className="project-mini-calendar">
            <header>
              <strong>{month.label}</strong>
              <span>{month.total_items} visible items</span>
            </header>
            <div className="calendar-weekdays" aria-hidden="true">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => <span key={day}>{day}</span>)}
            </div>
            <div className="calendar-grid">
              {month.weeks.flat().map((day) => (
                <CalendarDayCell
                  key={day.iso}
                  day={day}
                  lane="all"
                  onOpen={onOpen}
                  maxItems={2}
                />
              ))}
            </div>
          </div>
          <div className="project-calendar-agenda">
            <strong>Next dated items</strong>
            {agenda.length === 0 ? (
              <p className="muted">No upcoming dated items.</p>
            ) : (
              <div className="project-calendar-agenda-list">
                {agenda.map((item) => (
                  <button
                    key={calendarItemKey(item)}
                    className={`project-calendar-agenda-row ${entryToneClass(item.entry)} ${calendarHighlightClass(item)}`}
                    onClick={() => onOpen(item.entry.path)}
                  >
                    <span>{calendarDateSpanLabel(item)}</span>
                    <strong>{item.entry.title}</strong>
                    <small>
                      {calendarShouldShowAgendaHighlight(item) ? `${item.highlightLabel} · ` : ''}{item.entry.status || item.lane || entryLens(item.entry)}
                    </small>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ProjectMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="project-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ProjectSectionTitle({ title, meta, icon }: { title: string; meta: string; icon?: ReactNode }) {
  return (
    <div className={`project-section-title${icon ? ' project-section-title-iconed' : ''}`}>
      {icon && <span className="zone-icon" aria-hidden="true">{icon}</span>}
      <h2>{title}</h2>
      <span>{meta}</span>
    </div>
  );
}

function ProjectCoauthorCockpit({
  project,
  focusTasks,
  nextTasks,
  waitingTasks,
  coauthorTasks,
  files,
  onOpen,
}: {
  project: VaultEntry;
  focusTasks: VaultEntry[];
  nextTasks: VaultEntry[];
  waitingTasks: VaultEntry[];
  coauthorTasks: VaultEntry[];
  files: VaultEntry[];
  onOpen: (path: string) => void;
}) {
  const asks = uniqueEntries([...focusTasks, ...waitingTasks, ...coauthorTasks, ...nextTasks]).slice(0, 4);
  const packetFiles = uniqueEntries(files).filter((entry) => !isTask(entry)).slice(0, 4);
  const coauthorOwner = coauthorTasks[0] ? taskAssignee(coauthorTasks[0]) || 'coauthor' : 'none';
  const waitingOwner = coauthorTasks[0] ? coauthorOwner : waitingTasks[0] ? 'Owner' : 'none';
  return (
    <div className="project-coauthor-cockpit">
      <ProjectSectionTitle title="Coauthor cockpit" meta="meeting packet · asks · ownership" icon={<UsersRound size={15} />} />
      <p className="muted">Upcoming checkpoint, decisions needed, ownership state, and files for the next coauthor conversation.</p>
      <div className="project-coauthor-cockpit-grid">
        <article className="project-cockpit-card project-cockpit-card-primary">
          <span>Upcoming meeting / checkpoint</span>
          <strong>{project.deadline || 'No dated checkpoint'}</strong>
          <p>{project.next || project.snippet || 'No next action listed.'}</p>
        </article>
        <article className="project-cockpit-card">
          <span>Decision asks</span>
          <ProjectCockpitList entries={asks} onOpen={onOpen} empty="No immediate coauthor asks." />
        </article>
        <article className="project-cockpit-card">
          <span>Ownership</span>
          <dl className="project-owner-matrix">
            <div><dt>Owner</dt><dd>{focusTasks.length} focus · {nextTasks.length} next</dd></div>
            <div><dt>Coauthors</dt><dd>{coauthorTasks.length} assigned out · {coauthorOwner}</dd></div>
            <div><dt>Waiting</dt><dd>{waitingTasks.length} blocked · owner {waitingOwner}</dd></div>
          </dl>
        </article>
        <article className="project-cockpit-card">
          <span>Meeting packet</span>
          <ProjectCockpitList entries={packetFiles} onOpen={onOpen} empty="No meeting-packet files listed." />
        </article>
      </div>
    </div>
  );
}

function ProjectCockpitList({
  entries,
  onOpen,
  empty,
}: {
  entries: VaultEntry[];
  onOpen: (path: string) => void;
  empty: string;
}) {
  if (!entries.length) return <p className="muted">{empty}</p>;
  return (
    <div className="project-cockpit-list">
      {entries.map((entry) => (
        <button key={entry.path} onClick={() => onOpen(entry.path)}>
          <strong>{entry.title}</strong>
          <span>{entry.due || entry.date || entryLens(entry)} · {taskAssignee(entry) || entry.status || entry.project || 'linked'}</span>
        </button>
      ))}
    </div>
  );
}

function ProjectTaskLane({
  title,
  detail,
  entries,
  onOpen,
  onPatch,
  patchingTaskPath,
  empty,
  collapsible = false,
  emphasis = 'normal',
}: {
  title: string;
  detail: string;
  entries: VaultEntry[];
  onOpen: (path: string) => void;
  onPatch: (path: string, updates: TaskMetadataUpdates, currentModifiedAt?: number) => Promise<void> | void;
  patchingTaskPath: string;
  empty: string;
  collapsible?: boolean;
  emphasis?: 'normal' | 'focus';
}) {
  const body = <ProjectTaskList entries={entries} onOpen={onOpen} onPatch={onPatch} patchingTaskPath={patchingTaskPath} empty={empty} />;
  const className = `project-task-lane project-task-lane-${emphasis}${collapsible ? ' project-task-lane-collapsible' : ''}`;
  if (collapsible) {
    return (
      <details className={className}>
        <summary>
          <div>
            <strong>{title}</strong>
            <span>{detail}</span>
          </div>
          <span className="lane-summary-meta">
            <b>{entries.length}</b>
            <ChevronRight size={13} aria-hidden="true" />
          </span>
        </summary>
        {body}
      </details>
    );
  }

  return (
    <section className={className}>
      <header>
        <div>
          <strong>{title}</strong>
          <span>{detail}</span>
        </div>
        <b>{entries.length}</b>
      </header>
      {body}
    </section>
  );
}

function ProjectTaskList({
  entries,
  onOpen,
  onPatch,
  patchingTaskPath,
  empty = 'No active tasks linked.',
}: {
  entries: VaultEntry[];
  onOpen: (path: string) => void;
  onPatch: (path: string, updates: TaskMetadataUpdates, currentModifiedAt?: number) => Promise<void> | void;
  patchingTaskPath: string;
  empty?: string;
}) {
  if (!entries.length) return <p className="muted">{empty}</p>;
  return (
    <div className="project-task-list">
      {entries.map((entry) => (
        <ProjectTaskCard
          key={entry.path}
          entry={entry}
          onOpen={onOpen}
          onPatch={onPatch}
          disabled={patchingTaskPath === entry.path}
        />
      ))}
    </div>
  );
}

export function ProjectTaskCard({
  entry,
  onOpen,
  onPatch,
  disabled,
}: {
  entry: VaultEntry;
  onOpen: (path: string) => void;
  onPatch: (path: string, updates: TaskMetadataUpdates, currentModifiedAt?: number) => Promise<void> | void;
  disabled: boolean;
}) {
  return (
    <article className={`project-task-card ${entryToneClass(entry)}`}>
      <button className="project-task-card-main" onClick={() => onOpen(entry.path)}>
        <strong>{entry.title}</strong>
      </button>
      <TaskEssentialPills entry={entry} />
      <TaskEditDrawer entry={entry} onPatch={onPatch} disabled={disabled} context="Project" />
    </article>
  );
}

export function ProjectUpdateBoard({
  groups,
  references,
  onOpen,
}: {
  groups: ProjectUpdateGroup[];
  references: VaultEntry[];
  onOpen: (path: string) => void;
}) {
  const hasUpdates = groups.some((group) => group.entries.length > 0);
  if (!hasUpdates && !references.length) return <p className="muted">No project updates found.</p>;
  return (
    <div className="project-update-board">
      {hasUpdates ? (
        <div className="project-update-groups">
          {groups.map((group) => {
            const visibleEntries = group.entries.slice(0, 5);
            const hiddenCount = group.entries.length - visibleEntries.length;
            return (
              <section className={`project-update-group project-update-${group.id}`} key={group.id}>
                <header>
                  <div>
                    <strong>{group.title}</strong>
                    <span>{group.detail}</span>
                  </div>
                  <b>{group.entries.length}</b>
                </header>
                <div className="project-update-list">
                  {visibleEntries.map((entry) => (
                    <button key={entry.path} onClick={() => onOpen(entry.path)}>
                      <span>{projectUpdateLabel(entry)}</span>
                      <strong>{entry.title}</strong>
                      <small>{entry.snippet || entry.path}</small>
                    </button>
                  ))}
                </div>
                {hiddenCount > 0 && <p className="project-update-hidden">{hiddenCount} older updates hidden from this lane.</p>}
              </section>
            );
          })}
        </div>
      ) : (
        <p className="muted">No curated meeting, model, data, code, or writing updates yet.</p>
      )}
      {references.length > 0 && (
        <details className="project-reference-drawer">
          <summary>
            <span>Reference files</span>
            <small>{references.length} status/source/scaffold files</small>
          </summary>
          <div className="project-reference-preview-list">
            {references.map((entry) => (
              <article className="project-reference-preview-card" key={entry.path}>
                <div>
                  <span>{projectReferenceLabel(entry)}</span>
                  <strong>{entry.title}</strong>
                  <p>{entry.snippet || 'No preview text available yet.'}</p>
                </div>
                <button type="button" onClick={() => onOpen(entry.path)}>Open</button>
              </article>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function ProjectNoteList({ entries, onOpen }: { entries: VaultEntry[]; onOpen: (path: string) => void }) {
  if (!entries.length) return <p className="muted">No recent related notes found.</p>;
  return (
    <div className="project-note-list">
      {entries.map((entry) => (
        <button key={entry.path} onClick={() => onOpen(entry.path)}>
          <span>{entryLens(entry)}</span>
          <strong>{entry.title}</strong>
          <small>{entry.snippet || entry.path}</small>
        </button>
      ))}
    </div>
  );
}

function ProjectTimelineList({
  items,
  onOpen,
  empty,
}: {
  items: Array<{ entry: VaultEntry; date: string }>;
  onOpen: (path: string) => void;
  empty: string;
}) {
  if (!items.length) return <p className="muted">{empty}</p>;
  return (
    <div className="project-timeline-list">
      {items.map(({ entry, date }) => (
        <button key={entry.path} onClick={() => onOpen(entry.path)}>
          <span>{date}</span>
          <strong>{entry.title}</strong>
          <small>{entryLens(entry)} · {entry.status || entry.project || 'linked'}</small>
        </button>
      ))}
    </div>
  );
}

function TypesView({
  data,
  onOpen,
  onSelectDomain,
  onSelectType,
  onSelectCollection,
  onSelectNoteRole,
}: {
  data: WorkbenchData;
  onOpen: (path: string) => void;
  onSelectDomain: (domain: string) => void;
  onSelectType: (lens: string) => void;
  onSelectCollection: (collection: string) => void;
  onSelectNoteRole: (noteRole: string) => void;
}) {
  return (
    <section className="work-view">
      <ViewHeader eyebrow="Organization cleanup" title="Types" meta={`${data.domainGroups.length} domains · ${data.collectionGroups.length} collections · ${data.noteRoleGroups.length} note roles · ${data.typeGroups.length} kinds`} />
      <TypeGroupSection title="Domains" groups={data.domainGroups} onOpen={onOpen} onSelect={onSelectDomain} labelForLens={domainLabel} />
      <TypeGroupSection title="Collections" groups={data.collectionGroups} onOpen={onOpen} onSelect={onSelectCollection} />
      <TypeGroupSection title="Note Roles" groups={data.noteRoleGroups} onOpen={onOpen} onSelect={onSelectNoteRole} />
      <TypeGroupSection title="Kinds" groups={data.typeGroups} onOpen={onOpen} onSelect={onSelectType} />
    </section>
  );
}

function TypeGroupSection({
  title,
  groups,
  onOpen,
  onSelect,
  labelForLens,
}: {
  title: string;
  groups: TypeGroup[];
  onOpen: (path: string) => void;
  onSelect: (lens: string) => void;
  labelForLens?: (lens: string) => string;
}) {
  return (
    <section className="lens-section">
      <div className="overview-section-title">
        <h2><Tags size={16} /> {title}</h2>
        <span>{groups.length}</span>
      </div>
      <div className="type-table">
        {groups.map((group) => (
          <details className="type-row" key={`${title}:${group.lens}`}>
            <summary>
              <button onClick={(event) => { event.preventDefault(); onSelect(group.lens); }}>
                <strong>{labelForLens ? labelForLens(group.lens) : group.lens}</strong>
                <span>{group.count} entries</span>
              </button>
              <span>{group.entries[0]?.path || 'No entries'}</span>
            </summary>
            <div className="dense-list">
              {group.entries.map((entry) => (
                <button className={`activity-row ${entryToneClass(entry)}`} key={entry.path} onClick={() => onOpen(entry.path)}>
                  <strong>{entry.title}</strong>
                  <span>{entry.path}</span>
                </button>
              ))}
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}

export function CalendarView({
  data,
  onOpen,
  onPatchTaskMetadata,
  patchingTaskPath,
}: {
  data: WorkbenchData;
  onOpen: (path: string) => void;
  onPatchTaskMetadata: (path: string, updates: TaskMetadataUpdates, currentModifiedAt?: number) => Promise<void> | void;
  patchingTaskPath: string;
}) {
  const [lane, setLane] = useState('all');
  const [viewMode, setViewMode] = useState<CalendarViewMode>('month');
  const [calendarScope, setCalendarScope] = useState<CalendarScope>('events');
  const [focusIso, setFocusIso] = useState(() => calendarIso());
  const today = useMemo(() => parseCalendarIso(calendarIso()), []);
  const focusDate = useMemo(() => parseCalendarIso(focusIso), [focusIso]);
  const lanes = useMemo(
    () => [...new Set(data.calendarItems.map((item) => item.lane))].sort((a, b) => a.localeCompare(b)).slice(0, 12),
    [data.calendarItems],
  );
  const laneItems = useMemo(
    () => (lane === 'all' ? data.calendarItems : data.calendarItems.filter((item) => item.lane === lane)),
    [data.calendarItems, lane],
  );
  const visibleItems = useMemo(
    () => laneItems.filter((item) => calendarItemMatchesScope(item, calendarScope)),
    [calendarScope, laneItems],
  );
  const hiddenTaskCounts = useMemo(() => hiddenTaskCountsByDate(laneItems, visibleItems), [laneItems, visibleItems]);
  const calendarMonth = useMemo(() => buildCalendarMonth(visibleItems, focusDate, today), [focusDate, today, visibleItems]);
  const calendarWeek = useMemo(() => buildCalendarWeek(visibleItems, focusDate, today), [focusDate, today, visibleItems]);
  const calendarYear = useMemo(() => buildCalendarYear(visibleItems, focusDate, today), [focusDate, today, visibleItems]);
  const rangeItems = useMemo(() => {
    if (viewMode === 'week') return calendarWeek.days.flatMap((day) => day.items);
    if (viewMode === 'year') return calendarYear.months.flatMap((month) => month.weeks.flat().filter((day) => day.isCurrentMonth).flatMap((day) => day.items));
    return calendarMonth.weeks.flat().filter((day) => day.isCurrentMonth).flatMap((day) => day.items);
  }, [calendarMonth, calendarWeek, calendarYear, viewMode]);
  const rangeDates = useMemo(() => {
    if (viewMode === 'week') return calendarWeek.days.map((day) => day.iso);
    if (viewMode === 'year') return calendarYear.months.flatMap((month) => month.weeks.flat().filter((day) => day.isCurrentMonth).map((day) => day.iso));
    return calendarMonth.weeks.flat().filter((day) => day.isCurrentMonth).map((day) => day.iso);
  }, [calendarMonth, calendarWeek, calendarYear, viewMode]);
  const agendaItems = useMemo(() => uniqueCalendarItems(rangeItems).slice(0, 80), [rangeItems]);
  const focusLabel = viewMode === 'week' ? calendarWeek.label : viewMode === 'year' ? calendarYear.label : calendarMonth.label;
  const focusCount = viewMode === 'week' ? calendarWeek.total_items : viewMode === 'year' ? calendarYear.total_items : calendarMonth.total_items;
  const visibleItemCount = uniqueCalendarItems(visibleItems).length;
  const laneItemCount = uniqueCalendarItems(laneItems).length;
  const rangeHiddenTaskCount = rangeDates.reduce((sum, iso) => sum + (hiddenTaskCounts.get(iso) || 0), 0);
  const moveFocus = (amount: number) => {
    setFocusIso(calendarIso(shiftCalendarDate(focusDate, viewMode, amount)));
  };
  const openMonth = (month: CalendarMonth) => {
    setFocusIso(calendarIso(new Date(month.year, month.month, 1)));
    setViewMode('month');
  };

  return (
    <section className="work-view calendar-view">
      <ViewHeader
        eyebrow="Calendar view"
        title="Calendar"
        meta={`${visibleItemCount} shown${laneItemCount !== visibleItemCount ? ` of ${laneItemCount}` : ''} dated items`}
        actions={(
          <div className="calendar-toolbar">
            <div className="segmented-control calendar-scope-switcher" aria-label="Calendar density">
              {([
                ['events', 'Events'],
                ['focus', 'Focus'],
                ['all', 'All'],
              ] as Array<[CalendarScope, string]>).map(([scope, label]) => (
                <button key={scope} className={calendarScope === scope ? 'active' : ''} onClick={() => setCalendarScope(scope)}>
                  {label}
                </button>
              ))}
            </div>
            <div className="segmented-control calendar-view-switcher" aria-label="Calendar view">
              {(['month', 'week', 'year'] as CalendarViewMode[]).map((mode) => (
                <button key={mode} className={viewMode === mode ? 'active' : ''} onClick={() => setViewMode(mode)}>
                  {mode[0].toUpperCase()}{mode.slice(1)}
                </button>
              ))}
            </div>
            <div className="calendar-nav" aria-label="Calendar navigation">
              <button type="button" aria-label="Previous calendar range" onClick={() => moveFocus(-1)}><ChevronLeft size={14} /> Prev</button>
              <button type="button" onClick={() => setFocusIso(calendarIso(today))}>Today</button>
              <button type="button" aria-label="Next calendar range" onClick={() => moveFocus(1)}>Next <ChevronRight size={14} /></button>
            </div>
            <details className="toolbar-drawer">
              <summary><ListFilter size={14} /> Lanes</summary>
              <div className="calendar-lanes" aria-label="Calendar lane filter">
                <button className={lane === 'all' ? 'active' : ''} onClick={() => setLane('all')}>All</button>
                {lanes.map((item) => (
                  <button key={item} className={lane === item ? 'active' : ''} onClick={() => setLane(item)}>{item}</button>
                ))}
              </div>
            </details>
          </div>
        )}
      />
      <div className="calendar-layout">
        {viewMode === 'year' ? (
          <CalendarYearPanel year={calendarYear} onOpen={onOpen} onSelectMonth={openMonth} />
        ) : (
          <section className={`calendar-month-card calendar-${viewMode}-card`}>
            <header>
              <h2>{focusLabel}</h2>
              <span>{focusCount} items this {viewMode}</span>
            </header>
            {rangeHiddenTaskCount > 0 && calendarScope !== 'all' && (
              <p className="calendar-density-note">
                {rangeHiddenTaskCount} routine task{rangeHiddenTaskCount === 1 ? '' : 's'} collapsed in this filtered calendar. Switch to All to inspect every dated task.
              </p>
            )}
            <div className="calendar-weekdays" aria-hidden="true">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => <span key={day}>{day}</span>)}
            </div>
            <div className={`calendar-grid ${viewMode === 'week' ? 'week-grid' : ''}`}>
              {(viewMode === 'week' ? calendarWeek.days : calendarMonth.weeks.flat()).map((day) => (
                <CalendarDayCell
                  key={day.iso}
                  day={day}
                  lane={lane}
                  onOpen={onOpen}
                  maxItems={viewMode === 'week' ? 8 : 3}
                  hiddenTaskCount={hiddenTaskCounts.get(day.iso) || 0}
                />
              ))}
            </div>
          </section>
        )}
        <aside className="calendar-agenda">
          <div className="overview-section-title">
            <h2><CalendarDays size={16} /> Agenda</h2>
            <span>{agendaItems.length}</span>
          </div>
          <p className="calendar-agenda-range">{focusLabel}</p>
          <div className="dense-list">
            {agendaItems.length === 0 ? <p className="muted">No dated items match this lane and density.</p> : agendaItems.map((item) => (
              <CalendarAgendaRow
                key={calendarItemKey(item)}
                item={item}
                onOpen={onOpen}
                onPatch={onPatchTaskMetadata}
                disabled={patchingTaskPath === item.entry.path}
              />
            ))}
          </div>
        </aside>
      </div>
    </section>
  );
}

function CalendarYearPanel({
  year,
  onOpen,
  onSelectMonth,
}: {
  year: ReturnType<typeof buildCalendarYear>;
  onOpen: (path: string) => void;
  onSelectMonth: (month: CalendarMonth) => void;
}) {
  return (
    <section className="calendar-month-card calendar-year-card">
      <header>
        <h2>{year.label}</h2>
        <span>{year.total_items} items this year</span>
      </header>
      <div className="calendar-year-grid">
        {year.months.map((month) => {
          const monthItems = uniqueCalendarItems(month.weeks.flat().filter((day) => day.isCurrentMonth).flatMap((day) => day.items)).slice(0, 4);
          return (
            <article className="calendar-year-month" key={`${month.year}-${month.month}`}>
              <button type="button" className="calendar-year-month-title" onClick={() => onSelectMonth(month)} aria-label={`Open ${month.label} month view`}>
                <strong>{new Date(month.year, month.month, 1).toLocaleDateString(undefined, { month: 'short' })}</strong>
                <span>{month.total_items}</span>
              </button>
              <div className="calendar-year-mini-grid" aria-hidden="true">
                {month.weeks.flat().map((day) => (
                  <span key={day.iso} className={`${day.isCurrentMonth ? '' : 'outside'} ${day.items.length ? 'has-items' : ''} ${day.isToday ? 'today' : ''}`}>
                    {day.isCurrentMonth ? day.day : ''}
                  </span>
                ))}
              </div>
              <div className="calendar-year-month-items">
                {monthItems.map((item) => (
                  <button key={calendarItemKey(item)} type="button" className={`calendar-year-item ${entryToneClass(item.entry)} ${calendarHighlightClass(item)}`} onClick={() => onOpen(item.entry.path)}>
                    {item.entry.title}
                  </button>
                ))}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function CalendarDayCell({
  day,
  lane,
  onOpen,
  maxItems = 3,
  hiddenTaskCount = 0,
}: {
  day: CalendarDay;
  lane: string;
  onOpen: (path: string) => void;
  maxItems?: number;
  hiddenTaskCount?: number;
}) {
  const items = day.items.filter((item) => lane === 'all' || item.lane === lane);
  return (
    <div className={`calendar-day ${day.isToday ? 'today' : ''} ${day.isCurrentMonth ? '' : 'outside'}`}>
      <span className="calendar-day-number">{day.day}</span>
      <div className="calendar-day-items">
        {items.slice(0, maxItems).map((item) => (
          <button
            className={`calendar-item ${item.kind} range-${item.rangePosition || 'single'} ${entryToneClass(item.entry)} ${calendarHighlightClass(item)}`}
            key={`${item.entry.path}:${item.date}`}
            title={`${item.entry.title} · ${calendarDateSpanLabel(item)}`}
            onClick={() => onOpen(item.entry.path)}
          >
            <span className="calendar-item-title">{item.entry.title}</span>
            {calendarShouldShowCompactHighlight(item) && <span className="calendar-item-badge">{item.highlightShortLabel}</span>}
            {item.rangePosition && item.rangePosition !== 'single' && <span className="calendar-item-range">{item.rangePosition}</span>}
          </button>
        ))}
        {items.length > maxItems && <span className="calendar-overflow">+{items.length - maxItems}</span>}
        {hiddenTaskCount > 0 && (
          <span className="calendar-hidden-tasks">
            {hiddenTaskCount} task{hiddenTaskCount === 1 ? '' : 's'} hidden
          </span>
        )}
      </div>
    </div>
  );
}

function CalendarAgendaRow({
  item,
  onOpen,
  onPatch,
  disabled,
}: {
  item: WorkbenchData['calendarItems'][number];
  onOpen: (path: string) => void;
  onPatch: (path: string, updates: TaskMetadataUpdates, currentModifiedAt?: number) => Promise<void> | void;
  disabled: boolean;
}) {
  const taskRow = isTask(item.entry);
  return (
    <article className={`calendar-agenda-row managed-row ${entryToneClass(item.entry)} ${calendarHighlightClass(item)} ${item.daysFromToday < 0 ? 'overdue' : ''}`}>
      <button className="managed-row-main" onClick={() => onOpen(item.entry.path)}>
        <div>
          <span className="calendar-agenda-title-line">
            <strong>{item.entry.title}</strong>
            {calendarShouldShowAgendaHighlight(item) && <span className="calendar-highlight-badge">{item.highlightLabel}</span>}
          </span>
          <span className={taskRow ? 'task-inline-detail' : undefined}>{item.lane} · {calendarDateSpanLabel(item)} · {item.entry.path}</span>
        </div>
        <div className={`row-meta ${taskRow ? 'task-inline-meta' : ''}`}>
          <TaskMetadataChips entry={item.entry} />
        </div>
      </button>
      {taskRow && <TaskDirectActions path={item.entry.path} title={item.entry.title} priority={item.entry.priority} assignee={taskAssignee(item.entry)} onPatch={onPatch} disabled={disabled} />}
      <TaskMetadataDisclosure entry={item.entry} detail={`${item.lane} · ${calendarDateSpanLabel(item)} · ${item.entry.path}`} />
    </article>
  );
}

function RecentView({
  data,
  onOpen,
  onPatchTaskMetadata,
  patchingTaskPath,
}: {
  data: WorkbenchData;
  onOpen: (path: string) => void;
  onPatchTaskMetadata: (path: string, updates: TaskMetadataUpdates, currentModifiedAt?: number) => Promise<void> | void;
  patchingTaskPath: string;
}) {
  return (
    <section className="work-view">
      <ViewHeader eyebrow="Activity view" title="Recent" meta={`${data.recentEntries.length} recently modified visible entries`} />
      <div className="work-table">
        {data.recentEntries.slice(0, 120).map((entry) => (
          <article className={`work-row managed-row ${entryToneClass(entry)}`} key={entry.path}>
            <button className="managed-row-main" onClick={() => onOpen(entry.path)}>
              <div>
                <strong>{entry.title}</strong>
                <span className={isTask(entry) ? 'task-inline-detail' : undefined}>{entryLens(entry)} · {entry.path}</span>
              </div>
              <div className={`row-meta ${isTask(entry) ? 'task-inline-meta' : ''}`}>
                <span>{formatStamp(entry.modified_at)}</span>
              </div>
            </button>
            {isTask(entry) && (
              <TaskDirectActions
                path={entry.path}
                title={entry.title}
                priority={entry.priority}
                assignee={taskAssignee(entry)}
                onPatch={onPatchTaskMetadata}
                disabled={patchingTaskPath === entry.path}
              />
            )}
            <TaskMetadataDisclosure entry={entry} detail={`${entryLens(entry)} · ${entry.path} · ${formatStamp(entry.modified_at)}`} />
          </article>
        ))}
      </div>
    </section>
  );
}

function LibraryView({
  entries,
  selectedPath,
  filters,
  setFilters,
  taskProjects,
  typeGroups,
  domainGroups,
  collectionGroups,
  entryProjectGroups,
  noteRoleGroups,
  onSelect,
  onQuickLook,
  onPatchTaskMetadata,
  patchingTaskPath,
}: {
  entries: VaultEntry[];
  selectedPath: string;
  filters: EntryFilters;
  setFilters: (next: EntryFilters | ((current: EntryFilters) => EntryFilters)) => void;
  taskProjects: string[];
  typeGroups: Array<{ lens: string; count: number }>;
  domainGroups: Array<{ lens: string; count: number }>;
  collectionGroups: Array<{ lens: string; count: number }>;
  entryProjectGroups: Array<{ lens: string; count: number }>;
  noteRoleGroups: Array<{ lens: string; count: number }>;
  onSelect: (path: string) => void;
  onQuickLook: (path: string) => void;
  onPatchTaskMetadata: (path: string, updates: TaskMetadataUpdates, currentModifiedAt?: number) => Promise<void> | void;
  patchingTaskPath: string;
}) {
  return (
    <section className="work-view">
      <ViewHeader eyebrow="Markdown browser" title="Library" meta={`${entries.length} Markdown entries match current filters`} />
      <MarkdownLibrary
        entries={entries}
        selectedPath={selectedPath}
        filters={filters}
        setFilters={setFilters}
        taskProjects={taskProjects}
        typeGroups={typeGroups}
        domainGroups={domainGroups}
        collectionGroups={collectionGroups}
        entryProjectGroups={entryProjectGroups}
        noteRoleGroups={noteRoleGroups}
        onSelect={onSelect}
        onQuickLook={onQuickLook}
        onPatchTaskMetadata={onPatchTaskMetadata}
        patchingTaskPath={patchingTaskPath}
        variant="view"
      />
    </section>
  );
}

const CLOSED_STATUSES = new Set(['done', 'cancelled', 'archived']);

export interface EditorRelated {
  projectReview?: ProjectReview;
  activeTasks: VaultEntry[];
  waitingTasks: VaultEntry[];
  upcoming: VaultEntry[];
  recent: VaultEntry[];
  backlinks: VaultEntry[];
  outgoing: VaultEntry[];
}

function projectKeyForEntry(entry: VaultEntry | null): string {
  if (!entry) return '';
  if (isProject(entry)) return entry.id || entry.project || entry.path.split('/')[1] || entry.title;
  return entry.project || entry.inferred_project || '';
}

function buildEditorRelated(entry: VaultEntry | null, entries: VaultEntry[], projectReview: ProjectReview[]): EditorRelated {
  if (!entry) {
    return { activeTasks: [], waitingTasks: [], upcoming: [], recent: [], backlinks: [], outgoing: [] };
  }
  const key = projectKeyForEntry(entry);
  const belongsToSameProject = (candidate: VaultEntry) => {
    if (!key) return false;
    return candidate.project === key || candidate.inferred_project === key || candidate.path.includes(`/projects/${key}/`);
  };
  const openProjectTasks = entries
    .filter((candidate) => candidate.path !== entry.path && isTask(candidate) && belongsToSameProject(candidate) && !CLOSED_STATUSES.has(String(candidate.status || '').toLowerCase()));
  const backlinkSet = new Set(entry.backlinks || []);
  const outgoingSet = new Set(entry.outgoing_links || []);
  return {
    projectReview: projectReview.find((item) => item.project.path === entry.path || item.project.id === key || item.project.project === key),
    activeTasks: openProjectTasks.filter((task) => !['waiting', 'blocked'].includes(String(task.status || '').toLowerCase())).slice(0, 8),
    waitingTasks: openProjectTasks.filter((task) => ['waiting', 'blocked'].includes(String(task.status || '').toLowerCase())).slice(0, 6),
    upcoming: entries
      .filter((candidate) => candidate.path !== entry.path && belongsToSameProject(candidate) && Boolean(candidate.due || candidate.date || candidate.start_date))
      .slice(0, 6),
    recent: entries.filter((candidate) => candidate.path !== entry.path && belongsToSameProject(candidate)).slice(0, 6),
    backlinks: entries.filter((candidate) => backlinkSet.has(candidate.path)).slice(0, 8),
    outgoing: entries.filter((candidate) => outgoingSet.has(candidate.title) || outgoingSet.has(candidate.id || '') || outgoingSet.has(candidate.path)).slice(0, 8),
  };
}

function MetadataField({
  label,
  field,
  value,
  onPatch,
  type = 'text',
  options,
  disabled,
}: {
  label: string;
  field: string;
  value: unknown;
  onPatch: (field: string, value: string | boolean) => void;
  type?: 'text' | 'date' | 'number' | 'select' | 'boolean';
  options?: string[];
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState(displayMetadataValue(value));
  useEffect(() => {
    setDraft(displayMetadataValue(value));
  }, [field, value]);
  const commit = () => {
    if (type === 'boolean') return;
    if (draft !== displayMetadataValue(value)) onPatch(field, draft);
  };
  if (type === 'select') {
    return (
      <label className="metadata-field">
        <span>{label}</span>
        <select value={draft} disabled={disabled} onChange={(event) => onPatch(field, event.target.value)}>
          {(options || []).map((option) => <option key={option || 'blank'} value={option}>{option || 'blank'}</option>)}
        </select>
      </label>
    );
  }
  if (type === 'boolean') {
    return (
      <label className="metadata-field checkbox-field">
        <input
          type="checkbox"
          checked={String(value).toLowerCase() === 'true' || value === true}
          disabled={disabled}
          onChange={(event) => onPatch(field, event.target.checked)}
        />
        <span>{label}</span>
      </label>
    );
  }
  return (
    <label className="metadata-field">
      <span>{label}</span>
      <input
        value={draft}
        disabled={disabled}
        type={type}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
        }}
      />
    </label>
  );
}

function isScalarFrontmatterValue(value: unknown): boolean {
  return value === null || value === undefined || ['string', 'number', 'boolean'].includes(typeof value);
}

function frontmatterInputType(field: string, value: unknown): 'text' | 'date' | 'number' | 'checkbox' {
  if (typeof value === 'boolean') return 'checkbox';
  if (['date', 'due', 'deadline', 'start_date', 'end_date', 'last_touched', 'completed', 'block_day'].includes(field)) return 'date';
  if (typeof value === 'number' || ['priority', 'estimate_minutes', 'duration_minutes'].includes(field)) return 'number';
  return 'text';
}

function frontmatterLabel(field: string): string {
  return field.replace(/_/g, ' ');
}

export function FrontmatterTable({
  frontmatter,
  disabled,
  onPatch,
}: {
  frontmatter: Record<string, unknown>;
  disabled: boolean;
  onPatch: (field: string, value: string | boolean) => void;
}) {
  const rows = Object.entries(frontmatter);
  const scalarRows = rows.filter(([, value]) => !isStructuredMetadataValue(value));
  const structuredRows = rows.filter(([, value]) => isStructuredMetadataValue(value));
  if (!rows.length) {
    return <p className="muted">No frontmatter found. Add fields in Source mode to surface them here.</p>;
  }
  return (
    <div className="frontmatter-table" aria-label="Frontmatter table">
      {scalarRows.map(([field, value]) => {
        const inputType = frontmatterInputType(field, value);
        const editable = isScalarFrontmatterValue(value);
        return (
          <label className={`frontmatter-row ${editable ? '' : 'readonly'}`} key={field}>
            <span>{frontmatterLabel(field)}</span>
            {editable ? (
              inputType === 'checkbox' ? (
                <input
                  type="checkbox"
                  checked={Boolean(value)}
                  disabled={disabled}
                  onChange={(event) => onPatch(field, event.target.checked)}
                />
              ) : (
                <input
                  type={inputType}
                  value={displayMetadataValue(value)}
                  disabled={disabled}
                  onChange={(event) => onPatch(field, event.target.value)}
                />
              )
            ) : (
              <code>{displayMetadataValue(value)}</code>
            )}
          </label>
        );
      })}
      {structuredRows.length > 0 && (
        <div className="frontmatter-row structured-frontmatter-row" role="note">
          <span>Structured data</span>
          <div>
            <strong>{structuredRows.map(([field]) => frontmatterLabel(field)).join(', ')}</strong>
            <small>Hidden from the metadata table. Use the visual preview or Source mode for these fields.</small>
          </div>
        </div>
      )}
    </div>
  );
}

function EditorCockpit({
  entry,
  file,
  taskProjects,
  related,
  content,
  onPatchTask,
  onPatchMetadata,
  disabled,
  onOpen,
  onCreateLinkedTask,
  onOpenView,
  onReplaceContent,
}: {
  entry: VaultEntry;
  file: VaultFile;
  taskProjects: string[];
  related: EditorRelated;
  content: string;
  onPatchTask: (path: string, updates: TaskMetadataUpdates, currentModifiedAt?: number) => Promise<void> | void;
  onPatchMetadata: (path: string, updates: VaultMetadataUpdates, currentModifiedAt?: number) => Promise<void> | void;
  disabled: boolean;
  onOpen: (path: string) => void;
  onCreateLinkedTask: () => void;
  onOpenView: (view: AppView) => void;
  onReplaceContent: (content: string) => void;
}) {
  const kind = isTask(entry) ? 'task' : isProject(entry) ? 'project' : 'note';
  const patch = (field: string, value: string | boolean) => {
    void onPatchMetadata(file.path, { [field]: value });
  };
  const setNextAction = () => {
    const current = displayMetadataValue(file.frontmatter.next || file.frontmatter.next_action);
    const next = window.prompt('Next action', current);
    if (next === null) return;
    void onPatchMetadata(file.path, { [kind === 'project' ? 'next_action' : 'next']: next });
  };
  const insertSections = () => {
    if (kind === 'project') {
      onReplaceContent(ensureMarkdownSections(content, [
        { title: 'Next', body: '- ' },
        { title: 'Progress', body: `- ${todayIso()}: ` },
        { title: 'Open decisions', body: '- [ ] ' },
        { title: 'Blockers', body: '- ' },
      ]));
    } else if (kind === 'task') {
      onReplaceContent(ensureMarkdownSections(content, [
        { title: 'Subtasks', body: '- [ ] ' },
        { title: 'Next action', body: '- [ ] ' },
        { title: 'Codex instructions', body: '' },
        { title: 'Log', body: `- ${todayIso()}: ` },
        { title: 'Sources', body: '- ' },
        { title: 'Related', body: '- ' },
      ]));
    } else {
      onReplaceContent(ensureMarkdownSections(content, [
        { title: 'Summary', body: '' },
        { title: 'Actions', body: '- [ ] ' },
        { title: 'Sources', body: '- ' },
      ]));
    }
  };
  const addSubtask = () => {
    const subtask = window.prompt('Subtask');
    if (subtask === null) return;
    onReplaceContent(appendToMarkdownSection(content, 'Subtasks', `- [ ] ${subtask.trim()}`));
  };
  const appendLog = () => {
    const item = window.prompt(kind === 'project' ? 'Progress log entry' : 'Log entry');
    if (item === null) return;
    onReplaceContent(appendToMarkdownSection(content, kind === 'project' ? 'Progress' : 'Log', `- ${todayIso()}: ${item.trim()}`));
  };
  const appendNextAction = () => {
    const next = window.prompt('Next action', displayMetadataValue(file.frontmatter.next || file.frontmatter.next_action));
    if (next === null) return;
    const field = kind === 'project' ? 'next_action' : 'next';
    void onPatchMetadata(file.path, { [field]: next });
    onReplaceContent(appendToMarkdownSection(content, kind === 'project' ? 'Next' : 'Next action', `- [ ] ${next.trim()}`));
  };
  const codexInstructions = kind === 'task' ? parseCodexInstructions(content) : [];
  const codexCounts = codexInstructionCounts(codexInstructions);
  const activeCodexInstructions = codexInstructions
    .filter((instruction) => instruction.status === 'queued' || instruction.status === 'blocked')
    .slice(0, 4);
  const addCodexInstruction = () => {
    const instruction = window.prompt('Codex instruction for this task');
    if (instruction === null) return;
    const clean = instruction.trim();
    if (!clean) return;
    onReplaceContent(appendToMarkdownSection(content, 'Codex instructions', `- [ ] queued | ${todayIso()} | ${clean}`));
  };
  const appendDecision = () => {
    const decision = window.prompt('Decision');
    if (decision === null) return;
    onReplaceContent(appendToMarkdownSection(content, 'Open decisions', `- ${todayIso()}: ${decision.trim()}`));
  };
  const appendBlocker = () => {
    const blocker = window.prompt('Blocker');
    if (blocker === null) return;
    onReplaceContent(appendToMarkdownSection(content, 'Blockers', `- ${todayIso()}: ${blocker.trim()}`));
  };
  const markStatus = (status: string) => {
    void onPatchMetadata(file.path, {
      status,
      completed: LIFECYCLE_CLOSED_STATUSES.has(status) ? todayIso() : null,
    });
  };
  const metadataFields = Object.values(file.frontmatter).filter((value) => !isStructuredMetadataValue(value)).length;
  const structuredMetadataFields = Object.values(file.frontmatter).filter(isStructuredMetadataValue).length;
  const taskSummaryChips = kind === 'task'
    ? [
        file.frontmatter.status || entry.status ? String(file.frontmatter.status || entry.status) : null,
        file.frontmatter.priority || entry.priority ? `P${String(file.frontmatter.priority || entry.priority)}` : null,
        file.frontmatter.deadline_type || entry.deadline_type ? `${String(file.frontmatter.deadline_type || entry.deadline_type)} deadline` : null,
        entry.due || entry.date || entry.start_date ? dueLabel(entry, 'relative') : null,
        entry.estimate_minutes || file.frontmatter.estimate_minutes ? minutesLabel(Number(entry.estimate_minutes || file.frontmatter.estimate_minutes)) : null,
      ].filter((chip): chip is string => Boolean(chip))
    : [];
  const copyBrief = async () => {
    const linkedEntries = [...related.backlinks, ...related.outgoing, ...related.recent].slice(0, 8);
    const queuedInstructions = codexInstructions.filter((instruction) => instruction.status === 'queued');
    const lines = [
      '# Codex Task Brief',
      '',
      `Task: ${entry.title}`,
      `Path: ${file.path}`,
      `Project: ${entry.project || file.frontmatter.project || 'none'}`,
      `Status: ${file.frontmatter.status || entry.status || 'open'}`,
      `Priority: ${file.frontmatter.priority || entry.priority || 'none'}`,
      `Deadline type: ${file.frontmatter.deadline_type || entry.deadline_type || 'soft'}`,
      `Due: ${file.frontmatter.due || entry.due || 'none'}`,
      `Next: ${file.frontmatter.next || entry.next || 'none'}`,
      '',
      '## Related Project',
      related.projectReview
        ? `- ${related.projectReview.project.title} | ${related.projectReview.openTaskCount} open tasks | ${related.projectReview.stale ? related.projectReview.staleReason : 'current'}`
        : '- No project review summary found.',
      '',
      '## Active Sibling Tasks',
      ...(related.activeTasks.length ? related.activeTasks.map((task) => `- ${task.title} | ${task.path}`) : ['- None']),
      '',
      '## Waiting / Blocked',
      ...(related.waitingTasks.length ? related.waitingTasks.map((task) => `- ${task.title} | ${task.status || 'waiting'} | ${task.path}`) : ['- None']),
      '',
      '## Recent / Linked Notes',
      ...(linkedEntries.length ? linkedEntries.map((item) => `- ${entryLens(item)} | ${item.title} | ${item.path}`) : ['- None']),
      '',
      '## Queued Codex Instructions',
      ...(queuedInstructions.length ? queuedInstructions.map(formatCodexInstruction) : ['- None']),
      '',
      '## Markdown',
      '```markdown',
      content,
      '```',
      '',
      'Requested output: recommend the next concrete action, blockers, and any task/project metadata edits. Do not mark work complete unless there is explicit evidence.',
    ];
    await navigator.clipboard?.writeText(lines.join('\n'));
  };
  const editorActions: Array<{ key: string; label: string; icon?: ReactNode; onClick: () => void; disabled?: boolean }> = [
    ...(kind === 'task' ? [
      { key: 'done', label: 'Done', icon: <Check size={14} />, onClick: () => markStatus('done'), disabled },
      { key: 'waiting', label: 'Waiting', onClick: () => markStatus('waiting'), disabled },
      { key: 'blocked', label: 'Blocked', onClick: () => markStatus('blocked'), disabled },
      { key: 'subtask', label: 'Add subtask', onClick: addSubtask },
      { key: 'log', label: 'Append log', onClick: appendLog },
      { key: 'next-append', label: 'Append next', onClick: appendNextAction },
      { key: 'brief', label: 'Copy Task Brief', onClick: () => void copyBrief() },
    ] : []),
    ...(kind === 'project' ? [
      { key: 'progress', label: 'Append progress', onClick: appendLog },
      { key: 'decision', label: 'Add decision', onClick: appendDecision },
      { key: 'blocker', label: 'Add blocker', onClick: appendBlocker },
      { key: 'project-next', label: 'Append next', onClick: appendNextAction },
    ] : []),
    { key: 'set-next', label: 'Set next', onClick: setNextAction, disabled },
    { key: 'sections', label: 'Insert sections', onClick: insertSections },
    { key: 'linked-task', label: 'Linked task', icon: <Plus size={14} />, onClick: onCreateLinkedTask },
    ...(related.projectReview ? [{ key: 'project', label: 'Project', onClick: () => onOpen(related.projectReview!.project.path) }] : []),
    { key: 'tasks', label: 'Tasks', icon: <ClipboardList size={14} />, onClick: () => onOpenView('open-tasks') },
    { key: 'calendar', label: 'Calendar', icon: <CalendarDays size={14} />, onClick: () => onOpenView('calendar') },
    { key: 'time-plan', label: 'Time Plan', icon: <Clock3 size={14} />, onClick: () => onOpenView('time-plan') },
  ];
  const mobilePrimaryKeys = new Set(kind === 'task' ? ['done', 'waiting'] : kind === 'project' ? ['progress', 'project-next'] : ['set-next', 'sections']);
  const mobilePrimaryActions = editorActions.filter((action) => mobilePrimaryKeys.has(action.key));
  const mobileSecondaryActions = editorActions.filter((action) => !mobilePrimaryKeys.has(action.key));
  const renderEditorAction = (action: typeof editorActions[number]) => (
    <button key={action.key} onClick={action.onClick} disabled={action.disabled}>
      {action.icon}
      {action.label}
    </button>
  );
  return (
    <section className={`editor-cockpit ${kind} cogito-meta-panel`} aria-label={`${kind} frontmatter and actions`}>
      <div className="cockpit-main">
        <div className={`cockpit-heading ${kind === 'task' ? 'task-editor-heading' : ''}`}>
          <div className="cockpit-title-block">
            <span className="eyebrow">{kind === 'task' ? 'Task' : `${kind} metadata`}</span>
            <strong>{kind === 'task' ? entry.title : file.path}</strong>
            {kind === 'task' && <small>{file.path}</small>}
          </div>
          {taskSummaryChips.length > 0 && (
            <div className="task-editor-chip-row" aria-label="Task summary">
              {taskSummaryChips.map((chip) => <span key={chip}>{chip}</span>)}
            </div>
          )}
        </div>
        <details className="editor-metadata-disclosure">
          <summary>
            <span>Metadata</span>
            <small>{metadataFields} fields{structuredMetadataFields ? ` · ${structuredMetadataFields} structured` : ''}</small>
          </summary>
          <FrontmatterTable
            frontmatter={file.frontmatter}
            disabled={disabled}
            onPatch={patch}
          />
        </details>
        {kind === 'task' && (
          <details className="codex-instructions-disclosure">
            <summary>
              <span><Bot size={14} /> Codex instructions</span>
              <small>{codexCounts.queued} queued · {codexCounts.processed} processed</small>
            </summary>
            <div className="codex-instructions-body">
              <p>Durable instructions for a future Codex pass. Keep sensitive details in private files or redact before GitHub sync.</p>
              {activeCodexInstructions.length > 0 ? (
                <div className="codex-instruction-list">
                  {activeCodexInstructions.map((instruction) => (
                    <span key={`${instruction.line || instruction.date || ''}:${instruction.text}`}>
                      <b>{instruction.status}</b>
                      {instruction.date && <em>{instruction.date}</em>}
                      {instruction.text}
                    </span>
                  ))}
                </div>
              ) : (
                <span className="muted">No queued or blocked instructions.</span>
              )}
              <button type="button" onClick={addCodexInstruction}>
                <Plus size={14} /> Add instruction
              </button>
            </div>
          </details>
        )}
        <div className="editor-action-row editor-action-row-desktop">
          {editorActions.map(renderEditorAction)}
        </div>
        <div className="editor-action-row-mobile">
          <div className="mobile-primary-actions">
            {mobilePrimaryActions.map(renderEditorAction)}
          </div>
          {mobileSecondaryActions.length > 0 && (
            <details className="mobile-editor-action-menu">
              <summary><MoreHorizontal size={15} /> More</summary>
              <div>
                {mobileSecondaryActions.map(renderEditorAction)}
              </div>
            </details>
          )}
        </div>
      </div>
    </section>
  );
}

function RelatedWorkPanel({ related, onOpen }: { related: EditorRelated; onOpen: (path: string) => void }) {
  const project = related.projectReview;
  const recentLinked = [...related.outgoing, ...related.recent].slice(0, 6);
  return (
    <aside className="related-work-panel">
      <div className="related-column project-summary">
        <strong>Project</strong>
        {project ? (
          <button className="related-project-button" onClick={() => onOpen(project.project.path)}>
            <span>{project.project.status || 'project'} · {project.openTaskCount} open tasks</span>
            <strong>{project.project.title}</strong>
            <small>{project.project.next || project.project.snippet || 'No next action recorded.'}</small>
          </button>
        ) : (
          <span className="muted">No parent project summary.</span>
        )}
      </div>
      <div className="related-column">
        <strong>Active tasks</strong>
        <RelatedEntryList entries={related.activeTasks} onOpen={onOpen} empty="No active linked tasks." />
      </div>
      <div className="related-column">
        <strong>Waiting</strong>
        <RelatedEntryList entries={related.waitingTasks} onOpen={onOpen} empty="No waiting blockers." />
      </div>
      <div className="related-column">
        <strong>Upcoming</strong>
        <RelatedEntryList entries={related.upcoming} onOpen={onOpen} empty="No upcoming dated items." />
      </div>
      <div className="related-column">
        <strong>Backlinks</strong>
        <RelatedEntryList entries={related.backlinks} onOpen={onOpen} empty="No backlinks found." />
      </div>
      <div className="related-column">
        <strong>Outgoing / recent</strong>
        <RelatedEntryList entries={recentLinked} onOpen={onOpen} empty="No related notes found." />
      </div>
    </aside>
  );
}

function RelatedEntryList({ entries, onOpen, empty }: { entries: VaultEntry[]; onOpen: (path: string) => void; empty: string }) {
  if (!entries.length) return <span className="muted">{empty}</span>;
  return (
    <div className="related-entry-list">
      {entries.map((entry) => (
        <button key={entry.path} onClick={() => onOpen(entry.path)}>
          <span>{entryLens(entry)}</span>
          <strong>{entry.title}</strong>
        </button>
      ))}
    </div>
  );
}

function ProjectReviewCard({ item, onOpen }: { item: ProjectReview; onOpen: (path: string) => void }) {
  const next = item.project.next || item.project.snippet || 'No next action recorded.';
  return (
    <article className={`project-review-card ${entryToneClass(item.project)} ${item.stale ? 'stale' : ''}`}>
      <button className="project-title-button" onClick={() => onOpen(item.project.path)}>
        <span className="eyebrow">P{item.project.priority || '-'} · {item.project.status || 'no status'}</span>
        <strong>{item.project.title}</strong>
      </button>
      <p>{next}</p>
      <div className="chips">
        <span>{item.openTaskCount} open tasks</span>
        {(item.project.due || item.project.date) && <span>{dueLabel(item.project)}</span>}
        {item.stale && <span className="status blocked">{item.staleReason}</span>}
      </div>
      <div className="project-links">
        {item.openTasks.slice(0, 3).map((task) => (
          <button key={task.path} onClick={() => onOpen(task.path)}>{task.title}</button>
        ))}
        {item.openTasks.length === 0 && <span className="muted">No open tasks linked.</span>}
      </div>
      <div className="recent-project-links">
        {item.recentEntries.slice(0, 3).map((entry) => (
          <button key={entry.path} onClick={() => onOpen(entry.path)}>
            {entryLens(entry)} · {entry.title}
          </button>
        ))}
      </div>
    </article>
  );
}

function ProjectReviewRow({ item, onOpen }: { item: ProjectReview; onOpen: (path: string) => void }) {
  const next = item.project.next || item.project.snippet || 'No next action recorded.';
  const recent = item.recentEntries[0];
  return (
    <article className={`project-review-row ${entryToneClass(item.project)} ${item.stale ? 'stale' : ''}`}>
      <button className="project-title-button" onClick={() => onOpen(item.project.path)}>
        <strong>{item.project.title}</strong>
        <span>{item.project.project || item.project.id || item.project.path}</span>
      </button>
      <div className="project-stage-cell">
        {item.project.priority && <PriorityChip value={item.project.priority} />}
        <StatusChip value={item.project.status || 'active'} />
      </div>
      <p className="project-next-cell">{next}</p>
      <span className="project-count-cell">{item.openTaskCount} open</span>
      <div className="chips">
        {(item.project.due || item.project.date) ? <DateChip entry={item.project} /> : <span>no deadline</span>}
      </div>
      <div className="project-health-cell">
        {item.stale ? <span className="status blocked">{item.staleReason}</span> : <span className="status done">current</span>}
        <details className="project-row-details">
          <summary>Details</summary>
          <div className="project-row-expanded">
            <button onClick={() => onOpen(item.project.path)}>Open project file</button>
            {item.openTasks.slice(0, 3).map((task) => (
              <button key={task.path} onClick={() => onOpen(task.path)}>{task.title}</button>
            ))}
            {recent && (
              <button onClick={() => onOpen(recent.path)}>
                {entryLens(recent)} · {recent.title}
              </button>
            )}
          </div>
        </details>
      </div>
    </article>
  );
}

export function Sidebar({
  config = DEFAULT_WORKBENCH_CONFIG,
  activeView,
  onView,
  urgentTasks,
  onOpen,
}: {
  config?: WorkbenchConfig;
  activeView: AppView;
  onView: (view: AppView) => void;
  urgentTasks: VaultEntry[];
  onOpen: (path: string) => void;
}) {
  const baseNavSections: Array<{ title: string; items: Array<{ view: AppView; label: string; icon: ReactNode }> }> = [
    {
      title: 'Work',
      items: [
	        { view: 'overview', label: 'Overview', icon: <Home size={16} /> },
	        { view: 'open-tasks', label: 'Open Tasks', icon: <ClipboardList size={16} /> },
	        { view: 'codex-backlog', label: 'Codex Backlog', icon: <Bot size={16} /> },
	        { view: 'time-plan', label: 'Time Plan', icon: <Clock3 size={16} /> },
	        { view: 'admin-center', label: 'Admin Center', icon: <SlidersHorizontal size={16} /> },
	        { view: 'performance-evaluation', label: 'Performance Evaluation', icon: <Award size={16} /> },
	        { view: 'travel-center', label: 'Travel Center', icon: <Plane size={16} /> },
	        { view: 'ra-management', label: 'Collaborators', icon: <UsersRound size={16} /> },
	        { view: 'health-review', label: 'Health Review', icon: <HeartPulse size={16} /> },
	      ],
    },
    {
      title: 'Review',
      items: [
        { view: 'projects', label: 'Projects', icon: <Layers size={16} /> },
        { view: 'calendar', label: 'Calendar', icon: <CalendarDays size={16} /> },
        { view: 'recent', label: 'Recent', icon: <Activity size={16} /> },
      ],
    },
    {
      title: 'Vault',
      items: [
        { view: 'sync', label: 'Sync', icon: <GitBranch size={16} /> },
        { view: 'types', label: 'Types', icon: <Tags size={16} /> },
        { view: 'library', label: 'Library', icon: <FileText size={16} /> },
      ],
    },
  ];
  const navSections = baseNavSections.map((section) => ({
    ...section,
    items: section.items
      .filter((item) => isViewEnabled(config, item.view))
      .map((item) => ({ ...item, label: viewLabel(config, item.view, item.label) })),
  })).filter((section) => section.items.length > 0);
  return (
    <aside className="sidebar">
      <div className="brand">
        <FolderGit2 size={22} />
        <div>
          <strong>{config.application_name}</strong>
          <span>Markdown-first research</span>
        </div>
      </div>
      {navSections.map((section) => (
        <section className="nav-section" key={section.title}>
          <div className="panel-title"><Columns3 size={15} /> {section.title}</div>
          {section.items.map((item) => (
            <button
              key={item.view}
              className={`nav-button ${activeView === item.view || (item.view === 'projects' && activeView === 'project-detail') ? 'active' : ''}`}
              onClick={() => onView(item.view)}
            >
              {item.icon} {item.label}
            </button>
          ))}
        </section>
      ))}
      {activeView !== 'overview' && <section className="sidebar-urgent" aria-label="Focus tasks">
        <header>
          <span>Focus</span>
          <button type="button" onClick={() => onView('open-tasks')}>All tasks</button>
        </header>
        {urgentTasks.length === 0 ? (
          <p>No focus tasks.</p>
        ) : (
          <div className="sidebar-urgent-list">
            {urgentTasks.slice(0, 3).map((task) => (
              <button
                type="button"
                key={task.path}
                className={`sidebar-urgent-task ${entryToneClass(task)}`}
                onClick={() => onOpen(task.path)}
              >
                <span className="sidebar-urgent-dot" aria-hidden="true" />
                <span className="sidebar-urgent-copy">
                  <strong>{task.title}</strong>
                  <span className="sidebar-urgent-meta">
                    {focusReason(task) && (
                      <span className="sidebar-urgent-meta-token">{focusReason(task)}</span>
                    )}
                    <DateChip entry={task} mode="relative" />
                    {task.priority && (
                      <span className="sidebar-urgent-meta-token">{task.priority}</span>
                    )}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
      </section>}
    </aside>
  );
}

function TaskFilterControls({
  filters,
  setFilters,
  taskProjects,
  compact = false,
}: {
  filters: EntryFilters;
  setFilters: (next: EntryFilters | ((current: EntryFilters) => EntryFilters)) => void;
  taskProjects: string[];
  compact?: boolean;
}) {
  return (
    <div className={`task-filters ${compact ? 'compact' : ''}`}>
      <ListFilter size={15} />
      <select aria-label="Task status filter" value={filters.taskStatus} onChange={(event) => setFilters((current) => ({ ...current, taskStatus: event.target.value }))}>
        <option value="">Any status</option>
        <option value="open">open</option>
        <option value="active">active</option>
        <option value="waiting">waiting</option>
        <option value="done">done</option>
      </select>
      <select aria-label="Task priority filter" value={filters.taskPriority} onChange={(event) => setFilters((current) => ({ ...current, taskPriority: event.target.value }))}>
        <option value="">Any P</option>
        <option value="1">P1</option>
        <option value="2">P2</option>
        <option value="3">P3</option>
        <option value="4">P4</option>
      </select>
      <select aria-label="Task project filter" value={filters.taskProject} onChange={(event) => setFilters((current) => ({ ...current, taskProject: event.target.value }))}>
        <option value="">Any project</option>
        {taskProjects.map((project) => <option key={project} value={project}>{project}</option>)}
      </select>
    </div>
  );
}

function MarkdownLibrary({
  entries,
  selectedPath,
  filters,
  setFilters,
  taskProjects,
  typeGroups,
  domainGroups,
  collectionGroups,
  entryProjectGroups,
  noteRoleGroups,
  onSelect,
  onQuickLook,
  onPatchTaskMetadata,
  patchingTaskPath,
  variant,
}: {
  entries: VaultEntry[];
  selectedPath: string;
  filters: EntryFilters;
  setFilters: (next: EntryFilters | ((current: EntryFilters) => EntryFilters)) => void;
  taskProjects: string[];
  typeGroups: Array<{ lens: string; count: number }>;
  domainGroups: Array<{ lens: string; count: number }>;
  collectionGroups: Array<{ lens: string; count: number }>;
  entryProjectGroups: Array<{ lens: string; count: number }>;
  noteRoleGroups: Array<{ lens: string; count: number }>;
  onSelect: (path: string) => void;
  onQuickLook: (path: string) => void;
  onPatchTaskMetadata: (path: string, updates: TaskMetadataUpdates, currentModifiedAt?: number) => Promise<void> | void;
  patchingTaskPath: string;
  variant: 'panel' | 'view';
}) {
  return (
    <section className={`markdown-library ${variant}`} aria-label="Markdown library">
      <div className="search-box">
        <Search size={16} />
        <input
          value={filters.query}
          onChange={(event) => setFilters((current) => ({ ...current, query: event.target.value }))}
          placeholder="Search files, tasks, projects..."
        />
      </div>
      <details className="toolbar-drawer library-filter-drawer">
        <summary><ListFilter size={14} /> Filters</summary>
        <div className="library-filters">
          <select aria-label="Type filter" value={filters.lens} onChange={(event) => setFilters((current) => ({ ...current, lens: event.target.value }))}>
            <option value="all">All types</option>
            {typeGroups.map((item) => (
              <option key={item.lens} value={item.lens}>{item.lens} ({item.count})</option>
            ))}
          </select>
          {variant === 'view' && (
            <>
              <select aria-label="Domain filter" value={filters.domain} onChange={(event) => setFilters((current) => ({ ...current, domain: event.target.value }))}>
                <option value="">All domains</option>
                {domainGroups.map((item) => (
                  <option key={item.lens} value={item.lens}>{domainLabel(item.lens)} ({item.count})</option>
                ))}
              </select>
              <select aria-label="Collection filter" value={filters.collection} onChange={(event) => setFilters((current) => ({ ...current, collection: event.target.value }))}>
                <option value="">All collections</option>
                {collectionGroups.map((item) => (
                  <option key={item.lens} value={item.lens}>{item.lens} ({item.count})</option>
                ))}
              </select>
              <select aria-label="Project or area filter" value={filters.entryProject} onChange={(event) => setFilters((current) => ({ ...current, entryProject: event.target.value }))}>
                <option value="">All projects / areas</option>
                {entryProjectGroups.map((item) => (
                  <option key={item.lens} value={item.lens}>{item.lens} ({item.count})</option>
                ))}
              </select>
              <select aria-label="Note role filter" value={filters.noteRole} onChange={(event) => setFilters((current) => ({ ...current, noteRole: event.target.value }))}>
                <option value="">All note roles</option>
                {noteRoleGroups.map((item) => (
                  <option key={item.lens} value={item.lens}>{item.lens} ({item.count})</option>
                ))}
              </select>
            </>
          )}
        </div>
        {(filters.lens === 'all' || filters.lens === 'task') && (
          <TaskFilterControls filters={filters} setFilters={setFilters} taskProjects={taskProjects} />
        )}
      </details>
      <div className="list-count">{entries.length} visible entries</div>
      <div className="entries">
        {entries.map((entry) => (
          <article
            key={entry.path}
            className={`library-row managed-row ${entryToneClass(entry)} ${selectedPath === entry.path ? 'active' : ''}`}
          >
            <button
              className="library-row-main"
              onClick={() => onSelect(entry.path)}
              onKeyDown={(event) => {
                if (event.key !== ' ') return;
                event.preventDefault();
                onQuickLook(entry.path);
              }}
            >
              <div className="entry-top">
                <span className={`kind ${kindToneClass(entry)}`}><Circle size={10} /> {entryLens(entry)}</span>
                <span className="domain-chip">{domainLabel(entryDomain(entry))}</span>
                {entry.private && <span className="private-chip">private</span>}
              </div>
              <strong>{entry.title}</strong>
              <span className={`path ${isTask(entry) ? 'task-inline-detail' : ''}`}>{entry.path}</span>
              <div className={`chips ${isTask(entry) ? 'task-inline-meta' : ''}`}>
                {entry.collection && <span>{entry.collection}</span>}
                {entry.project && <span>{entry.project}</span>}
                {entry.note_role && <span>{entry.note_role}</span>}
                {entry.status && <StatusChip value={entry.status} />}
                {entry.priority && <PriorityChip value={entry.priority} />}
                {(entry.due || entry.date) && <DateChip entry={entry} />}
              </div>
            </button>
            <button
              type="button"
              className="quick-look-row-button"
              aria-label={`Quick Look ${entry.title}`}
              title="Quick Look"
              onClick={() => onQuickLook(entry.path)}
            >
              <FileText size={14} />
            </button>
            {isTask(entry) && (
              <TaskDirectActions
                path={entry.path}
                title={entry.title}
                priority={entry.priority}
                assignee={taskAssignee(entry)}
                onPatch={onPatchTaskMetadata}
                disabled={patchingTaskPath === entry.path}
              />
            )}
            <TaskMetadataDisclosure entry={entry} detail={`${entry.project || entryLens(entry)} · ${entry.path}`} />
          </article>
        ))}
      </div>
    </section>
  );
}

function EditorView({
  selectedEntry,
  selectedFile,
  content,
  dirty,
  saving,
  error,
  loading,
  editorMode,
  setEditorMode,
  onSave,
  onOpenPalette,
  onQuickLook,
  typography,
  setTypography,
  typographyOpen,
  setTypographyOpen,
  contextPanelOpen,
  onToggleContextPanel,
  onApplyFrontmatter,
  onContentChange,
  taskProjects,
  entries,
  projectReview,
  onOpen,
  onCreateLinkedTask,
  onOpenView,
  onRetryOpen,
}: {
  selectedEntry: VaultEntry | null;
  selectedFile: VaultFile | null;
  content: string;
  dirty: boolean;
  saving: boolean;
  error: string;
  loading: boolean;
  editorMode: EditorMode;
  setEditorMode: (mode: EditorMode) => void;
  onSave: () => void;
  onOpenPalette: () => void;
  onQuickLook: () => void;
  typography: TypographyPreferences;
  setTypography: (value: TypographyPreferences | ((current: TypographyPreferences) => TypographyPreferences)) => void;
  typographyOpen: boolean;
  setTypographyOpen: (open: boolean) => void;
  contextPanelOpen: boolean;
  onToggleContextPanel: () => void;
  onApplyFrontmatter: (frontmatter: Record<string, unknown>) => void;
  onContentChange: (content: string) => void;
  taskProjects: string[];
  entries: VaultEntry[];
  projectReview: ProjectReview[];
  onOpen: (path: string) => void;
  onCreateLinkedTask: () => void;
  onOpenView: (view: AppView) => void;
  onRetryOpen: () => void;
}) {
  const related = useMemo(() => buildEditorRelated(selectedEntry, entries, projectReview), [selectedEntry, entries, projectReview]);
  const stageTaskMetadata = (_path: string, updates: TaskMetadataUpdates) => {
    if (!selectedFile) return;
    onApplyFrontmatter(applyTaskMetadataUpdates(frontmatterFromContent(content, selectedFile.frontmatter || {}), updates));
  };
  const stageMetadata = (_path: string, updates: VaultMetadataUpdates) => {
    if (!selectedFile) return;
    onApplyFrontmatter(applyMetadataUpdates(frontmatterFromContent(content, selectedFile.frontmatter || {}), updates));
  };
  const replaceContent = (nextContent: string) => {
    onContentChange(nextContent);
  };

  return (
    <>
      <Header
        entry={selectedEntry}
        file={selectedFile}
        dirty={dirty}
        saving={saving}
        error={error}
        editorMode={editorMode}
        setEditorMode={setEditorMode}
        onSave={onSave}
        onOpenPalette={onOpenPalette}
        onQuickLook={onQuickLook}
        typography={typography}
        setTypography={setTypography}
        typographyOpen={typographyOpen}
        setTypographyOpen={setTypographyOpen}
        contextPanelOpen={contextPanelOpen}
        onToggleContextPanel={onToggleContextPanel}
      />
      {selectedFile && selectedEntry ? (
        <div className={`editor-workspace ${contextPanelOpen ? 'context-open' : ''}`} style={typographyCssVariables(typography)}>
          <div className="editor-document-shell">
          <EditorCockpit
            entry={selectedEntry}
            file={selectedFile}
            taskProjects={taskProjects}
            related={related}
            content={content}
            onPatchTask={stageTaskMetadata}
            onPatchMetadata={stageMetadata}
            disabled={saving}
            onOpen={onOpen}
            onCreateLinkedTask={onCreateLinkedTask}
            onOpenView={onOpenView}
            onReplaceContent={replaceContent}
          />
          <div className={`editor-split mode-${editorMode}`}>
            {editorMode !== 'preview' && (
              <section className="raw-editor" aria-label="Raw Markdown editor">
                <Suspense fallback={<div className="editor-lazy-fallback">Loading source editor...</div>}>
                  <MarkdownEditor content={content} onChange={onContentChange} />
                </Suspense>
              </section>
            )}
            {editorMode !== 'raw' && (
              <section className="preview" aria-label="Markdown preview">
                <div className="preview-inner">
                  {isTravelLedgerFile(selectedEntry, selectedFile) ? (
                    <TravelLedgerVisualPreview file={selectedFile} content={content} onOpen={onOpen} />
                  ) : isTravelItineraryFile(selectedEntry, selectedFile) ? (
                    <TravelItineraryVisualPreview file={selectedFile} content={content} onOpen={onOpen} />
                  ) : (
                    <Suspense fallback={<div className="preview-lazy-fallback">Rendering preview...</div>}>
                      <MarkdownRenderer content={content} />
                    </Suspense>
                  )}
                </div>
              </section>
            )}
          </div>
          </div>
          {contextPanelOpen && (
            <ContextComposer
              entry={selectedEntry}
              file={selectedFile}
              content={content}
              related={related}
            />
          )}
        </div>
      ) : (
        <div className="empty-state">
          <FileText size={28} />
          <p>{loading ? 'Loading file...' : 'Could not open this Markdown file.'}</p>
          {error && <span className="error">{error}</span>}
          {selectedEntry && <span className="path">{selectedEntry.path}</span>}
          {selectedEntry && <button onClick={onRetryOpen}>Retry open</button>}
        </div>
      )}
    </>
  );
}

function Header({
  entry,
  file,
  dirty,
  saving,
  error,
  editorMode,
  setEditorMode,
  onSave,
  onOpenPalette,
  onQuickLook,
  typography,
  setTypography,
  typographyOpen,
  setTypographyOpen,
  contextPanelOpen,
  onToggleContextPanel,
}: {
  entry: VaultEntry | null;
  file: VaultFile | null;
  dirty: boolean;
  saving: boolean;
  error: string;
  editorMode: EditorMode;
  setEditorMode: (mode: EditorMode) => void;
  onSave: () => void;
  onOpenPalette: () => void;
  onQuickLook: () => void;
  typography: TypographyPreferences;
  setTypography: (value: TypographyPreferences | ((current: TypographyPreferences) => TypographyPreferences)) => void;
  typographyOpen: boolean;
  setTypographyOpen: (open: boolean) => void;
  contextPanelOpen: boolean;
  onToggleContextPanel: () => void;
}) {
  const modeLabels: Record<EditorMode, string> = { split: 'Split', preview: 'Preview', raw: 'Source' };
  return (
    <header className="editor-header cogito-editor-header">
      <div>
        <span className="eyebrow">{entry ? entryLens(entry) : 'No file selected'}</span>
        <h1>{entry?.title || 'Markdown workbench'}</h1>
        <p>{file?.path || 'Open a Markdown file from the list.'}</p>
        {error && <p className="error">{error}</p>}
      </div>
      <div className="header-actions">
        <div className="segmented-control icon-segmented-control" aria-label="Editor mode">
          {(['split', 'preview', 'raw'] as const).map((mode) => (
            <button key={mode} className={editorMode === mode ? 'active' : ''} onClick={() => setEditorMode(mode)} title={modeLabels[mode]}>
              {modeLabels[mode]}
            </button>
          ))}
        </div>
        <div className="toolbar-popover-wrap">
          <button
            type="button"
            aria-label="Open typography settings"
            title="Typography"
            className={typographyOpen ? 'active' : ''}
            onClick={() => setTypographyOpen(!typographyOpen)}
          >
            <Type size={16} />
          </button>
          {typographyOpen && (
            <TypographySettings
              preferences={typography}
              onChange={setTypography}
              onClose={() => setTypographyOpen(false)}
            />
          )}
        </div>
        <button aria-label="Quick Look current file" title="Quick Look" onClick={onQuickLook}><FileText size={16} /></button>
        <button aria-label={contextPanelOpen ? 'Hide context composer' : 'Show context composer'} title="Context composer" className={contextPanelOpen ? 'active' : ''} onClick={onToggleContextPanel}>
          <Sparkles size={16} />
        </button>
        <button onClick={onOpenPalette} title="Command palette"><TerminalSquare size={16} /> Cmd-K</button>
        <button disabled={!dirty || saving} onClick={onSave} className="save-button">
          {dirty ? <Save size={16} /> : <Check size={16} />}
          {saving ? 'Saving...' : dirty ? 'Save' : 'Saved'}
        </button>
      </div>
    </header>
  );
}

const fontOptions = [
  { label: 'System Sans', value: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' },
  { label: 'System Serif', value: 'ui-serif, Georgia, "Times New Roman", serif' },
  { label: 'SF Mono', value: 'SFMono-Regular, ui-monospace, Menlo, Consolas, monospace' },
];

export function TypographySettings({
  preferences,
  onChange,
  onClose,
}: {
  preferences: TypographyPreferences;
  onChange: (value: TypographyPreferences) => void;
  onClose: () => void;
}) {
  const update = (updates: Partial<TypographyPreferences>) => onChange(normalizeTypographyPreferences({ ...preferences, ...updates }));
  return (
    <section className="typography-popover" role="dialog" aria-label="Typography settings">
      <div className="popover-heading">
        <strong><SlidersHorizontal size={15} /> Typography</strong>
        <button aria-label="Close typography settings" onClick={onClose}><X size={14} /></button>
      </div>
      <div className="typography-control-grid">
        <label>
          <span>Font size</span>
          <input
            aria-label="Font size"
            type="number"
            min={13}
            max={22}
            value={preferences.fontSize}
            onChange={(event) => update({ fontSize: Number(event.target.value) })}
          />
        </label>
        <label>
          <span>Line height</span>
          <input
            aria-label="Line height"
            type="number"
            min={1.2}
            max={2}
            step={0.05}
            value={preferences.lineHeight}
            onChange={(event) => update({ lineHeight: Number(event.target.value) })}
          />
        </label>
      </div>
      <label>
        <span>Body width</span>
        <div className="width-preset-row" role="group" aria-label="Body width">
          {(['S', 'M', 'L', 'XL', 'XXL'] as const).map((preset) => (
            <button
              type="button"
              key={preset}
              className={preferences.bodyWidth === preset ? 'active' : ''}
              onClick={() => update({ bodyWidth: preset })}
            >
              {preset}
            </button>
          ))}
        </div>
      </label>
      <label>
        <span>Editor font</span>
        <select aria-label="Editor font" value={preferences.editorFont} onChange={(event) => update({ editorFont: event.target.value })}>
          {fontOptions.map((option) => <option key={option.label} value={option.value}>{option.label}</option>)}
        </select>
      </label>
      <label>
        <span>Preview font</span>
        <select aria-label="Preview font" value={preferences.previewFont} onChange={(event) => update({ previewFont: event.target.value })}>
          {fontOptions.map((option) => <option key={option.label} value={option.value}>{option.label}</option>)}
        </select>
      </label>
      <label>
        <span>Code font</span>
        <select aria-label="Code font" value={preferences.codeFont} onChange={(event) => update({ codeFont: event.target.value })}>
          {fontOptions.map((option) => <option key={option.label} value={option.value}>{option.label}</option>)}
        </select>
      </label>
    </section>
  );
}

function contextEntryLine(entry: VaultEntry): string {
  return `- ${entry.title} | ${entry.status || entryLens(entry)} | ${entry.path}`;
}

export function buildContextBrief({
  entry,
  file,
  content,
  related,
  scope,
  prompt,
}: {
  entry: VaultEntry;
  file: VaultFile;
  content: string;
  related: EditorRelated;
  scope: ContextScope;
  prompt: string;
}): string {
  const linkedEntries = [...related.backlinks, ...related.outgoing, ...related.recent].slice(0, 10);
  const queuedInstructions = parseCodexInstructions(content).filter((instruction) => instruction.status === 'queued');
  const lines = [
    '# Codex Context Brief',
    '',
    `Scope: ${scope === 'project' ? 'Project context' : 'Current note'}`,
    `Title: ${entry.title}`,
    `Path: ${file.path}`,
    `Kind: ${entryLens(entry)}`,
    `Project: ${entry.project || file.frontmatter.project || 'none'}`,
    `Status: ${file.frontmatter.status || entry.status || 'none'}`,
    `Priority: ${file.frontmatter.priority || entry.priority || 'none'}`,
    `Deadline type: ${file.frontmatter.deadline_type || entry.deadline_type || 'soft'}`,
    `Due: ${file.frontmatter.due || entry.due || 'none'}`,
    `Next: ${file.frontmatter.next || file.frontmatter.next_action || entry.next || 'none'}`,
  ];
  if (scope === 'project') {
    lines.push(
      '',
      '## Project Summary',
      related.projectReview
        ? `- ${related.projectReview.project.title} | ${related.projectReview.openTaskCount} open tasks | ${related.projectReview.stale ? related.projectReview.staleReason : 'current'}`
        : '- No project summary found.',
      '',
      '## Active Tasks',
      ...(related.activeTasks.length ? related.activeTasks.map(contextEntryLine) : ['- None']),
      '',
      '## Waiting / Blocked',
      ...(related.waitingTasks.length ? related.waitingTasks.map(contextEntryLine) : ['- None']),
      '',
      '## Recent / Linked Notes',
      ...(linkedEntries.length ? linkedEntries.map(contextEntryLine) : ['- None']),
    );
  }
  lines.push(
    '',
    '## Queued Codex Instructions',
    ...(queuedInstructions.length ? queuedInstructions.map(formatCodexInstruction) : ['- None']),
  );
  lines.push(
    '',
    '## Markdown',
    '```markdown',
    content,
    '```',
  );
  if (prompt.trim()) {
    lines.push('', '## User Prompt', prompt.trim());
  }
  lines.push('', 'Requested output: reason from the provided Markdown. Do not mark work complete unless there is explicit evidence.');
  return lines.join('\n');
}

export function ContextComposer({
  entry,
  file,
  content,
  related,
}: {
  entry: VaultEntry;
  file: VaultFile;
  content: string;
  related: EditorRelated;
}) {
  const [scope, setScope] = useState<ContextScope>('note');
  const [prompt, setPrompt] = useState('');
  const [copyStatus, setCopyStatus] = useState('');
  const brief = useMemo(() => buildContextBrief({ entry, file, content, related, scope, prompt }), [content, entry, file, prompt, related, scope]);
  const copyBrief = async () => {
    await navigator.clipboard?.writeText(brief);
    setCopyStatus('Copied');
    window.setTimeout(() => setCopyStatus(''), 1400);
  };
  return (
    <aside className="context-composer" aria-label="Context composer">
      <div className="context-composer-header">
        <span><Bot size={15} /> Context</span>
        <select aria-label="Context scope" value={scope} onChange={(event) => setScope(event.target.value as ContextScope)}>
          <option value="note">Current note</option>
          <option value="project">Project context</option>
        </select>
      </div>
      <div className="context-message assistant-message">
        <strong>{scope === 'project' ? 'Project context ready' : 'Current note ready'}</strong>
        <span>{scope === 'project' ? `${related.activeTasks.length} active · ${related.waitingTasks.length} waiting · ${related.recent.length} recent` : file.path}</span>
      </div>
      <textarea
        aria-label="Context prompt"
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
        placeholder="Ask Codex to review, summarize, plan next actions..."
      />
      <pre className="context-brief-preview">{brief}</pre>
      <button className="copy-brief-button" onClick={() => void copyBrief()}>
        <Copy size={15} /> {copyStatus || 'Copy Codex Brief'}
      </button>
    </aside>
  );
}

export function QuickLookModal({
  entry,
  file,
  loading,
  error,
  onClose,
  onOpen,
}: {
  entry: VaultEntry | null;
  file: VaultFile | null;
  loading: boolean;
  error: string;
  onClose: () => void;
  onOpen: () => void;
}) {
  const [copyStatus, setCopyStatus] = useState('');
  const copyPath = async () => {
    if (!file?.path) return;
    await navigator.clipboard?.writeText(file.path);
    setCopyStatus('Copied');
    window.setTimeout(() => setCopyStatus(''), 1400);
  };
  return (
    <div className="quick-look-backdrop" onMouseDown={onClose}>
      <section className="quick-look-modal" role="dialog" aria-label="Quick Look" onMouseDown={(event) => event.stopPropagation()}>
        <header className="quick-look-header">
          <div>
            <strong>{entry?.title || file?.path || 'Quick Look'}</strong>
            <span>{file?.path || entry?.path || ''}</span>
          </div>
          <div className="quick-look-actions">
            <button onClick={() => void copyPath()} disabled={!file}>{copyStatus || 'Copy Path'}</button>
            <button onClick={onOpen} disabled={!file}>Open in Editor</button>
            <button aria-label="Close Quick Look" onClick={onClose}><X size={16} /></button>
          </div>
        </header>
        {loading ? (
          <div className="quick-look-empty">Loading preview...</div>
        ) : error ? (
          <div className="quick-look-empty error">{error}</div>
        ) : file ? (
          <div className="quick-look-body">
            <div className="quick-look-meta-table">
              {Object.entries(file.frontmatter).filter(([, value]) => !isStructuredMetadataValue(value)).map(([key, value]) => (
                <div key={key}>
                  <span>{frontmatterLabel(key)}</span>
                  <strong>{displayMetadataValue(value)}</strong>
                </div>
              ))}
              {Object.entries(file.frontmatter).some(([, value]) => isStructuredMetadataValue(value)) && (
                <div className="quick-look-structured-meta">
                  <span>Structured data</span>
                  <strong>Open in Editor or Source</strong>
                </div>
              )}
            </div>
            <article className="preview quick-look-preview">
              <div className="preview-inner">
                <Suspense fallback={<div className="preview-lazy-fallback">Rendering preview...</div>}>
                  <MarkdownRenderer content={file.content} />
                </Suspense>
              </div>
            </article>
          </div>
        ) : (
          <div className="quick-look-empty">No preview available.</div>
        )}
      </section>
    </div>
  );
}

function TaskMetadataBar({
  file,
  taskProjects,
  onPatch,
  disabled,
}: {
  file: VaultFile;
  taskProjects: string[];
  onPatch: (path: string, updates: TaskMetadataUpdates, currentModifiedAt?: number) => Promise<void> | void;
  disabled: boolean;
}) {
  return (
    <div className="task-meta-bar">
      <TaskQuickEdit
        task={taskQuickEditFromFile(file)}
        projectOptions={taskProjects}
        onPatch={onPatch}
        disabled={disabled}
        note="Quick edits save immediately unless the editor has unsaved Markdown changes."
      />
    </div>
  );
}

function Inspector({
  entry,
  file,
  entries,
  projectReview,
  gitStatus,
  onOpen,
  onApplyFrontmatter,
}: {
  entry: VaultEntry | null;
  file: VaultFile | null;
  entries: VaultEntry[];
  projectReview: ProjectReview[];
  gitStatus: GitStatus | null;
  onOpen: (path: string) => void;
  onApplyFrontmatter: (frontmatter: Record<string, unknown>) => void;
}) {
  const [draft, setDraft] = useState<Array<{ key: string; value: string; original: unknown }>>([]);

  useEffect(() => {
    const next = Object.entries(file?.frontmatter || {}).map(([key, value]) => ({
      key,
      value: scalarDisplay(value),
      original: value,
    }));
    setDraft(next);
  }, [file?.path, file?.modified_at]);

  if (!entry || !file) {
    return (
      <aside className="inspector">
        <div className="empty-state small">
          <PanelRight size={22} />
          <p>Inspector</p>
        </div>
      </aside>
    );
  }
  const apply = () => {
    const next: Record<string, unknown> = {};
    for (const item of draft) {
      if (item.key.trim()) next[item.key.trim()] = parsePropertyValue(item.value, item.original);
    }
    onApplyFrontmatter(next);
  };
  const related = buildEditorRelated(entry, entries, projectReview);
  const frontmatterEditor = (
    <>
      <div className="property-list">
        {draft.map((item, index) => (
          <div className="property-row" key={`${item.key}-${index}`}>
            <input
              value={item.key}
              aria-label="Property key"
              onChange={(event) => setDraft((current) => current.map((row, i) => i === index ? { ...row, key: event.target.value } : row))}
            />
            <input
              value={item.value}
              aria-label="Property value"
              onChange={(event) => setDraft((current) => current.map((row, i) => i === index ? { ...row, value: event.target.value } : row))}
            />
          </div>
        ))}
      </div>
      <div className="inspector-actions">
        <button onClick={() => setDraft((current) => [...current, { key: '', value: '', original: '' }])}><Plus size={14} /> Add</button>
        <button onClick={apply}><ChevronRight size={14} /> Apply</button>
      </div>
    </>
  );
  return (
    <aside className="inspector">
      <section>
        <div className="panel-title"><FileText size={15} /> File</div>
        <dl className="meta-list">
          <dt>Path</dt><dd>{entry.path}</dd>
          <dt>Modified</dt><dd>{formatStamp(entry.modified_at)}</dd>
          <dt>Words</dt><dd>{entry.word_count ?? 0}</dd>
          <dt>Size</dt><dd>{entry.file_size ?? file.file_size} bytes</dd>
        </dl>
      </section>
      {isTask(entry) ? (
        <details className="inspector-disclosure">
          <summary>
            <span><Tags size={15} /> Frontmatter</span>
            <small>{draft.length} fields</small>
          </summary>
          {frontmatterEditor}
        </details>
      ) : (
        <section>
          <div className="panel-title"><Tags size={15} /> Frontmatter</div>
          {frontmatterEditor}
        </section>
      )}
      <section>
        <div className="panel-title"><ClipboardList size={15} /> Related work</div>
        <RelatedEntryList entries={[...related.activeTasks, ...related.waitingTasks].slice(0, 8)} onOpen={onOpen} empty="No related tasks." />
      </section>
      <RelationshipSection title="Relationships" values={entry.relationships || {}} />
      <LinkSection title="Outgoing links" values={entry.outgoing_links || []} />
      <LinkSection title="Backlinks" values={entry.backlinks || []} />
      <section>
        <div className="panel-title"><GitBranch size={15} /> Git status</div>
        {gitStatus?.enabled ? (
          <div className="git-changes">
            {gitStatus.changed.slice(0, 10).map((change) => (
              <span key={`${change.status}:${change.path}`}>{change.status || '?'} {change.path}</span>
            ))}
            {gitStatus.changed.length === 0 && <span>No changed files</span>}
          </div>
        ) : <p className="muted">Not a Git repository.</p>}
      </section>
    </aside>
  );
}

function RelationshipSection({ title, values }: { title: string; values: Record<string, string[]> }) {
  return (
    <section>
      <div className="panel-title">{title}</div>
      {Object.keys(values).length === 0 ? <p className="muted">None</p> : (
        <div className="link-list">
          {Object.entries(values).map(([key, links]) => (
            <span key={key}><b>{key}</b>: {links.join(', ')}</span>
          ))}
        </div>
      )}
    </section>
  );
}

function LinkSection({ title, values }: { title: string; values: string[] }) {
  return (
    <section>
      <div className="panel-title">{title}</div>
      {values.length === 0 ? <p className="muted">None</p> : <div className="link-list">{values.map((value) => <span key={value}>{value}</span>)}</div>}
    </section>
  );
}

function CommandPalette({
  commands,
  query,
  setQuery,
  onRun,
  onClose,
}: {
  commands: Command[];
  query: string;
  setQuery: (query: string) => void;
  onRun: (command: Command) => void;
  onClose: () => void;
}) {
  return (
    <div className="palette-backdrop" onMouseDown={onClose}>
      <div className="palette" onMouseDown={(event) => event.stopPropagation()}>
        <div className="search-box palette-search">
          <Search size={16} />
          <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search commands and files..." />
        </div>
        <div className="palette-results">
          {commands.map((command) => (
            <button key={command.id} onClick={() => onRun(command)}>
              <strong>{command.title}</strong>
              <span>{command.detail}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function TokenDialog({
  error,
  health,
  tokenDraft,
  setTokenDraft,
  onSave,
}: {
  error: string;
  health: AppHealth | null;
  tokenDraft: string;
  setTokenDraft: (value: string) => void;
  onSave: () => void;
}) {
  const serverTokenMissing = missingServerToken(error) || health?.auth_configured === false;
  return (
    <div className="token-dialog">
      <strong>{serverTokenMissing ? 'Server token is not configured' : 'App token required'}</strong>
      {serverTokenMissing ? (
        <p>Set <code>PM_APP_TOKEN</code> in the server environment, restart, then paste that value here.</p>
      ) : (
        <p>Paste the <code>PM_APP_TOKEN</code> value for this private instance. Localhost development can run without one.</p>
      )}
      <input value={tokenDraft} onChange={(event) => setTokenDraft(event.target.value)} placeholder="Paste app token" disabled={serverTokenMissing} />
      <button onClick={onSave} disabled={serverTokenMissing}>Save token</button>
    </div>
  );
}
