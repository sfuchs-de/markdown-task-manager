import { describe, expect, it } from 'vitest';
import { markdownBody, previewMarkdownBody } from './markdownPreview';

describe('markdown preview body', () => {
  it('removes YAML frontmatter before previewing', () => {
    expect(markdownBody('---\ntitle: Test\n---\n# Body')).toBe('# Body');
  });

  it('turns a full LaTeX document body into previewable markdown while keeping math', () => {
    const preview = previewMarkdownBody(String.raw`\documentclass{article}
\usepackage{tikz}
\begin{document}
\maketitle
\section{Model}
The object is
\[
  D_{\mathrm{eff}}=D_{xx}+D_{xm}(I-D_{mm})^{-1}D_{mx}.
\]
\begin{itemize}
\item local cycles matter
\end{itemize}
\end{document}`);

    expect(preview).not.toContain('\\documentclass');
    expect(preview).not.toContain('\\usepackage');
    expect(preview).toContain('# Model');
    expect(preview).toContain('$$');
    expect(preview).toContain('D_{\\mathrm{eff}}');
    expect(preview).toContain('- local cycles matter');
  });

  it('converts equation environments to display math fences', () => {
    const preview = previewMarkdownBody(String.raw`\begin{equation*}
x=y
\end{equation*}`);

    expect(preview).toBe('$$\n\nx=y\n\n$$');
  });
});
