export function scalarDisplay(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value) || typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

// Tokens that PyYAML (the backend reader, YAML 1.1) would coerce away from a
// plain string. Emitting any of these unquoted silently changes the value's
// type on the next backend read (e.g. "yes" -> true, "2026-05-01" -> a date,
// "007" -> 7), so they must be quoted.
const YAML_RESERVED = /^(?:~|null|Null|NULL|true|True|TRUE|false|False|FALSE|yes|Yes|YES|no|No|NO|on|On|ON|off|Off|OFF)$/;
const YAML_NUMBERISH = /^[-+]?(?:\.inf|\.nan|\d[\d_]*(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?$/i;
const YAML_DATEISH = /^\d{4}-\d{1,2}-\d{1,2}(?:[Tt ].*)?$/;

function quoteString(value: string): string {
  if (!value) return '""';
  // Only emit a bare (unquoted) scalar when it is unambiguously a plain string:
  // restricted character set (no ':' '@' or other YAML indicators), no leading
  // indicator/whitespace, and not a reserved/number/date token.
  const plainSafe =
    /^[A-Za-z0-9_./ -]+$/.test(value) &&
    !/^[-?:#&*!|>%@`"']/.test(value) &&
    !/^\s|\s$/.test(value) &&
    !YAML_RESERVED.test(value) &&
    !YAML_NUMBERISH.test(value) &&
    !YAML_DATEISH.test(value);
  return plainSafe ? value : JSON.stringify(value);
}

function formatScalar(value: unknown): string {
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  return quoteString(scalarDisplay(value));
}

export function serializeFrontmatter(frontmatter: Record<string, unknown>): string {
  const lines = ['---'];
  for (const [key, value] of Object.entries(frontmatter)) {
    if (!key.trim()) continue;
    if (Array.isArray(value)) {
      lines.push(`${key}:`);
      for (const item of value) {
        lines.push(`  - ${quoteString(String(item))}`);
      }
    } else if (typeof value === 'boolean' || typeof value === 'number') {
      lines.push(`${key}: ${value}`);
    } else {
      lines.push(`${key}: ${quoteString(scalarDisplay(value))}`);
    }
  }
  lines.push('---');
  return `${lines.join('\n')}\n`;
}

export function replaceFrontmatter(content: string, frontmatter: Record<string, unknown>): string {
  const serialized = serializeFrontmatter(frontmatter);
  if (!content.startsWith('---\n') && !content.startsWith('---\r\n')) {
    return `${serialized}${content}`;
  }
  const lines = content.split(/\r?\n/);
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].trim() === '---') {
      return `${serialized}${lines.slice(i + 1).join('\n')}`;
    }
  }
  return `${serialized}${content}`;
}

export function frontmatterScalar(content: string, field: string): string {
  if (!content.startsWith('---\n') && !content.startsWith('---\r\n')) return '';
  const lines = content.split(/\r?\n/);
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === '---') break;
    const match = line.match(/^([A-Za-z0-9_ -]+):\s*(.*)$/);
    if (!match || match[1].trim() !== field) continue;
    const raw = match[2].trim();
    if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
      return raw.slice(1, -1);
    }
    return raw;
  }
  return '';
}

function parseScalar(raw: string): string | number | boolean {
  const text = raw.trim();
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    return text.slice(1, -1);
  }
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text);
  return text;
}

export function frontmatterFromContent(content: string, fallback: Record<string, unknown> = {}): Record<string, unknown> {
  if (!content.startsWith('---\n') && !content.startsWith('---\r\n')) return { ...fallback };
  const lines = content.split(/\r?\n/);
  const parsed: Record<string, unknown> = {};
  const seen = new Set<string>();
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].trim() === '---') break;
    const match = lines[i].match(/^([A-Za-z0-9_ -]+):\s*(.*)$/);
    if (!match) continue;
    const key = match[1].trim();
    const raw = match[2].trim();
    seen.add(key);
    if (raw) {
      parsed[key] = parseScalar(raw);
      continue;
    }
    const items: string[] = [];
    let j = i + 1;
    while (j < lines.length && lines[j].trim() !== '---') {
      const item = lines[j].match(/^\s*-\s*(.*)$/);
      if (!item) break;
      items.push(String(parseScalar(item[1])));
      j += 1;
    }
    parsed[key] = items.length ? items : '';
    i = j - 1;
  }
  return Object.keys(parsed).length ? parsed : { ...fallback };
}

export function setFrontmatterScalar(content: string, field: string, value: unknown): string {
  const rendered = `${field}: ${formatScalar(value)}`;
  if (!content.startsWith('---\n') && !content.startsWith('---\r\n')) {
    return `---\n${rendered}\n---\n${content}`;
  }
  const lines = content.split(/\r?\n/);
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].trim() === '---') {
      lines.splice(i, 0, rendered);
      return lines.join('\n');
    }
    const match = lines[i].match(/^([A-Za-z0-9_ -]+):/);
    if (match && match[1].trim() === field) {
      lines[i] = rendered;
      return lines.join('\n');
    }
  }
  return `---\n${rendered}\n---\n${content}`;
}
