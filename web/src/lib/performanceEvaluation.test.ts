import { describe, expect, it } from 'vitest';
import { buildPerformanceEvaluation } from './performanceEvaluation';
import type { VaultEntry } from '../types';

const entries: VaultEntry[] = [
  {
    path: 'notes/performance/annual-review.md',
    filename: 'annual-review.md',
    title: 'Annual review working note',
    kind: 'performance-review',
    area: 'performance',
    private: false,
  },
  {
    path: 'tasks/active/update-review.md',
    filename: 'update-review.md',
    title: 'Update annual review packet',
    kind: 'task',
    area: 'performance',
    status: 'active',
    priority: '2',
    private: false,
  },
  {
    path: 'notes/performance/category-publication.md',
    filename: 'category-publication.md',
    id: 'academic-publication',
    title: 'Academic publication',
    kind: 'performance-category',
    status: 'supported',
    private: false,
    properties: {
      performance_group: 'academic',
      summary: 'Peer-reviewed and accepted research outputs.',
      bullets: ['Give the status and venue.', 'Link supporting evidence.'],
    },
  },
  {
    path: 'notes/performance/category-briefing.md',
    filename: 'category-briefing.md',
    id: 'policy-briefing',
    title: 'Policy briefing',
    kind: 'performance-category',
    status: 'needs-verification',
    private: false,
    properties: {
      performance_group: 'policy',
      summary: 'Briefings prepared for a policy audience.',
      bullets: ['Confirm the audience and date.'],
    },
  },
  {
    path: 'notes/performance/harbor-paper.md',
    filename: 'harbor-paper.md',
    id: 'harbor-paper',
    title: 'Harbor allocation paper accepted at the Journal of Network Methods',
    kind: 'performance-achievement',
    private: false,
    date: '2026-04-27',
    properties: {
      performance_group: 'academic',
      broad_category: 'Academic',
      category_id: 'academic-publication',
      narrow_category: 'Academic publication',
      status_stage: 'ready',
      entry_date: '2026-04-27',
      venue_journal_institution: 'Journal of Network Methods',
      staff_author: 'Example Researcher',
      collaborators: 'Avery Example and Morgan Example',
      attachments: 'Use the project status note.',
      evidence_path: 'projects/harbor-flows/README.md',
      evidence: ['projects/harbor-flows/README.md'],
      copy_ready_description: 'The harbor allocation paper was accepted at the Journal of Network Methods.',
    },
  },
  {
    path: 'notes/performance/methods-briefing.md',
    filename: 'methods-briefing.md',
    id: 'methods-briefing',
    title: 'Methods briefing for the example policy forum',
    kind: 'performance-achievement',
    private: false,
    date: '2026-05-02',
    properties: {
      performance_group: 'policy',
      broad_category: 'Policy',
      category_id: 'policy-briefing',
      narrow_category: 'Policy briefing',
      status_stage: 'needs-verification',
      evidence_path: 'notes/briefings/methods-forum.md',
      evidence: ['notes/briefings/methods-forum.md'],
      copy_ready_description: 'Presented a methods briefing to an example policy forum.',
    },
  },
  {
    path: 'notes/performance/verify-venue.md',
    filename: 'verify-venue.md',
    id: 'verify-venue',
    title: 'Confirm briefing venue',
    kind: 'performance-verification',
    status: 'open',
    private: false,
    properties: { detail: 'Check the final program before submitting the review.' },
  },
  {
    path: 'notes/performance/verify-publication.md',
    filename: 'verify-publication.md',
    id: 'verify-publication',
    title: 'Publication evidence attached',
    kind: 'performance-verification',
    status: 'supported',
    private: false,
    properties: { detail: 'The project note records the acceptance.' },
  },
  {
    path: 'projects/harbor-flows/README.md',
    filename: 'README.md',
    title: 'Harbor Flows',
    kind: 'project',
    id: 'harbor-flows',
    domain: 'research',
    private: false,
  },
  {
    path: 'notes/briefings/methods-forum.md',
    filename: 'methods-forum.md',
    title: 'Methods forum briefing note',
    kind: 'note',
    domain: 'admin',
    private: false,
  },
  {
    path: 'projects/unrelated/README.md',
    filename: 'README.md',
    title: 'Unrelated project',
    kind: 'project',
    id: 'unrelated',
    domain: 'research',
    private: false,
  },
];

describe('performance evaluation derivation', () => {
  it('derives categories, achievements, verification, and metrics from vault metadata', () => {
    const data = buildPerformanceEvaluation(entries);

    expect(data.sourceNote?.path).toBe('notes/performance/annual-review.md');
    expect(data.task?.path).toBe('tasks/active/update-review.md');
    expect(data.metrics).toMatchObject({
      categories: 2,
      academicCategories: 1,
      policyCategories: 1,
      individualEntries: 2,
      readyEntries: 1,
      readyCategories: 1,
      openTasks: 1,
      evidenceLinks: 2,
    });
    expect(data.metrics.needsVerification).toBe(3);
    expect(data.categories.map((category) => category.title)).toEqual([
      'Academic publication',
      'Policy briefing',
    ]);
    expect(data.entries.map((entry) => entry.title)).toContain(
      'Harbor allocation paper accepted at the Journal of Network Methods',
    );
    expect(data.entries.find((entry) => entry.id === 'harbor-paper')?.formFields).toContainEqual({
      label: 'Venue/journal/institution',
      value: 'Journal of Network Methods',
    });
    expect(data.verification.map((item) => item.status)).toEqual(['open', 'supported']);
  });

  it('links declared evidence and excludes unrelated entries', () => {
    const paths = buildPerformanceEvaluation(entries).evidenceEntries.map((entry) => entry.path);

    expect(paths).toEqual([
      'projects/harbor-flows/README.md',
      'notes/briefings/methods-forum.md',
    ]);
    expect(paths).not.toContain('projects/unrelated/README.md');
  });
});
