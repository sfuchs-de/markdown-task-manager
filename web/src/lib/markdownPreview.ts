export function markdownBody(content: string): string {
  if (!content.startsWith('---\n') && !content.startsWith('---\r\n')) return content;
  const lines = content.split(/\r?\n/);
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].trim() === '---') return lines.slice(i + 1).join('\n');
  }
  return content;
}

function normalizeLatexMath(text: string): string {
  return text
    .replace(/\\\[/g, () => '\n$$\n')
    .replace(/\\\]/g, () => '\n$$\n')
    .replace(/\\\(/g, '$')
    .replace(/\\\)/g, '$')
    .replace(/\\begin\{(?:equation|align|gather)\*?\}/g, () => '\n$$\n')
    .replace(/\\end\{(?:equation|align|gather)\*?\}/g, () => '\n$$\n');
}

export function previewMarkdownBody(content: string): string {
  const body = markdownBody(content);
  if (!/\\documentclass|\\begin\{document\}/.test(body)) return normalizeLatexMath(body).trim();
  const withoutPreamble = body.replace(/^[\s\S]*?\\begin\{document\}/, '');
  return normalizeLatexMath(withoutPreamble
    .replace(/\\end\{document\}[\s\S]*$/g, '')
    .replace(/\\maketitle/g, '')
    .replace(/\\tableofcontents/g, '')
    .replace(/\\newpage/g, '\n\n---\n\n')
    .replace(/\\section\*?\{([^}]+)\}/g, '\n\n# $1\n\n')
    .replace(/\\subsection\*?\{([^}]+)\}/g, '\n\n## $1\n\n')
    .replace(/\\subsubsection\*?\{([^}]+)\}/g, '\n\n### $1\n\n')
    .replace(/\\paragraph\{([^}]+)\}/g, '\n\n**$1.** ')
    .replace(/\\begin\{itemize\}/g, '\n')
    .replace(/\\end\{itemize\}/g, '\n')
    .replace(/\\item\s+/g, '- ')
    .replace(/\\begin\{quote\}/g, '\n> ')
    .replace(/\\end\{quote\}/g, '\n'))
    .trim();
}
