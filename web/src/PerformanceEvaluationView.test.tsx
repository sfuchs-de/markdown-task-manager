import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PerformanceEvaluationView } from './App';
import { buildPerformanceEvaluation } from './lib/performanceEvaluation';
import type { VaultEntry } from './types';

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
      bullets: ['Give the status and venue.'],
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
];

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('PerformanceEvaluationView', () => {
  it('renders metadata-driven categories and opens the source note', () => {
    const onOpen = vi.fn();
    const data = buildPerformanceEvaluation(entries);

    const { container } = render(<PerformanceEvaluationView data={data} onOpen={onOpen} />);

    expect(screen.getByRole('heading', { name: 'Performance Evaluation' })).toBeVisible();
    expect(screen.getByText('Individual Entry Queue')).toBeVisible();
    expect(screen.getAllByText('Harbor allocation paper accepted at the Journal of Network Methods')[0]).toBeVisible();
    expect(screen.getAllByText('Methods briefing for the example policy forum')[0]).toBeVisible();
    expect(container.querySelectorAll('details.performance-entry-card[open]')).toHaveLength(0);
    expect(screen.getAllByText('Academic publication').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Policy briefing').length).toBeGreaterThan(0);
    expect(screen.getByText('Verify Before Submitting')).toBeVisible();
    expect(screen.getByText('Confirm briefing venue')).toBeVisible();

    const firstEntrySummary = screen
      .getAllByText('Harbor allocation paper accepted at the Journal of Network Methods')[0]
      .closest('summary');
    expect(firstEntrySummary).not.toBeNull();
    fireEvent.click(firstEntrySummary!);
    expect(container.querySelectorAll('details.performance-entry-card[open]')).toHaveLength(1);
    expect(screen.getAllByText('Status/stage').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Venue/journal/institution').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Journal of Network Methods')[0]).toBeVisible();
    expect(screen.getAllByRole('button', { name: /Copy wording/i }).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: /Accomplishments note/i }));
    expect(onOpen).toHaveBeenCalledWith('notes/performance/annual-review.md');
  });
});
