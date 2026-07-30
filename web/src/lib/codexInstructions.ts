import { isTask } from './filters';
import type { CodexInstruction, CodexInstructionStatus, VaultEntry } from '../types';

const STATUS_ORDER: CodexInstructionStatus[] = ['queued', 'blocked', 'processed', 'cancelled'];
const HEADING_RE = /^##\s+Codex instructions\s*$/im;
const ITEM_RE = /^-\s*\[(?<box>[ xX!-])\]\s*(?:(?<status>queued|blocked|processed|cancelled)\s*\|\s*)?(?:(?<date>\d{4}-\d{2}-\d{2})\s*\|\s*)?(?<text>.+?)\s*$/i;

export interface CodexBacklogItem extends CodexInstruction {
  status: CodexInstructionStatus;
  task: VaultEntry;
}

export interface CodexBacklogLane {
  status: CodexInstructionStatus;
  label: string;
  description: string;
  items: CodexBacklogItem[];
}

export interface CodexBacklogData {
  counts: Record<CodexInstructionStatus, number>;
  lanes: CodexBacklogLane[];
  total: number;
}

export function normalizeCodexInstructionStatus(value: unknown): CodexInstructionStatus {
  const normalized = String(value || '').toLowerCase();
  if (normalized === 'blocked' || normalized === 'processed' || normalized === 'cancelled') return normalized;
  return 'queued';
}

export function parseCodexInstructions(content: string): CodexInstruction[] {
  const match = HEADING_RE.exec(content);
  if (!match) return [];
  const sectionStart = match.index + match[0].length;
  const rest = content.slice(sectionStart);
  const nextSection = /^##\s+/im.exec(rest);
  const section = nextSection ? rest.slice(0, nextSection.index) : rest;
  const lineOffset = content.slice(0, sectionStart).split('\n').length - 1;
  return section.split(/\r?\n/).flatMap((rawLine, index) => {
    const item = ITEM_RE.exec(rawLine.trim());
    if (!item?.groups) return [];
    const marker = item.groups.box.toLowerCase();
    const markerStatus = marker === 'x' ? 'processed' : marker === '!' ? 'blocked' : marker === '-' ? 'cancelled' : 'queued';
    const text = item.groups.text.trim();
    if (!text) return [];
    return [{
      status: normalizeCodexInstructionStatus(item.groups.status || markerStatus),
      date: item.groups.date || null,
      text,
      line: lineOffset + index + 1,
    }];
  });
}

export function codexInstructionCounts(instructions: CodexInstruction[] = []): Record<CodexInstructionStatus, number> {
  return instructions.reduce<Record<CodexInstructionStatus, number>>((counts, instruction) => {
    const status = normalizeCodexInstructionStatus(instruction.status);
    counts[status] += 1;
    return counts;
  }, { queued: 0, blocked: 0, processed: 0, cancelled: 0 });
}

export function queuedCodexInstructions(entry: VaultEntry): CodexInstruction[] {
  return (entry.codex_instructions || []).filter((instruction) => normalizeCodexInstructionStatus(instruction.status) === 'queued');
}

export function formatCodexInstruction(instruction: CodexInstruction): string {
  const status = normalizeCodexInstructionStatus(instruction.status);
  const date = instruction.date ? `${instruction.date} | ` : '';
  return `- ${date}${status}: ${instruction.text}`;
}

export function buildCodexBacklog(entries: VaultEntry[]): CodexBacklogData {
  const grouped = new Map<CodexInstructionStatus, CodexBacklogItem[]>(
    STATUS_ORDER.map((status) => [status, []]),
  );
  for (const entry of entries) {
    if (!isTask(entry)) continue;
    for (const instruction of entry.codex_instructions || []) {
      const status = normalizeCodexInstructionStatus(instruction.status);
      grouped.set(status, [
        ...(grouped.get(status) || []),
        {
          ...instruction,
          status,
          task: entry,
        },
      ]);
    }
  }
  const laneDefinitions: Array<Omit<CodexBacklogLane, 'items'>> = [
    { status: 'queued', label: 'Queued', description: 'Ready for the next Codex pass.' },
    { status: 'blocked', label: 'Blocked', description: 'Needs user input or source access before processing.' },
    { status: 'processed', label: 'Processed', description: 'Handled but retained as task-local history.' },
    { status: 'cancelled', label: 'Cancelled', description: 'No longer needed.' },
  ];
  const lanes: CodexBacklogLane[] = laneDefinitions.map((lane) => ({
    ...lane,
    items: [...(grouped.get(lane.status) || [])].sort((a, b) => {
      const dateDiff = String(a.date || '9999-99-99').localeCompare(String(b.date || '9999-99-99'));
      if (dateDiff !== 0) return dateDiff;
      return a.task.title.localeCompare(b.task.title);
    }),
  }));
  const counts = codexInstructionCounts(lanes.flatMap((lane) => lane.items));
  return {
    counts,
    lanes,
    total: lanes.reduce((sum, lane) => sum + lane.items.length, 0),
  };
}
