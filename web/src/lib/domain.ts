import type { VaultEntry } from '../types';

export type WorkDomain = 'research' | 'admin' | 'teaching' | 'personal' | 'system' | 'archive' | 'other';

const VALID_DOMAINS = new Set<WorkDomain>(['research', 'admin', 'teaching', 'personal', 'system', 'archive', 'other']);
let configuredLabels: Record<string, string> = {};

export function configureDomainLabels(labels: Record<string, string>): void {
  configuredLabels = { ...labels };
}

function normalized(value?: string | null): string {
  return String(value || '').trim().toLowerCase();
}

function localLens(entry: VaultEntry): string {
  return entry.kind || entry.type || entry.note_role || entry.collection || 'untyped';
}

function localCollection(entry: VaultEntry): string {
  return entry.collection || entry.path.split('/')[0] || 'root';
}

function explicitDomain(entry: VaultEntry): WorkDomain | null {
  const raw = normalized(
    entry.domain ||
    entry.time_category ||
    entry.area ||
    (entry.properties?.domain as string | undefined) ||
    (entry.properties?.time_category as string | undefined),
  );
  return VALID_DOMAINS.has(raw as WorkDomain) ? raw as WorkDomain : null;
}

export function entryDomain(entry: VaultEntry): WorkDomain {
  const explicit = explicitDomain(entry);
  if (explicit) return explicit;

  const path = normalized(entry.path);
  const lens = normalized(localLens(entry));
  const collection = normalized(localCollection(entry));
  const status = normalized(entry.status);

  if (path.startsWith('archive/') || status.includes('archive')) return 'archive';
  if (path.startsWith('templates/') || path.includes('/templates/') || path.startsWith('settings/') || collection === 'templates' || lens === 'template' || lens === 'type') return 'system';
  return 'other';
}

export function domainLabel(domain: string): string {
  const normalizedDomain = normalized(domain);
  if (configuredLabels[normalizedDomain]) return configuredLabels[normalizedDomain];
  if (normalizedDomain === 'research') return 'Research';
  if (normalizedDomain === 'admin') return 'Admin';
  if (normalizedDomain === 'teaching') return 'Teaching';
  if (normalizedDomain === 'personal') return 'Personal';
  if (normalizedDomain === 'system') return 'System';
  if (normalizedDomain === 'archive') return 'Archive';
  if (normalizedDomain === 'other') return 'Other';
  return domain || 'Other';
}
