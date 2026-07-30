export interface VaultEntry {
  path: string;
  filename: string;
  title: string;
  id?: string;
  aliases?: string[];
  kind?: string;
  type?: string;
  status?: string;
  project?: string;
  priority?: string;
  due?: string;
  assignee?: string;
  next?: string;
  private?: boolean;
  snippet?: string;
  modified_at?: number;
  outgoing_links?: string[];
  backlinks?: string[];
}

export interface VaultFile {
  path: string;
  content: string;
  modified_at: number;
  frontmatter: Record<string, unknown>;
  body: string;
}

export type View = 'overview' | 'tasks' | 'projects' | 'calendar' | 'library';
