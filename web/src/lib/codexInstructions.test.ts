import { describe, expect, it } from 'vitest';
import { buildCodexBacklog, codexInstructionCounts, formatCodexInstruction, parseCodexInstructions } from './codexInstructions';
import type { VaultEntry } from '../types';

const markdown = `# Task

## Codex instructions

- [ ] queued | 2026-05-26 | Review sources and update the task.
- [!] blocked | 2026-05-27 | Needs source record evidence.
- [x] processed | 2026-05-28 | Draft added.
- [-] cancelled | Obsolete after consolidation.

## Log

- Done.
`;

describe('codex instructions', () => {
  it('parses task-local instruction sections', () => {
    const instructions = parseCodexInstructions(markdown);

    expect(instructions.map((instruction) => instruction.status)).toEqual(['queued', 'blocked', 'processed', 'cancelled']);
    expect(instructions[0]).toMatchObject({ date: '2026-05-26', text: 'Review sources and update the task.' });
    expect(instructions[3]).toMatchObject({ date: null, text: 'Obsolete after consolidation.' });
    expect(codexInstructionCounts(instructions)).toMatchObject({ queued: 1, blocked: 1, processed: 1, cancelled: 1 });
    expect(formatCodexInstruction(instructions[0])).toContain('queued: Review sources');
  });

  it('builds a visible backlog from task entries only', () => {
    const task: VaultEntry = {
      path: 'tasks/active/t-demo.md',
      filename: 't-demo.md',
      title: 'Demo task',
      kind: 'task',
      status: 'open',
      project: 'alpha',
      codex_instructions: parseCodexInstructions(markdown),
    };
    const note: VaultEntry = {
      path: 'notes/note.md',
      filename: 'note.md',
      title: 'Note',
      kind: 'note',
      codex_instructions: [{ status: 'queued', text: 'Ignore notes.' }],
    };

    const backlog = buildCodexBacklog([note, task]);

    expect(backlog.total).toBe(4);
    expect(backlog.counts.queued).toBe(1);
    expect(backlog.lanes.find((lane) => lane.status === 'queued')?.items[0].task.title).toBe('Demo task');
  });
});
