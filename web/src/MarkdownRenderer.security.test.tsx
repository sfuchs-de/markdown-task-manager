import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MarkdownRenderer } from './MarkdownRenderer';

afterEach(() => {
  cleanup();
});

describe('MarkdownRenderer sanitizer', () => {
  it('keeps the narrow note HTML allowlist for common Markdown notes', () => {
    render(
      <MarkdownRenderer
        content={[
          '<details open><summary class="note-summary">Context</summary>Allowed detail</details>',
          '<figure class="note-figure"><img src="https://example.com/chart.png" alt="Chart" title="Chart title" loading="lazy" width="320" height="180"><figcaption class="caption">Chart note</figcaption></figure>',
          '<p>Equation<sup>1</sup> and H<sub>2</sub>O with <kbd>Cmd-K</kbd> and <mark>marked</mark> text.</p>',
          '<a href="https://example.com/paper" target="_blank" rel="noreferrer" title="Paper">Safe link</a>',
          '<a href="mailto:test@example.com">Safe mail</a>',
        ].join('\n')}
      />,
    );

    expect(screen.getByText('Context')).toBeVisible();
    expect(screen.getByText('Allowed detail')).toBeVisible();
    expect(screen.getByText('Chart note')).toBeVisible();
    expect(screen.getByAltText('Chart')).toHaveAttribute('src', 'https://example.com/chart.png');
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('Cmd-K')).toBeInTheDocument();
    expect(screen.getByText('marked')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Safe link' })).toHaveAttribute('href', 'https://example.com/paper');
    expect(screen.getByRole('link', { name: 'Safe mail' })).toHaveAttribute('href', 'mailto:test@example.com');
  });

  it('strips executable tags and unsafe attributes from inline HTML', () => {
    render(
      <MarkdownRenderer
        content={[
          '<script>alert("xss")</script>',
          '<iframe src="https://example.com/embed"></iframe>',
          '<details onclick="steal()"><summary onmouseover="steal()">Unsafe handlers</summary>Body</details>',
          '<p style="position:fixed" onmouseenter="steal()">Styled paragraph</p>',
          '<img src="https://example.com/safe.png" alt="Safe image" onerror="steal()" style="width:9999px">',
        ].join('\n')}
      />,
    );

    expect(document.querySelector('script')).toBeNull();
    expect(document.querySelector('iframe')).toBeNull();
    expect(screen.getByText('Unsafe handlers')).not.toHaveAttribute('onmouseover');
    expect(screen.getByText('Styled paragraph')).not.toHaveAttribute('style');
    expect(screen.getByText('Styled paragraph')).not.toHaveAttribute('onmouseenter');
    expect(screen.getByAltText('Safe image')).toHaveAttribute('src', 'https://example.com/safe.png');
    expect(screen.getByAltText('Safe image')).not.toHaveAttribute('onerror');
    expect(screen.getByAltText('Safe image')).not.toHaveAttribute('style');
  });

  it('removes dangerous link and image protocols while preserving visible text', () => {
    render(
      <MarkdownRenderer
        content={[
          '<a href="javascript:alert(1)">JS link</a>',
          '<a href="data:text/html,evil">Data link</a>',
          '<a href="vbscript:msgbox(1)">VB link</a>',
          '<img src="javascript:alert(1)" alt="JS image">',
          '<img src="data:image/svg+xml;base64,PHN2Zy8+" alt="Data image">',
          '[Markdown JS link](javascript:alert(1))',
        ].join('\n')}
      />,
    );

    for (const label of ['JS link', 'Data link', 'VB link', 'Markdown JS link']) {
      expect(screen.getByText(label)).toBeInTheDocument();
      expect(screen.getByText(label)).not.toHaveAttribute('href');
    }
    expect(screen.getByAltText('JS image')).not.toHaveAttribute('src');
    expect(screen.getByAltText('Data image')).not.toHaveAttribute('src');
  });

  it('does not allow raw style blocks or active form controls in notes', () => {
    render(
      <MarkdownRenderer
        content={[
          '<style>body{display:none}</style>',
          '<form action="https://example.com/collect"><input name="secret" value="x"><button>Send</button></form>',
          '<object data="https://example.com/file.swf"></object>',
        ].join('\n')}
      />,
    );

    expect(document.querySelector('style')).toBeNull();
    expect(document.querySelector('form')).toBeNull();
    expect(document.querySelector('button')).toBeNull();
    expect(document.querySelector('object')).toBeNull();
    const inertInput = document.querySelector('input');
    expect(inertInput).toHaveAttribute('disabled');
    expect(inertInput).not.toHaveAttribute('formaction');
    expect(inertInput).not.toHaveAttribute('onclick');
  });
});
