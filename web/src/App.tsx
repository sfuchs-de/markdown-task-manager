import {
  CalendarDays,
  Check,
  CircleDot,
  FilePlus2,
  FolderKanban,
  LayoutDashboard,
  Library,
  Menu,
  Moon,
  PanelLeftClose,
  RefreshCw,
  Save,
  Search,
  Sun,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { createFile, loadEntries, loadFile, patchTask, saveFile, setToken } from './api';
import { counts, entryKind, isTask, visibleEntries, wikiToMarkdown } from './model';
import type { VaultEntry, VaultFile, View } from './types';

const viewItems: { id: View; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'tasks', label: 'Tasks', icon: Check },
  { id: 'projects', label: 'Projects', icon: FolderKanban },
  { id: 'calendar', label: 'Calendar', icon: CalendarDays },
  { id: 'library', label: 'Library', icon: Library },
];

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong';
}

function statusTone(status?: string): string {
  if (status === 'done') return 'success';
  if (status === 'blocked' || status === 'cancelled') return 'danger';
  if (status === 'waiting') return 'warning';
  return 'neutral';
}

function displayDate(value?: string): string {
  if (!value) return '';
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.valueOf())
    ? value
    : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function bodyFromSource(source: string): string {
  if (!source.startsWith('---\n') && !source.startsWith('---\r\n')) return source;
  const lines = source.split(/\r?\n/);
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
  return end >= 0 ? lines.slice(end + 1).join('\n') : source;
}

function normalizeTarget(value: string): string {
  return decodeURIComponent(value).trim().toLowerCase().replace(/\.md$/, '');
}

function matchingEntry(entries: VaultEntry[], target: string): VaultEntry | undefined {
  const wanted = normalizeTarget(target);
  return entries.find((entry) => {
    const candidates = [
      entry.id,
      entry.title,
      entry.path,
      entry.path.replace(/\.md$/, ''),
      entry.filename.replace(/\.md$/, ''),
      ...(entry.aliases || []),
    ];
    return candidates.some((candidate) => candidate && normalizeTarget(candidate) === wanted);
  });
}

function EntryRow({
  entry,
  active,
  onOpen,
}: {
  entry: VaultEntry;
  active: boolean;
  onOpen: (entry: VaultEntry) => void;
}) {
  return (
    <button className={`entry-row ${active ? 'active' : ''}`} onClick={() => onOpen(entry)}>
      <span className="entry-main">
        <span className="entry-title">{entry.title}</span>
        <span className="entry-meta">
          {entry.project || entryKind(entry) || 'note'}
          {entry.due ? ` · ${displayDate(entry.due)}` : ''}
        </span>
      </span>
      {entry.status && <span className={`status ${statusTone(entry.status)}`}>{entry.status}</span>}
    </button>
  );
}

function Overview({
  entries,
  onOpen,
}: {
  entries: VaultEntry[];
  onOpen: (entry: VaultEntry) => void;
}) {
  const summary = counts(entries);
  const tasks = entries
    .filter(isTask)
    .filter((entry) => !['done', 'cancelled', 'archived'].includes(String(entry.status)))
    .sort((a, b) => Number(a.priority || 9) - Number(b.priority || 9))
    .slice(0, 8);
  const projects = entries.filter((entry) => entryKind(entry) === 'project').slice(0, 6);
  return (
    <div className="overview">
      <header className="page-heading">
        <p className="eyebrow">Markdown workbench</p>
        <h1>Your work, in plain files.</h1>
        <p>Tasks, project notes, and decisions remain readable with or without this app.</p>
      </header>
      <section className="metrics" aria-label="Vault summary">
        <div><strong>{summary.tasks}</strong><span>open tasks</span></div>
        <div><strong>{summary.projects}</strong><span>projects</span></div>
        <div><strong>{summary.waiting}</strong><span>waiting or blocked</span></div>
        <div><strong>{summary.notes}</strong><span>notes</span></div>
      </section>
      <div className="overview-grid">
        <section>
          <div className="section-heading"><h2>Next work</h2><span>{tasks.length} shown</span></div>
          <div className="rows">
            {tasks.map((entry) => <EntryRow key={entry.path} entry={entry} active={false} onOpen={onOpen} />)}
            {!tasks.length && <p className="empty">No open tasks yet.</p>}
          </div>
        </section>
        <section>
          <div className="section-heading"><h2>Projects</h2><span>{summary.projects} total</span></div>
          <div className="rows">
            {projects.map((entry) => <EntryRow key={entry.path} entry={entry} active={false} onOpen={onOpen} />)}
            {!projects.length && <p className="empty">Create a project to get started.</p>}
          </div>
        </section>
      </div>
    </div>
  );
}

export default function App() {
  const [entries, setEntries] = useState<VaultEntry[]>([]);
  const [view, setView] = useState<View>('overview');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<VaultFile | null>(null);
  const [source, setSource] = useState('');
  const [mode, setMode] = useState<'preview' | 'edit'>('preview');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [authNeeded, setAuthNeeded] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [dark, setDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);

  const refresh = useCallback(async (force = false) => {
    setLoading(true);
    setMessage('');
    try {
      setEntries(await loadEntries(force));
      setAuthNeeded(false);
    } catch (error) {
      if ((error as { status?: number }).status === 401) setAuthNeeded(true);
      setMessage(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  }, [dark]);

  const openEntry = useCallback(async (entry: VaultEntry) => {
    setMessage('');
    try {
      const file = await loadFile(entry.path);
      setSelected(file);
      setSource(file.content);
      setMode('preview');
      setSidebarOpen(false);
    } catch (error) {
      setMessage(errorMessage(error));
    }
  }, []);

  const openWikiTarget = useCallback((href: string) => {
    const raw = href.slice('vault:'.length).split('#', 1)[0];
    const entry = matchingEntry(entries, raw);
    if (entry) void openEntry(entry);
    else setMessage(`Linked document “${decodeURIComponent(raw)}” is not available in this vault.`);
  }, [entries, openEntry]);

  const save = async () => {
    if (!selected || source === selected.content) return;
    setSaving(true);
    setMessage('');
    try {
      const saved = await saveFile(selected, source);
      setSelected(saved);
      setSource(saved.content);
      await refresh();
      setMessage('Saved');
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const changeTaskStatus = async (status: string) => {
    if (!selected) return;
    setSaving(true);
    try {
      const saved = await patchTask(selected, { status });
      setSelected(saved);
      setSource(saved.content);
      await refresh();
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const create = async () => {
    const kind = window.prompt('Create a task, project, event, or note:', 'task')?.trim().toLowerCase();
    if (!kind) return;
    const title = window.prompt(`Title for the new ${kind}:`)?.trim();
    if (!title) return;
    try {
      const file = await createFile(kind, title);
      setSelected(file);
      setSource(file.content);
      setMode('edit');
      await refresh();
    } catch (error) {
      setMessage(errorMessage(error));
    }
  };

  const filtered = useMemo(
    () => visibleEntries(entries, view, query),
    [entries, view, query],
  );
  const selectedEntry = selected ? entries.find((entry) => entry.path === selected.path) : undefined;
  const dirty = Boolean(selected && source !== selected.content);

  if (authNeeded) {
    return (
      <main className="auth-screen">
        <form onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          setToken(String(data.get('token') || ''));
          void refresh();
        }}>
          <div className="brand-mark"><Check size={26} /></div>
          <h1>Unlock your task manager</h1>
          <p>Enter the private app token configured on your server. It stays in this browser.</p>
          <label htmlFor="token">App token</label>
          <input id="token" name="token" type="password" autoComplete="current-password" required />
          <button className="primary" type="submit">Continue</button>
          {message && <p className="error">{message}</p>}
        </form>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="brand">
          <span className="brand-mark"><Check size={18} /></span>
          <span><strong>Markdown</strong><small>Task Manager</small></span>
          <button className="icon-button close-mobile" onClick={() => setSidebarOpen(false)} aria-label="Close navigation"><X /></button>
        </div>
        <nav aria-label="Main navigation">
          {viewItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={view === item.id && !selected ? 'active' : ''}
                onClick={() => { setSelected(null); setView(item.id); setSidebarOpen(false); }}
              >
                <Icon size={18} /><span>{item.label}</span>
              </button>
            );
          })}
        </nav>
        <div className="sidebar-footer">
          <button onClick={() => setDark((value) => !value)}>
            {dark ? <Sun size={17} /> : <Moon size={17} />}
            <span>{dark ? 'Light mode' : 'Dark mode'}</span>
          </button>
          <p>Files stay in your vault.</p>
        </div>
      </aside>
      {sidebarOpen && <button className="scrim" aria-label="Close navigation" onClick={() => setSidebarOpen(false)} />}

      <main className="workspace">
        <header className="topbar">
          <button className="icon-button mobile-menu" onClick={() => setSidebarOpen(true)} aria-label="Open navigation"><Menu /></button>
          <div className="search">
            <Search size={17} />
            <input
              aria-label="Search vault"
              placeholder="Search titles, paths, projects…"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                if (event.target.value && view === 'overview') {
                  setSelected(null);
                  setView('library');
                }
              }}
            />
          </div>
          <button className="secondary" onClick={() => void refresh(true)} disabled={loading}>
            <RefreshCw size={16} className={loading ? 'spin' : ''} /><span>Refresh</span>
          </button>
          <button className="primary" onClick={() => void create()}><FilePlus2 size={17} /><span>New</span></button>
        </header>
        {message && (
          <div className={`notice ${message === 'Saved' ? 'success' : ''}`} role="status">
            <span>{message}</span><button onClick={() => setMessage('')} aria-label="Dismiss"><X size={15} /></button>
          </div>
        )}

        {selected ? (
          <div className="document-workspace">
            <header className="document-bar">
              <button className="icon-button" onClick={() => setSelected(null)} aria-label="Close document"><PanelLeftClose /></button>
              <div>
                <strong>{selectedEntry?.title || selected.path.split('/').pop()}</strong>
                <span>{selected.path}</span>
              </div>
              {isTask(selectedEntry || { path: selected.path, filename: '', title: '' }) && (
                <select
                  aria-label="Task status"
                  value={selectedEntry?.status || 'open'}
                  onChange={(event) => void changeTaskStatus(event.target.value)}
                  disabled={saving}
                >
                  {['open', 'active', 'waiting', 'blocked', 'done', 'cancelled'].map((status) => (
                    <option key={status}>{status}</option>
                  ))}
                </select>
              )}
              <div className="mode-switch" role="group" aria-label="Document mode">
                <button className={mode === 'preview' ? 'active' : ''} onClick={() => setMode('preview')}>Read</button>
                <button className={mode === 'edit' ? 'active' : ''} onClick={() => setMode('edit')}>Edit</button>
              </div>
              <button className="primary" onClick={() => void save()} disabled={!dirty || saving}>
                <Save size={16} />{saving ? 'Saving…' : dirty ? 'Save' : 'Saved'}
              </button>
            </header>
            {mode === 'edit' ? (
              <textarea
                className="source-editor"
                aria-label="Markdown source"
                value={source}
                onChange={(event) => setSource(event.target.value)}
                spellCheck
              />
            ) : (
              <article className="markdown">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  urlTransform={(url) => (
                    url.startsWith('vault:')
                    || url.startsWith('https://')
                    || url.startsWith('http://')
                    || url.startsWith('mailto:')
                    || url.startsWith('#')
                      ? url
                      : ''
                  )}
                  components={{
                    a: ({ href = '', children, ...props }) => href.startsWith('vault:')
                      ? <a href="#" onClick={(event) => { event.preventDefault(); openWikiTarget(href); }}>{children}</a>
                      : <a href={href} rel="noreferrer" target="_blank" {...props}>{children}</a>,
                  }}
                >
                  {wikiToMarkdown(bodyFromSource(source))}
                </ReactMarkdown>
              </article>
            )}
          </div>
        ) : view === 'overview' ? (
          <Overview entries={entries} onOpen={openEntry} />
        ) : (
          <div className="collection">
            <header className="page-heading compact">
              <p className="eyebrow">Vault view</p>
              <h1>{viewItems.find((item) => item.id === view)?.label}</h1>
              <p>{filtered.length} {filtered.length === 1 ? 'document' : 'documents'}</p>
            </header>
            <div className="rows collection-rows">
              {filtered.map((entry) => (
                <EntryRow key={entry.path} entry={entry} active={false} onOpen={openEntry} />
              ))}
              {!loading && !filtered.length && <p className="empty">No matching documents.</p>}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
