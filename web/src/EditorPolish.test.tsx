import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildContextBrief,
  ContextComposer,
  FrontmatterTable,
  loadTypographyPreferences,
  QuickLookModal,
  saveTypographyPreferences,
  TravelLedgerVisualPreview,
  TypographySettings,
  typographyCssVariables,
  type EditorRelated,
} from './App';
import { MarkdownRenderer } from './MarkdownRenderer';
import type { TypographyPreferences, VaultEntry, VaultFile } from './types';

const entry: VaultEntry = {
  path: 'tasks/active/t-polish.md',
  filename: 't-polish.md',
  title: 'Editor polish',
  kind: 'task',
  status: 'open',
  priority: '1',
  due: '2026-05-12',
  project: 'alpha',
};

const file: VaultFile = {
  path: 'tasks/active/t-polish.md',
  content: '---\ntitle: Editor polish\nstatus: open\n---\n# Editor polish\n\nBody copy.',
  frontmatter: {
    title: 'Editor polish',
    status: 'open',
    project: 'alpha',
  },
  body: '# Editor polish\n\nBody copy.',
  modified_at: 12,
  file_size: 100,
};

const related: EditorRelated = {
  activeTasks: [{ ...entry, path: 'tasks/active/t-next.md', title: 'Next task' }],
  waitingTasks: [{ ...entry, path: 'tasks/waiting/t-wait.md', title: 'Waiting task', status: 'waiting' }],
  upcoming: [],
  recent: [{ ...entry, path: 'projects/alpha/progress.md', title: 'Progress' }],
  backlinks: [],
  outgoing: [],
};

const typography: TypographyPreferences = {
  editorFont: 'SFMono-Regular, ui-monospace, Menlo, Consolas, monospace',
  previewFont: 'ui-serif, Georgia, "Times New Roman", serif',
  codeFont: 'SFMono-Regular, ui-monospace, Menlo, Consolas, monospace',
  fontSize: 16,
  lineHeight: 1.62,
  bodyWidth: 'L',
};

beforeEach(() => {
  const store = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) || null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
      clear: () => store.clear(),
    },
  });
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: vi.fn().mockResolvedValue(undefined),
    },
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('MarkdownRenderer', () => {
  it('renders allowed note HTML and strips unsafe HTML', () => {
    render(
      <MarkdownRenderer
        content={'<details><summary>More</summary><p>Allowed</p></details><script>alert(1)</script><img src="javascript:alert(1)" onerror="x" />'}
      />,
    );

    expect(screen.getByText('More')).toBeVisible();
    expect(screen.getByText('Allowed')).toBeInTheDocument();
    expect(document.querySelector('script')).toBeNull();
    expect(document.querySelector('img')?.getAttribute('src') || '').not.toContain('javascript');
  });
});

describe('TypographySettings', () => {
  it('updates preferences and persists through localStorage helpers', () => {
    const onChange = vi.fn();
    render(<TypographySettings preferences={typography} onChange={onChange} onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Font size'), { target: { value: '18' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ fontSize: 18 }));

    saveTypographyPreferences({ ...typography, bodyWidth: 'XL', fontSize: 18 });
    expect(loadTypographyPreferences()).toMatchObject({ bodyWidth: 'XL', fontSize: 18 });
    expect(typographyCssVariables({ ...typography, bodyWidth: 'XL' })).toMatchObject({ '--document-width': '1080px' });
  });
});

describe('QuickLookModal', () => {
  it('shows a read-only preview and exposes copy/open actions', () => {
    const onOpen = vi.fn();
    render(<QuickLookModal entry={entry} file={file} loading={false} error="" onClose={vi.fn()} onOpen={onOpen} />);

    expect(screen.getByRole('dialog', { name: 'Quick Look' })).toBeVisible();
    expect(screen.getAllByText('Editor polish').length).toBeGreaterThan(1);
    fireEvent.click(screen.getByRole('button', { name: 'Copy Path' }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('tasks/active/t-polish.md');
    fireEvent.click(screen.getByRole('button', { name: 'Open in Editor' }));
    expect(onOpen).toHaveBeenCalled();
  });

  it('summarizes structured metadata instead of rendering object strings', () => {
    const structuredFile: VaultFile = {
      ...file,
      frontmatter: {
        ...file.frontmatter,
        ledger: [{ id: 'summer-conference', item: 'Flight' }],
      },
    };

    render(<QuickLookModal entry={entry} file={structuredFile} loading={false} error="" onClose={vi.fn()} onOpen={vi.fn()} />);

    expect(screen.queryByText('[object Object]')).toBeNull();
    expect(screen.getByText('Structured data')).toBeVisible();
  });
});

describe('FrontmatterTable', () => {
  it('hides structured frontmatter fields from the editable metadata table', () => {
    render(
      <FrontmatterTable
        frontmatter={{
          title: 'Travel expense ledger',
          status: 'active',
          ledger: [{ id: 'summer-conference', item: 'Flight' }],
        }}
        disabled={false}
        onPatch={vi.fn()}
      />,
    );

    expect(screen.getByDisplayValue('Travel expense ledger')).toBeVisible();
    expect(screen.queryByText('[object Object]')).toBeNull();
    expect(screen.getByText('ledger')).toBeVisible();
    expect(screen.getByText(/Hidden from the metadata table/i)).toBeVisible();
  });
});

describe('ContextComposer', () => {
  it('builds and copies a project-scoped Codex brief', () => {
    const contentWithInstructions = `${file.content}\n\n## Codex instructions\n\n- [ ] queued | 2026-05-26 | Refresh evidence before editing.\n`;
    const brief = buildContextBrief({ entry, file, content: contentWithInstructions, related, scope: 'project', prompt: 'Find blockers.' });
    expect(brief).toContain('Project context');
    expect(brief).toContain('Waiting task');
    expect(brief).toContain('Find blockers.');
    expect(brief).toContain('Refresh evidence before editing.');

    render(<ContextComposer entry={entry} file={file} content={contentWithInstructions} related={related} />);
    fireEvent.change(screen.getByLabelText('Context scope'), { target: { value: 'project' } });
    fireEvent.change(screen.getByLabelText('Context prompt'), { target: { value: 'Find blockers.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Copy Codex Brief' }));

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('Find blockers.'));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('Waiting task'));
  });
});

describe('TravelLedgerVisualPreview', () => {
  it('renders grouped itinerary cards and opens booking detail pointers', () => {
    const onOpen = vi.fn();
    const ledgerFile: VaultFile = {
      path: 'projects/operations/travel_ledger.md',
      content: '',
      frontmatter: {
        kind: 'travel-ledger',
        title: 'Travel expense ledger',
        research_account_limit_usd: 12000,
        ledger: [
          {
            id: 'summer-conference-flight',
            trip_key: 'summer-conference',
            trip_title: 'Summer Conference / Northport',
            item: 'HUB-NPT Example Air round trip plus transfer',
            category: 'transport',
            estimate: 900,
            currency: 'USD',
            status: 'waiting_on_approval_channel',
            reimbursable: true,
            coverage_source: 'research_office',
            budget_account: 'research_account',
            source: 'Example Air quote and transfer estimate.',
            private_pointer: 'notes/travel/private/summer-conference-northport.md',
          },
          {
            id: 'research-forum-flight-hotel',
            trip_key: 'research-forum',
            trip_title: 'Methods Forum Harbor City',
            item: 'ATL-BCN round trip and lodging quote hotel option',
            category: 'flight_lodging_transport',
            estimate: 4300,
            currency: 'USD',
            status: 'waiting_on_approval_channel',
            reimbursable: true,
            coverage_source: 'research_office',
            budget_account: 'research_account',
            source: 'Example Air quote and lodging quote hotel snapshot.',
            private_pointer: 'notes/travel/private/research-forum-harbor-city.md',
          },
        ],
      },
      body: '',
      modified_at: 12,
      file_size: 100,
    };

    render(<TravelLedgerVisualPreview file={ledgerFile} content="" onOpen={onOpen} />);

    expect(screen.getByText('Suggested itinerary and booking board')).toBeVisible();
    expect(screen.getByText('Summer Conference / Northport')).toBeVisible();
    expect(screen.getByText('Methods Forum Harbor City')).toBeVisible();
    expect(screen.getByText('HUB-NPT Example Air round trip plus transfer')).toBeVisible();
    expect(screen.getByText('$5,200')).toBeVisible();

    fireEvent.click(screen.getAllByRole('button', { name: /Private/i })[0]);
    expect(onOpen).toHaveBeenCalledWith('notes/travel/private/summer-conference-northport.md');
  });
});
