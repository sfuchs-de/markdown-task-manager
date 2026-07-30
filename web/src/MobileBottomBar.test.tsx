import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MobileBottomBar } from './App';
import type { EditorMode, EntryFilters, LayoutPanels } from './types';

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

const panels: LayoutPanels = {
  nav: true,
  library: false,
  inspector: true,
};

function renderMobileBottomBar(overrides: Partial<Parameters<typeof MobileBottomBar>[0]> = {}) {
  const props = {
    activeView: 'overview' as const,
    filters,
    setFilters: vi.fn(),
    layoutPanels: panels,
    gitStatus: { enabled: true, branch: 'main', changed: [] },
    loading: false,
    dirty: false,
    saving: false,
    selectedEntry: null,
    selectedFile: null,
    patchingTaskPath: '',
    editorMode: 'split' as EditorMode,
    setEditorMode: vi.fn(),
    onPatchTaskMetadata: vi.fn(),
    onView: vi.fn(),
    onCreate: vi.fn(),
    onReload: vi.fn(),
    onTogglePanel: vi.fn(),
    onOpenPalette: vi.fn(),
    onSave: vi.fn(),
    ...overrides,
  };
  render(<MobileBottomBar {...props} />);
  return props;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('MobileBottomBar', () => {
  it('switches primary mobile views from the fixed bottom actions', () => {
    const props = renderMobileBottomBar();

    fireEvent.click(screen.getByRole('button', { name: 'Tasks' }));
    fireEvent.click(screen.getByRole('button', { name: 'Time' }));
    fireEvent.click(screen.getByRole('button', { name: 'Overview' }));

    expect(props.onView).toHaveBeenCalledWith('open-tasks');
    expect(props.onView).toHaveBeenCalledWith('time-plan');
    expect(props.onView).toHaveBeenCalledWith('overview');
  });

  it('exposes create actions from the New sheet', () => {
    const props = renderMobileBottomBar();

    fireEvent.click(screen.getByRole('button', { name: 'New' }));
    expect(screen.getByRole('dialog', { name: 'New item actions' })).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'New task' }));
    expect(props.onCreate).toHaveBeenCalledWith('task');
  });

  it('exposes shell actions from the More sheet', () => {
    const props = renderMobileBottomBar();

    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    expect(screen.getByRole('dialog', { name: 'Mobile more actions' })).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Projects' }));
    expect(props.onView).toHaveBeenCalledWith('projects');

    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    fireEvent.click(screen.getByRole('button', { name: 'Command palette' }));
    expect(props.onOpenPalette).toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sync' }));
    expect(props.onView).toHaveBeenCalledWith('sync');

    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    fireEvent.click(screen.getByRole('button', { name: 'Show library panel' }));
    expect(props.onTogglePanel).toHaveBeenCalledWith('library');

    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reload vault' }));
    expect(props.onReload).toHaveBeenCalled();
  });

  it('exposes editor save and mode actions when editing', () => {
    const props = renderMobileBottomBar({
      activeView: 'editor',
      dirty: true,
      editorMode: 'raw',
    });

    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(props.onSave).toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(props.setEditorMode).toHaveBeenCalledWith('preview');
  });

  it('exposes current task status actions from the More sheet while editing', () => {
    const props = renderMobileBottomBar({
      activeView: 'editor',
      selectedEntry: {
        path: 'tasks/active/t-one.md',
        filename: 't-one.md',
        title: 'One task',
        kind: 'task',
        status: 'open',
        private: false,
      },
      selectedFile: {
        path: 'tasks/active/t-one.md',
        content: '',
        frontmatter: {},
        body: '',
        modified_at: 123,
        file_size: 0,
      },
    });

    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));

    expect(props.onPatchTaskMetadata).toHaveBeenCalledWith('tasks/active/t-one.md', { status: 'done' }, 123);
  });
});
