import { describe, it, expect } from 'vitest';
import { replaceFrontmatter, setFrontmatterScalar, frontmatterScalar } from './frontmatter';

function fmLine(content: string, key: string): string {
  return content.split('\n').find((line) => line.startsWith(`${key}:`)) ?? '';
}

describe('frontmatter quoting (regression: YAML-magic values must not re-type on the backend)', () => {
  const base = '---\nkind: task\n---\n# T\n';
  const dangerous: Array<[string, string]> = [
    ['colon-space value', 'Email Bob: send the draft'],
    ['leading @', '@committee'],
    ['yes', 'yes'],
    ['no', 'no'],
    ['null', 'null'],
    ['number-like', '007'],
    ['date-like', '2026-05-01'],
  ];

  for (const [name, value] of dangerous) {
    it(`quotes a ${name} so PyYAML keeps it a string`, () => {
      const out = setFrontmatterScalar(base, 'next', value);
      // JSON.stringify form is a valid YAML double-quoted scalar -> always a string.
      expect(fmLine(out, 'next')).toBe(`next: ${JSON.stringify(value)}`);
      // ...and it round-trips back through the reader unchanged.
      expect(frontmatterScalar(out, 'next')).toBe(value);
    });
  }

  it('still emits unambiguous plain strings unquoted', () => {
    expect(fmLine(setFrontmatterScalar(base, 'status', 'done'), 'status')).toBe('status: done');
    expect(fmLine(setFrontmatterScalar(base, 'id', 't-harbor-flows-pitch'), 'id')).toBe('id: t-harbor-flows-pitch');
  });

  it('quotes magic values inside list frontmatter too', () => {
    const out = replaceFrontmatter(base, { tags: ['yes', 'plain'] });
    expect(out).toContain('- "yes"');
    expect(out).toContain('- plain');
  });
});
