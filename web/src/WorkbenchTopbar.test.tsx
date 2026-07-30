import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkbenchTopbar } from './App';
import type { LayoutPanels } from './types';

const panels: LayoutPanels = {
  nav: true,
  library: false,
  inspector: true,
};

function renderTopbar(overrides: Partial<Parameters<typeof WorkbenchTopbar>[0]> = {}) {
  const props = {
    activeView: 'overview' as const,
    layoutPanels: panels,
    selectedEntry: null,
    onTogglePanel: vi.fn(),
    onOpenPalette: vi.fn(),
    canGoBack: false,
    onGoBack: vi.fn(),
    ...overrides,
  };
  render(<WorkbenchTopbar {...props} />);
  return props;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('WorkbenchTopbar', () => {
  it('exposes search in the top bar', () => {
    const props = renderTopbar();

    fireEvent.click(screen.getByRole('button', { name: 'Search commands and files' }));

    expect(screen.getByText('Search')).toBeVisible();
    expect(screen.getByText('Cmd-K')).toBeVisible();
    expect(props.onOpenPalette).toHaveBeenCalledOnce();
  });

  it('keeps panel toggles available', () => {
    const props = renderTopbar();

    fireEvent.click(screen.getByRole('button', { name: 'Hide navigation' }));
    fireEvent.click(screen.getByRole('button', { name: 'Show Markdown library' }));
    fireEvent.click(screen.getByRole('button', { name: 'Hide inspector' }));

    expect(props.onTogglePanel).toHaveBeenCalledWith('nav');
    expect(props.onTogglePanel).toHaveBeenCalledWith('library');
    expect(props.onTogglePanel).toHaveBeenCalledWith('inspector');
  });

  it('shows a back button when navigation history is available', () => {
    const props = renderTopbar({ canGoBack: true });

    fireEvent.click(screen.getByRole('button', { name: 'Go back' }));

    expect(screen.getByText('Back')).toBeVisible();
    expect(props.onGoBack).toHaveBeenCalledOnce();
  });
});
