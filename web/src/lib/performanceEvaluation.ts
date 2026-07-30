import { isTask } from './filters';
import { isOpenTask } from './overview';
import type { VaultEntry } from '../types';

export type PerformanceEvaluationGroup = 'academic' | 'policy';
export type PerformanceEvaluationStatus = 'ready' | 'supported' | 'needs-verification' | 'template-only';
export type PerformanceVerificationStatus = 'open' | 'supported';

export interface PerformanceEvaluationCategory {
  id: string;
  group: PerformanceEvaluationGroup;
  title: string;
  status: PerformanceEvaluationStatus;
  summary: string;
  bullets: string[];
  sourcePath?: string;
}

export interface PerformanceEvaluationEntryField {
  label: string;
  value: string;
}

export interface PerformanceEvaluationEntry {
  id: string;
  group: PerformanceEvaluationGroup;
  broadCategory: string;
  categoryId: string;
  categoryTitle: string;
  narrowCategory: string;
  title: string;
  period: string;
  status: PerformanceEvaluationStatus;
  suggestedText: string;
  formFields: PerformanceEvaluationEntryField[];
  evidence: string[];
  evidencePath?: string;
}

export interface PerformanceVerificationItem {
  id: string;
  title: string;
  detail: string;
  status: PerformanceVerificationStatus;
}

export interface PerformanceEvaluationMetrics {
  categories: number;
  academicCategories: number;
  policyCategories: number;
  individualEntries: number;
  readyEntries: number;
  readyCategories: number;
  needsVerification: number;
  openTasks: number;
  evidenceLinks: number;
}

export interface PerformanceEvaluationData {
  sourceNote: VaultEntry | null;
  task: VaultEntry | null;
  categories: PerformanceEvaluationCategory[];
  entries: PerformanceEvaluationEntry[];
  verification: PerformanceVerificationItem[];
  evidenceEntries: VaultEntry[];
  metrics: PerformanceEvaluationMetrics;
}

function normalized(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

function fieldValue(entry: VaultEntry, ...names: string[]): string {
  const record = entry as unknown as Record<string, unknown>;
  for (const name of names) {
    const value = record[name] ?? entry.properties?.[name];
    if (Array.isArray(value)) {
      const joined = value.map((item) => String(item || '').trim()).filter(Boolean).join('; ');
      if (joined) return joined;
    } else if (value !== null && value !== undefined && String(value).trim()) {
      return String(value).trim();
    }
  }
  return '';
}

function listValue(entry: VaultEntry, ...names: string[]): string[] {
  const record = entry as unknown as Record<string, unknown>;
  for (const name of names) {
    const value = record[name] ?? entry.properties?.[name];
    if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean);
    if (value !== null && value !== undefined && String(value).trim()) return [String(value).trim()];
  }
  return [];
}

function statusValue(value: unknown): PerformanceEvaluationStatus {
  const valueKey = normalized(value);
  if (['ready', 'supported', 'needs-verification', 'template-only'].includes(valueKey)) {
    return valueKey as PerformanceEvaluationStatus;
  }
  if (['done', 'complete', 'completed'].includes(valueKey)) return 'ready';
  return 'needs-verification';
}

function groupValue(entry: VaultEntry): PerformanceEvaluationGroup {
  return normalized(fieldValue(entry, 'performance_group', 'group')) === 'policy' ? 'policy' : 'academic';
}

function isKind(entry: VaultEntry, kind: string): boolean {
  return normalized(entry.kind || entry.type) === kind;
}

function categoryFromEntry(entry: VaultEntry): PerformanceEvaluationCategory {
  return {
    id: entry.id || entry.filename.replace(/\.md$/, ''),
    group: groupValue(entry),
    title: entry.title,
    status: statusValue(entry.status),
    summary: fieldValue(entry, 'summary') || entry.snippet || '',
    bullets: listValue(entry, 'bullets', 'criteria'),
    sourcePath: entry.path,
  };
}

function entryFromAchievement(entry: VaultEntry, categories: Map<string, PerformanceEvaluationCategory>): PerformanceEvaluationEntry {
  const categoryId = fieldValue(entry, 'category_id', 'categoryId');
  const category = categories.get(categoryId);
  const group = category?.group || groupValue(entry);
  const broadCategory = fieldValue(entry, 'broad_category', 'broadCategory') || (group === 'policy' ? 'Policy' : 'Academic');
  const narrowCategory = fieldValue(entry, 'narrow_category', 'narrowCategory') || category?.title || 'Uncategorized';
  const title = fieldValue(entry, 'item_title', 'itemTitle') || entry.title;
  const period = fieldValue(entry, 'entry_date', 'performance_date', 'date') || entry.date || '';
  const status = statusValue(fieldValue(entry, 'status_stage', 'stage', 'status') || entry.status);
  const description = fieldValue(entry, 'copy_ready_description', 'copyReadyDescription', 'description') || entry.snippet || '';
  const evidence = listValue(entry, 'evidence', 'source_pointers', 'sourcePointers');
  const evidencePath = fieldValue(entry, 'evidence_path', 'evidencePath') || entry.path;
  const formFields: PerformanceEvaluationEntryField[] = [
    ['Broad category', broadCategory],
    ['Narrow category', narrowCategory],
    ['Status/stage', fieldValue(entry, 'status_stage', 'stage') || status],
    ['Title', title],
    ['Date', period],
    ['Venue/journal/institution', fieldValue(entry, 'venue_journal_institution', 'venue', 'journal', 'institution', 'publication')],
    ['Staff author', fieldValue(entry, 'staff_author', 'staffAuthor')],
    ['Collaborators', fieldValue(entry, 'collaborators', 'external_collaborators', 'externalCollaborators')],
    ['Attachments/source pointers', fieldValue(entry, 'attachments', 'source_pointers', 'sourcePointers')],
    ['Copy-ready description', description],
  ].map(([label, value]) => ({ label, value }));
  return {
    id: entry.id || entry.filename.replace(/\.md$/, ''),
    group,
    broadCategory,
    categoryId,
    categoryTitle: category?.title || narrowCategory,
    narrowCategory,
    title,
    period,
    status,
    suggestedText: description,
    formFields,
    evidence: evidence.length ? evidence : [entry.path],
    evidencePath,
  };
}

function verificationFromEntry(entry: VaultEntry): PerformanceVerificationItem {
  return {
    id: entry.id || entry.filename.replace(/\.md$/, ''),
    title: entry.title,
    detail: fieldValue(entry, 'detail', 'next') || entry.next || entry.snippet || '',
    status: normalized(entry.status) === 'supported' || normalized(entry.status) === 'done' ? 'supported' : 'open',
  };
}

export function buildPerformanceEvaluation(entries: VaultEntry[]): PerformanceEvaluationData {
  const categories = entries.filter((entry) => isKind(entry, 'performance-category')).map(categoryFromEntry);
  const categoryMap = new Map(categories.map((category) => [category.id, category]));
  const individualEntries = entries
    .filter((entry) => isKind(entry, 'performance-achievement'))
    .map((entry) => entryFromAchievement(entry, categoryMap))
    .sort((a, b) => a.broadCategory.localeCompare(b.broadCategory) || a.title.localeCompare(b.title));
  const verification = entries
    .filter((entry) => isKind(entry, 'performance-verification'))
    .map(verificationFromEntry);
  const sourceNote = entries.find((entry) => isKind(entry, 'performance-review')) || null;
  const task = entries.find((entry) => isTask(entry) && normalized(entry.area) === 'performance') || null;
  const evidencePaths = new Set(individualEntries.flatMap((entry) => [entry.evidencePath, ...entry.evidence]).filter(Boolean));
  const evidenceEntries = entries.filter((entry) => evidencePaths.has(entry.path));
  const needsVerification = categories.filter((category) => ['needs-verification', 'template-only'].includes(category.status)).length
    + individualEntries.filter((entry) => ['needs-verification', 'template-only'].includes(entry.status)).length
    + verification.filter((item) => item.status === 'open').length;
  return {
    sourceNote,
    task,
    categories,
    entries: individualEntries,
    verification,
    evidenceEntries,
    metrics: {
      categories: categories.length,
      academicCategories: categories.filter((category) => category.group === 'academic').length,
      policyCategories: categories.filter((category) => category.group === 'policy').length,
      individualEntries: individualEntries.length,
      readyEntries: individualEntries.filter((entry) => ['ready', 'supported'].includes(entry.status)).length,
      readyCategories: categories.filter((category) => ['ready', 'supported'].includes(category.status)).length,
      needsVerification,
      openTasks: task && isOpenTask(task) ? 1 : 0,
      evidenceLinks: evidenceEntries.length,
    },
  };
}
