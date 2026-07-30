import { describe, expect, it } from 'vitest';
import { buildAdminCenter } from './adminCenter';
import { buildWorkbenchData } from './workbench';
import type { EntryFilters, VaultEntry } from '../types';

const today = new Date(2026, 4, 15);

const filters: EntryFilters = {
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

const entries: VaultEntry[] = [
  { path: 'projects/policy/README.md', filename: 'README.md', title: 'Policy', kind: 'project', id: 'policy', area: 'policy', private: false },
  { path: 'projects/referee-reports/README.md', filename: 'README.md', title: 'Referee Reports', kind: 'project', id: 'referee-reports', area: 'service', private: false },
  { path: 'tasks/active/evaluation.md', filename: 'evaluation.md', title: 'Complete annual example form', kind: 'task', status: 'open', priority: '1', due: '2026-05-18', project: 'operations-admin', domain: 'admin', properties: { admin_category: 'forms-approvals' }, private: false },
  { path: 'tasks/active/policy.md', filename: 'policy.md', title: 'Prepare Supply Chain Pressure Index policy slides', kind: 'task', status: 'active', priority: '2', due: '2026-05-28', project: 'policy', domain: 'admin', properties: { admin_category: 'policy-service' }, private: false },
  { path: 'tasks/active/referee-admin.md', filename: 'referee-admin.md', title: 'Submit referee report receipt form', kind: 'task', status: 'open', priority: '3', due: '2026-06-10', project: 'referee-reports', domain: 'admin', properties: { admin_category: 'forms-approvals' }, private: false },
  { path: 'tasks/active/move.md', filename: 'move.md', title: 'Verify Example University onboarding paperwork', kind: 'task', status: 'open', priority: '2', due: '2026-06-01', project: 'relocation', domain: 'admin', properties: { admin_category: 'life-admin' }, private: false },
  { path: 'tasks/waiting/event.md', filename: 'event.md', title: 'Wait for Lakeside event venue reply', kind: 'task', status: 'waiting', priority: '3', due: '2026-07-01', project: 'personal-event', domain: 'admin', properties: { admin_category: 'life-admin' }, private: false },
  { path: 'tasks/active/conference.md', filename: 'conference.md', title: 'Draft Northport methods conference plan', kind: 'task', status: 'open', priority: '3', due: '2026-08-01', project: 'methods-conference', domain: 'admin', properties: { admin_category: 'policy-service' }, private: false },
  { path: 'tasks/active/travel.md', filename: 'travel.md', title: 'Send travel approval', kind: 'task', status: 'open', priority: '1', due: '2026-05-16', project: 'operations', domain: 'admin', area: 'travel', properties: { module: 'travel' }, private: false },
  { path: 'tasks/active/health.md', filename: 'health.md', title: 'Book wellness appointment', kind: 'task', status: 'open', priority: '1', due: '2026-05-16', project: 'wellness', domain: 'personal', area: 'wellness', properties: { module: 'wellness' }, private: false },
  { path: 'tasks/active/collaborator.md', filename: 'collaborator.md', title: 'Review Avery implementation outputs', kind: 'task', status: 'waiting', priority: '2', due: '2026-05-20', project: 'collaborators', domain: 'research', area: 'collaborators', properties: { module: 'collaborators' }, private: false },
  { path: 'tasks/active/research.md', filename: 'research.md', title: 'Finish harbor allocation quant model', kind: 'task', status: 'active', priority: '1', due: '2026-05-16', project: 'harbor-flows', domain: 'research', private: false },
  { path: 'tasks/active/private-admin.md', filename: 'private-admin.md', title: 'Private admin task', kind: 'task', status: 'open', priority: '1', due: '2026-05-16', project: 'operations-admin', domain: 'admin', properties: { admin_category: 'forms-approvals' }, private: true },
];

describe('admin center derivation', () => {
  it('includes work and life admin while excluding research, travel, health, and RA tasks', () => {
    const data = buildAdminCenter(entries, today);
    const titles = data.tasks.map((entry) => entry.title);

    expect(titles).toContain('Complete annual example form');
    expect(titles).toContain('Prepare Supply Chain Pressure Index policy slides');
    expect(titles).toContain('Submit referee report receipt form');
    expect(titles).toContain('Verify Example University onboarding paperwork');
    expect(titles).toContain('Wait for Lakeside event venue reply');
    expect(titles).toContain('Draft Northport methods conference plan');
    expect(titles).not.toContain('Send travel approval');
    expect(titles).not.toContain('Book wellness appointment');
    expect(titles).not.toContain('Review Avery implementation outputs');
    expect(titles).not.toContain('Finish harbor allocation quant model');
  });

  it('groups urgent, forms, policy/service, life admin, and waiting lanes', () => {
    const data = buildAdminCenter(entries.filter((entry) => !entry.private), today);

    expect(data.metrics.urgent).toBe(1);
    expect(data.metrics.waiting).toBe(1);
    expect(data.metrics.formsApprovals).toBe(2);
    expect(data.metrics.lifeAdmin).toBe(2);
    expect(data.lanes.find((lane) => lane.id === 'urgent')?.entries.map((entry) => entry.title)).toEqual(['Complete annual example form']);
    expect(data.lanes.find((lane) => lane.id === 'forms')?.entries.map((entry) => entry.title)).toContain('Submit referee report receipt form');
    expect(data.lanes.find((lane) => lane.id === 'policy-service')?.entries.map((entry) => entry.title)).toContain('Prepare Supply Chain Pressure Index policy slides');
    expect(data.lanes.find((lane) => lane.id === 'life-admin')?.entries.map((entry) => entry.title)).toContain('Verify Example University onboarding paperwork');
    expect(data.lanes.find((lane) => lane.id === 'waiting')?.entries.map((entry) => entry.title)).toContain('Wait for Lakeside event venue reply');
  });

  it('respects workbench private filtering', () => {
    const data = buildWorkbenchData(entries, filters, today);

    expect(data.adminCenter.tasks.map((entry) => entry.title)).not.toContain('Private admin task');
  });
});
