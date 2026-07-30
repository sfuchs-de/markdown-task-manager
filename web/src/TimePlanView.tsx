import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Clipboard, Clock3, Info, RefreshCcw, SlidersHorizontal } from 'lucide-react';
import { getTimePlan, getTimePlanAgentContext } from './api';
import type { TaskMetadataUpdates, TimePlanAgentContext, TimePlanBlock, TimePlanDay, TimePlanProjectSummary, TimePlanResponse, TimePlanTask } from './types';

interface TimePlanViewProps {
  privateMode: boolean;
  onOpen: (path: string) => void;
  onPatchTaskMetadata?: (path: string, updates: TaskMetadataUpdates, currentModifiedAt?: number) => Promise<void> | void;
  onError?: (message: string) => void;
}

function localIsoDate(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function minutesLabel(minutes: number): string {
  if (!minutes) return '0m';
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest}m`;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

const DURATION_PRESETS = [
  { label: 'S', minutes: 30 },
  { label: 'M', minutes: 60 },
  { label: 'L', minutes: 120 },
  { label: 'XL', minutes: 180 },
  { label: 'XXL', minutes: 240 },
];
const TIME_CATEGORY_OPTIONS = [
  { label: 'Auto cat', value: '' },
  { label: 'Research', value: 'research' },
  { label: 'Admin', value: 'admin' },
  { label: 'Other', value: 'other' },
];
const SCHEDULE_POLICY_OPTIONS = [
  { label: 'Auto policy', value: '' },
  { label: 'Anchor', value: 'research-anchor' },
  { label: 'Edge', value: 'admin-edge' },
  { label: 'Today', value: 'schedule-today' },
  { label: 'Defer', value: 'defer' },
];
const TIME_PLAN_FETCH_DEBOUNCE_MS = 250;

type TimePlanQuery = {
  date: string;
  weekStart: string;
  start: string;
  capacityMinutes: number;
  weekdays: number;
  horizonDays: number;
};

type TimePlanCacheQuery = TimePlanQuery & {
  refreshIndex: number;
};

type AgentContextCacheQuery = TimePlanCacheQuery & {
  adHoc: string;
  includePrivate: boolean;
};

function queryKey(query: TimePlanCacheQuery | AgentContextCacheQuery): string {
  return JSON.stringify(query);
}

function estimateMinutes(task: TimePlanTask): number {
  return Number(task.estimate_minutes || task.minutes || 60);
}

function metadataTruthy(value: unknown): boolean {
  return value === true || ['true', '1', 'yes', 'urgent', 'focus'].includes(String(value || '').trim().toLowerCase());
}

function normalizeDurationMinutes(minutes: number): number {
  if (!Number.isFinite(minutes) || minutes <= 0) return 60;
  return Math.min(1440, Math.max(15, Math.round(minutes / 15) * 15));
}

function durationClass(minutes: number): string {
  if (minutes >= 180) return 'deep';
  if (minutes >= 120) return 'long';
  if (minutes <= 30) return 'short';
  return 'standard';
}

type TimeCategory = 'research' | 'admin' | 'other' | 'calendar';

function timeCategory(task: TimePlanTask): TimeCategory {
  if (task.kind === 'calendar') return 'calendar';
  const raw = String(task.time_category || task.domain || '').toLowerCase();
  if (raw === 'research') return 'research';
  if (raw === 'admin') return 'admin';
  return 'other';
}

function categoryLabel(task: TimePlanTask): string {
  const category = timeCategory(task);
  if (category === 'calendar') return 'Meeting';
  if (category === 'research') return 'Research';
  if (category === 'admin') return 'Admin';
  return 'Other';
}

function deadlineType(task: TimePlanTask): 'hard' | 'soft' {
  return String(task.deadline_type || '').toLowerCase() === 'hard' ? 'hard' : 'soft';
}

function schedulePolicyLabel(value: unknown): string {
  const normalized = String(value || '').trim().toLowerCase().replace(/_/g, '-');
  const option = SCHEDULE_POLICY_OPTIONS.find((item) => item.value === normalized);
  return option && option.value ? `policy: ${option.label.toLowerCase()}` : '';
}

function blockDurationStyle(minutes: number, compact: boolean): CSSProperties {
  const boundedMinutes = Math.max(30, Math.min(240, normalizeDurationMinutes(minutes)));
  const minHeight = compact ? 70 : 88;
  const pxPerMinute = compact ? 0.75 : 1.05;
  return {
    '--time-block-min-height': `${Math.max(minHeight, Math.round(boundedMinutes * pxPerMinute))}px`,
  } as CSSProperties;
}

function segmentLabel(block: TimePlanBlock): string {
  const count = Number(block.segment_count || 1);
  const index = Number(block.segment_index || 1);
  return count > 1 ? `segment ${index}/${count}` : '';
}

function visibleBlocks(blocks: TimePlanBlock[], privateMode: boolean): TimePlanBlock[] {
  return privateMode ? blocks.filter((block) => !block.private) : blocks;
}

function visibleTasks(tasks: TimePlanTask[], privateMode: boolean): TimePlanTask[] {
  return privateMode ? tasks.filter((task) => !task.private) : tasks;
}

function categoryMinutes(items: Array<TimePlanBlock | TimePlanTask>, category: TimeCategory): number {
  return items
    .filter((item) => timeCategory(item) === category)
    .reduce((sum, item) => sum + Number(item.minutes || 0), 0);
}

function firstBlockByCategory(blocks: TimePlanBlock[], category: TimeCategory): TimePlanBlock | undefined {
  return blocks.find((block) => timeCategory(block) === category);
}

export function visibleTimePlan(plan: TimePlanResponse, privateMode: boolean): TimePlanResponse {
  const dailyBlocks = visibleBlocks(plan.daily.blocks, privateMode);
  return {
    ...plan,
    daily: {
      ...plan.daily,
      blocks: dailyBlocks,
      total_minutes: dailyBlocks.reduce((sum, block) => sum + block.minutes, 0),
    },
    daily_overflow: visibleTasks(plan.daily_overflow, privateMode),
    weekly: plan.weekly.map((day) => {
      const blocks = visibleBlocks(day.blocks, privateMode);
      return {
        ...day,
        blocks,
        total_minutes: blocks.reduce((sum, block) => sum + block.minutes, 0),
      };
    }),
    weekly_overflow: visibleTasks(plan.weekly_overflow, privateMode),
  };
}

export function TimePlanView({ privateMode, onOpen, onPatchTaskMetadata, onError }: TimePlanViewProps) {
  const today = useMemo(() => localIsoDate(), []);
  const [date, setDate] = useState(today);
  const [weekStart, setWeekStart] = useState(today);
  const [start, setStart] = useState('09:00');
  const [capacityMinutes, setCapacityMinutes] = useState(420);
  const [weekdays, setWeekdays] = useState(5);
  const [horizonDays, setHorizonDays] = useState(14);
  const [plan, setPlan] = useState<TimePlanResponse | null>(null);
  const [agentContext, setAgentContext] = useState<TimePlanAgentContext | null>(null);
  const [agentOpen, setAgentOpen] = useState(false);
  const [adHoc, setAdHoc] = useState('');
  const [loading, setLoading] = useState(false);
  const [agentLoading, setAgentLoading] = useState(false);
  const [error, setError] = useState('');
  const [agentError, setAgentError] = useState('');
  const [copyStatus, setCopyStatus] = useState('');
  const [refreshIndex, setRefreshIndex] = useState(0);
  const planCacheRef = useRef(new Map<string, TimePlanResponse>());
  const agentCacheRef = useRef(new Map<string, TimePlanAgentContext>());
  const planRequestRef = useRef(new Map<string, Promise<TimePlanResponse>>());
  const agentRequestRef = useRef(new Map<string, Promise<TimePlanAgentContext>>());

  const patchTask = async (path: string, updates: TaskMetadataUpdates) => {
    if (!onPatchTaskMetadata) return;
    await onPatchTaskMetadata?.(path, updates);
    planCacheRef.current.clear();
    agentCacheRef.current.clear();
    planRequestRef.current.clear();
    agentRequestRef.current.clear();
    setRefreshIndex((current) => current + 1);
  };

  const agentQueryAdHoc = agentOpen ? adHoc : '';
  const includePrivateInAgentBrief = agentOpen ? !privateMode : true;
  const baseQuery = useMemo<TimePlanQuery>(() => ({
    date,
    weekStart,
    start,
    capacityMinutes,
    weekdays,
    horizonDays,
  }), [capacityMinutes, date, horizonDays, start, weekdays, weekStart]);
  const planCacheKey = useMemo(() => queryKey({ ...baseQuery, refreshIndex }), [baseQuery, refreshIndex]);
  const agentCacheKey = useMemo(
    () => queryKey({
      ...baseQuery,
      refreshIndex,
      adHoc: agentQueryAdHoc,
      includePrivate: includePrivateInAgentBrief,
    }),
    [agentQueryAdHoc, baseQuery, includePrivateInAgentBrief, refreshIndex],
  );

  useEffect(() => {
    let cancelled = false;
    setError('');

    if (agentOpen) {
      const cachedContext = agentCacheRef.current.get(agentCacheKey);
      if (cachedContext) {
        setAgentContext(cachedContext);
        setPlan(cachedContext.deterministic_plan);
        setLoading(false);
        setAgentLoading(false);
        setAgentError('');
        onError?.('');
        return undefined;
      }

      setAgentLoading(true);
      setLoading(true);
      setAgentError('');
      const timeoutId = window.setTimeout(() => {
        let request = agentRequestRef.current.get(agentCacheKey);
        if (!request) {
          request = getTimePlanAgentContext({
            ...baseQuery,
            adHoc: agentQueryAdHoc,
            includePrivate: includePrivateInAgentBrief,
          }).finally(() => {
            agentRequestRef.current.delete(agentCacheKey);
          });
          agentRequestRef.current.set(agentCacheKey, request);
        }
        request
        .then((context) => {
          if (cancelled) return;
          agentCacheRef.current.set(agentCacheKey, context);
          planCacheRef.current.set(planCacheKey, context.deterministic_plan);
          setAgentContext(context);
          setPlan(context.deterministic_plan);
          onError?.('');
        })
        .catch((exc) => {
          const message = exc instanceof Error ? exc.message : 'Could not load agent brief';
          if (cancelled) return;
          setAgentError(message);
          setError(message);
          onError?.(message);
        })
        .finally(() => {
          if (!cancelled) {
            setLoading(false);
            setAgentLoading(false);
          }
        });
      }, TIME_PLAN_FETCH_DEBOUNCE_MS);
      return () => {
        cancelled = true;
        window.clearTimeout(timeoutId);
      };
    } else {
      const cachedPlan = planCacheRef.current.get(planCacheKey);
      if (cachedPlan) {
        setPlan(cachedPlan);
        setLoading(false);
        setAgentLoading(false);
        setError('');
        onError?.('');
        return undefined;
      }

      setAgentLoading(false);
      setLoading(true);
      const timeoutId = window.setTimeout(() => {
        let request = planRequestRef.current.get(planCacheKey);
        if (!request) {
          request = getTimePlan(baseQuery).finally(() => {
            planRequestRef.current.delete(planCacheKey);
          });
          planRequestRef.current.set(planCacheKey, request);
        }
        request
        .then((nextPlan) => {
          if (cancelled) return;
          planCacheRef.current.set(planCacheKey, nextPlan);
          setPlan(nextPlan);
          onError?.('');
        })
        .catch((exc) => {
          const message = exc instanceof Error ? exc.message : 'Could not load time plan';
          if (cancelled) return;
          setError(message);
          onError?.(message);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
      }, TIME_PLAN_FETCH_DEBOUNCE_MS);
      return () => {
        cancelled = true;
        window.clearTimeout(timeoutId);
      };
    }
  }, [agentCacheKey, agentOpen, agentQueryAdHoc, baseQuery, includePrivateInAgentBrief, onError, planCacheKey]);

  const visiblePlan = useMemo(() => plan ? visibleTimePlan(plan, privateMode) : null, [plan, privateMode]);
  const weeklyMinutes = visiblePlan?.weekly.reduce((sum, day) => sum + day.total_minutes, 0) || 0;
  const calendarStatus = visiblePlan?.calendar || agentContext?.calendar;
  const noWorkBefore = visiblePlan?.settings.no_work_before || agentContext?.settings.no_work_before || '';
  const nonWorkingToday = Boolean(noWorkBefore && date < noWorkBefore);

  return (
    <section className="work-view time-plan-view">
      <header className="view-header time-plan-header">
        <div>
          <span className="eyebrow">Computed schedule</span>
          <h1>Time Plan</h1>
          <p>
            {loading ? 'Planning from current Markdown tasks...' : `${minutesLabel(visiblePlan?.daily.total_minutes || 0)} today · ${minutesLabel(weeklyMinutes)} this week`}
            {privateMode ? ' · private hidden in this view' : ' · private visible in this view'}
          </p>
          <p className="time-plan-policy">Research fills the main day; admin is batched at a day edge, usually late PM, capped at 90m.</p>
          {calendarStatus?.enabled && (
            <p className="time-plan-calendar-status">
              Calendar/date blocks scheduling · {calendarStatus.event_count} events · {calendarStatus.source_labels.join(', ') || 'configured feed'}
              {calendarStatus.errors?.length ? ` · ${calendarStatus.errors.join('; ')}` : ''}
            </p>
          )}
          {error && <p className="error">{error}</p>}
          {nonWorkingToday && <p className="time-plan-availability">No work blocks before {noWorkBefore}; weekly allocation starts on the next available workday.</p>}
        </div>
        <details className="time-plan-settings">
          <summary aria-label="Toggle time plan settings">
            <span><SlidersHorizontal size={14} /> Plan settings</span>
            <small>{date} · {minutesLabel(capacityMinutes)} cap · {weekdays}d</small>
          </summary>
          <div className="time-plan-controls" aria-label="Time plan controls">
            <label>
              Date
              <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
            </label>
            <label>
              Week start
              <input type="date" value={weekStart} onChange={(event) => setWeekStart(event.target.value)} />
            </label>
            <label>
              Start
              <input type="time" value={start} onChange={(event) => setStart(event.target.value)} />
            </label>
            <label>
              Capacity
              <input type="number" min={60} max={1440} step={15} value={capacityMinutes} onChange={(event) => setCapacityMinutes(Number(event.target.value) || 420)} />
            </label>
            <label>
              Days
              <input type="number" min={1} max={14} value={weekdays} onChange={(event) => setWeekdays(Number(event.target.value) || 5)} />
            </label>
            <label>
              Horizon
              <input type="number" min={0} max={365} value={horizonDays} onChange={(event) => setHorizonDays(Number(event.target.value) || 14)} />
            </label>
          </div>
        </details>
      </header>

      {!visiblePlan && !error ? (
        <div className="time-plan-empty"><RefreshCcw size={18} /> Loading plan...</div>
      ) : visiblePlan && (
        <div className="time-plan-layout">
          <TimePlanSummaryStrip plan={visiblePlan} />

          <section className="time-plan-section daily-plan">
            <TimePlanSectionTitle title="Daily Plan" meta={`${visiblePlan.daily.date} · ${minutesLabel(visiblePlan.daily.total_minutes)}`} />
            <div className="time-block-list">
              {visiblePlan.daily.blocks.length === 0 ? <p className="muted">No open urgent or high-priority task fits today.</p> : visiblePlan.daily.blocks.map((block) => (
                <TimeBlockButton key={`${block.path}:${block.start}`} block={block} onOpen={onOpen} onPatchTask={patchTask} />
              ))}
            </div>
          </section>

          <TimePlanRationalePanel plan={visiblePlan} />

          <AgentBriefPanel
            context={agentContext}
            open={agentOpen}
            setOpen={setAgentOpen}
            adHoc={adHoc}
            setAdHoc={setAdHoc}
            loading={agentLoading}
            error={agentError}
            copyStatus={copyStatus}
            setCopyStatus={setCopyStatus}
          />

          <details className="time-plan-section weekly-plan time-plan-collapsible-section">
            <summary className="overview-section-title" aria-label="Toggle weekly plan">
              <h2><Clock3 size={16} /> Weekly Plan</h2>
              <span>{visiblePlan.weekly.length} workdays · {minutesLabel(weeklyMinutes)}</span>
            </summary>
            <div className="time-week-grid">
              {visiblePlan.weekly.map((day) => (
                <TimePlanDayColumn key={day.date} day={day} onOpen={onOpen} onPatchTask={patchTask} />
              ))}
            </div>
          </details>

          <details className="time-plan-section overflow-plan time-plan-collapsible-section">
            <summary className="overview-section-title" aria-label="Toggle overflow plan">
              <h2><Clock3 size={16} /> Overflow</h2>
              <span>{visiblePlan.daily_overflow.length} today · {visiblePlan.weekly_overflow.length} week</span>
            </summary>
            <div className="overflow-columns">
              <OverflowList title="Not scheduled today" tasks={visiblePlan.daily_overflow} onOpen={onOpen} onPatchTask={patchTask} />
              <OverflowList title="Not scheduled this week" tasks={visiblePlan.weekly_overflow} onOpen={onOpen} onPatchTask={patchTask} />
            </div>
          </details>
        </div>
      )}
    </section>
  );
}

function TimePlanSummaryStrip({ plan }: { plan: TimePlanResponse }) {
  const researchBlock = firstBlockByCategory(plan.daily.blocks, 'research');
  const adminMinutes = categoryMinutes(plan.daily.blocks, 'admin') + categoryMinutes(plan.daily.blocks, 'other');
  const meetingMinutes = categoryMinutes(plan.daily.blocks, 'calendar');
  const overflowMinutes = categoryMinutes(plan.daily_overflow, 'research')
    + categoryMinutes(plan.daily_overflow, 'admin')
    + categoryMinutes(plan.daily_overflow, 'other');
  const summaryItems = [
    {
      label: 'Research anchor',
      value: researchBlock ? minutesLabel(researchBlock.minutes) : 'none',
      detail: researchBlock?.title || 'No research block fit today',
    },
    {
      label: 'Admin edge',
      value: adminMinutes ? minutesLabel(adminMinutes) : 'none',
      detail: adminMinutes ? 'Batched around the research block' : 'No admin block scheduled',
    },
    {
      label: 'Meetings',
      value: meetingMinutes ? minutesLabel(meetingMinutes) : 'none',
      detail: meetingMinutes ? 'Calendar blocks reserve capacity' : 'No blocking meeting imported',
    },
    {
      label: 'Overflow',
      value: plan.daily_overflow.length ? `${plan.daily_overflow.length} items` : 'clear',
      detail: overflowMinutes ? `${minutesLabel(overflowMinutes)} outside today` : 'Nothing waiting outside today',
    },
  ];
  return (
    <section className="time-plan-summary-strip" aria-label="Time plan daily summary">
      {summaryItems.map((item) => (
        <article key={item.label}>
          <span>{item.label}</span>
          <strong>{item.value}</strong>
          <small>{item.detail}</small>
        </article>
      ))}
    </section>
  );
}

function TimePlanRationalePanel({ plan }: { plan: TimePlanResponse }) {
  const scheduled = plan.daily.blocks;
  const overflow = plan.daily_overflow;
  return (
    <details className="time-plan-section time-plan-rationale-panel">
      <summary className="overview-section-title" aria-label="Toggle time plan rationale">
        <h2><Info size={16} /> Why this plan</h2>
        <span>{scheduled.length} scheduled · {overflow.length} overflow</span>
      </summary>
      <div className="time-plan-rationale-grid">
        <RationaleList title="Scheduled today" items={scheduled} empty="No blocks scheduled today." />
        <RationaleList title="Overflow today" items={overflow} empty="Nothing overflowed today." />
      </div>
    </details>
  );
}

function RationaleList({
  title,
  items,
  empty,
}: {
  title: string;
  items: Array<TimePlanBlock | TimePlanTask>;
  empty: string;
}) {
  return (
    <div className="time-plan-rationale-list">
      <h3>{title}</h3>
      {items.length === 0 ? <p className="muted">{empty}</p> : items.map((item) => (
        <div className="time-plan-rationale-row" key={`${title}:${item.path}:${'start' in item ? item.start : ''}`}>
          <span className={`category-chip category-${timeCategory(item)}`}>{categoryLabel(item)}</span>
          <div>
            <strong>{item.title}</strong>
            <small>
              {item.reason || 'no reason recorded'}
              {'start' in item && item.start ? ` · ${item.start}-${item.end}` : ''}
              {item.minutes ? ` · ${minutesLabel(item.minutes)}` : ''}
              {metadataTruthy(item.focus_manual) ? ' · manual focus' : ''}
              {schedulePolicyLabel(item.schedule_policy) ? ` · ${schedulePolicyLabel(item.schedule_policy)}` : ''}
            </small>
          </div>
        </div>
      ))}
    </div>
  );
}

function AgentBriefPanel({
  context,
  open,
  setOpen,
  adHoc,
  setAdHoc,
  loading,
  error,
  copyStatus,
  setCopyStatus,
}: {
  context: TimePlanAgentContext | null;
  open: boolean;
  setOpen: (value: boolean) => void;
  adHoc: string;
  setAdHoc: (value: string) => void;
  loading: boolean;
  error: string;
  copyStatus: string;
  setCopyStatus: (value: string) => void;
}) {
  async function copyPrompt() {
    if (!context?.agent_prompt) return;
    try {
      await navigator.clipboard.writeText(context.agent_prompt);
      setCopyStatus('Copied');
      window.setTimeout(() => setCopyStatus(''), 1600);
    } catch {
      setCopyStatus('Copy failed');
    }
  }

  return (
    <details className="time-plan-section agent-brief-panel" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="overview-section-title">
        <h2><Clipboard size={16} /> Agent Brief</h2>
        <span>{loading ? 'refreshing' : open ? 'ready' : 'open when needed'}</span>
      </summary>
      <div className="agent-brief-grid">
        <label className="agent-ad-hoc">
          Ad hoc constraints
          <textarea
            aria-label="Ad hoc planning constraints"
            value={adHoc}
            onChange={(event) => setAdHoc(event.target.value)}
            placeholder="Example: low energy today; prioritize one research project and one admin block; protect 2h for writing."
          />
        </label>
        <div className="agent-brief-summary">
          {error && <p className="error">{error}</p>}
          <p className="muted">
            {context?.preferences.exists ? `Using ${context.preferences.path}` : 'No stored preference profile found.'}
            {context?.settings.include_private ? ' · private included' : ' · private tasks hidden'}
          </p>
          <p>{context?.preferences.summary || 'Preference summary loading...'}</p>
          <button className="copy-brief-button" disabled={!context?.agent_prompt} onClick={() => void copyPrompt()}>
            <Clipboard size={15} /> {copyStatus || 'Copy Codex Brief'}
          </button>
        </div>
      </div>
      <div className="agent-brief-lists">
        <AgentTaskList title="Pressing Tasks" tasks={context?.pressing_tasks || []} />
        <AgentProjectList projects={context?.pressing_projects || []} />
      </div>
    </details>
  );
}

function AgentTaskList({ title, tasks }: { title: string; tasks: TimePlanTask[] }) {
  return (
    <div className="agent-list">
      <h3>{title}</h3>
      {tasks.length === 0 ? <p className="muted">No pressing tasks in the brief.</p> : tasks.slice(0, 8).map((task) => (
        <div className="agent-list-row" key={task.path}>
          <strong>{task.title}</strong>
          <span>{task.reason} · P{task.priority || '-'} · {task.project || 'no project'} · {deadlineType(task)} · {task.due || 'no date'}</span>
        </div>
      ))}
    </div>
  );
}

function AgentProjectList({ projects }: { projects: TimePlanProjectSummary[] }) {
  return (
    <div className="agent-list">
      <h3>Pressing Projects</h3>
      {projects.length === 0 ? <p className="muted">No pressing projects in the brief.</p> : projects.slice(0, 8).map((project) => (
        <div className="agent-list-row" key={project.path || project.title}>
          <strong>{project.title}</strong>
          <span>P{project.priority || '-'} · {project.open_task_count} tasks · {project.deadline_type || 'soft'} · {project.deadline || 'no deadline'}</span>
        </div>
      ))}
    </div>
  );
}

function TimePlanSectionTitle({ title, meta }: { title: string; meta: string }) {
  return (
    <div className="overview-section-title">
      <h2><Clock3 size={16} /> {title}</h2>
      <span>{meta}</span>
    </div>
  );
}

function TimePlanDayColumn({
  day,
  onOpen,
  onPatchTask,
}: {
  day: TimePlanDay;
  onOpen: (path: string) => void;
  onPatchTask: (path: string, updates: TaskMetadataUpdates) => Promise<void>;
}) {
  return (
    <article className="time-day-column">
      <header>
        <strong>{day.date}</strong>
        <span>{minutesLabel(day.total_minutes)}</span>
      </header>
      <div className="time-block-list compact">
        {day.blocks.length === 0 ? <p className="muted">No allocation.</p> : day.blocks.map((block) => (
          <TimeBlockButton key={`${block.path}:${block.start}`} block={block} onOpen={onOpen} onPatchTask={onPatchTask} compact />
        ))}
      </div>
    </article>
  );
}

function TimeBlockButton({
  block,
  onOpen,
  onPatchTask,
  compact = false,
}: {
  block: TimePlanBlock;
  onOpen: (path: string) => void;
  onPatchTask: (path: string, updates: TaskMetadataUpdates) => Promise<void>;
  compact?: boolean;
}) {
  const segment = segmentLabel(block);
  const calendarBlock = block.kind === 'calendar' || block.readonly;
  const mainContent = (
    <>
      <span className="time-range">{block.start}-{block.end}</span>
      <span className="duration-chip">{minutesLabel(block.minutes)}</span>
      <span className="reason-chip">{block.allDay ? 'all day' : block.reason}</span>
      {block.urgent && !calendarBlock && <span className="urgent-chip">urgent</span>}
      <span className={`category-chip category-${timeCategory(block)}`}>{categoryLabel(block)}</span>
      {!calendarBlock && <span className={`deadline-chip ${deadlineType(block)}`}>{deadlineType(block)}</span>}
      {segment && !calendarBlock && <span className="segment-chip">{segment}</span>}
      <strong>{block.title}</strong>
      <span className="time-meta">
        {calendarBlock
          ? `${block.sourceLabel || block.project || 'Calendar'} · ${block.blocking === false ? 'agenda only' : 'blocks tasks'}`
          : `${block.project || 'no project'} · P${block.priority || '-'} · ${deadlineType(block)} deadline · ${block.due || 'no date'}`}
      </span>
      {!compact && !calendarBlock && block.next && <em>{block.next}</em>}
    </>
  );
  return (
    <article
      className={`time-block duration-${durationClass(block.minutes)} ${calendarBlock ? 'calendar-block' : ''} ${compact ? 'compact' : ''}`}
      style={blockDurationStyle(block.minutes, compact)}
      aria-label={`${calendarBlock ? 'Calendar block' : 'Scheduled block'} ${block.title}`}
    >
      {calendarBlock ? (
        <div className="time-block-main readonly">{mainContent}</div>
      ) : (
        <button className="time-block-main" onClick={() => onOpen(block.path)}>
          {mainContent}
        </button>
      )}
      {!calendarBlock && (
        <TimeBlockToolsDisclosure task={block} onPatchTask={onPatchTask} compact={compact} />
      )}
    </article>
  );
}

function OverflowList({
  title,
  tasks,
  onOpen,
  onPatchTask,
}: {
  title: string;
  tasks: TimePlanTask[];
  onOpen: (path: string) => void;
  onPatchTask: (path: string, updates: TaskMetadataUpdates) => Promise<void>;
}) {
  return (
    <div className="overflow-list">
      <h3>{title}</h3>
      {tasks.length === 0 ? <p className="muted">No overflow.</p> : tasks.slice(0, 30).map((task) => (
        <article className="overflow-task managed-overflow-task" key={`${title}:${task.path}`}>
          <button className="overflow-task-main" onClick={() => onOpen(task.path)}>
            <strong>{task.title}</strong>
            <span>{task.project || 'no project'} · P{task.priority || '-'} · {task.due || 'no date'} · {minutesLabel(estimateMinutes(task))}</span>
            <span className="reason-chip">{task.reason}</span>
            {task.urgent && <span className="urgent-chip">urgent</span>}
            <span className={`category-chip category-${timeCategory(task)}`}>{categoryLabel(task)}</span>
            <span className={`deadline-chip ${deadlineType(task)}`}>{deadlineType(task)}</span>
          </button>
          <TimeBlockToolsDisclosure task={task} onPatchTask={onPatchTask} />
        </article>
      ))}
    </div>
  );
}

function TimeBlockToolsDisclosure({
  task,
  onPatchTask,
  compact = false,
}: {
  task: TimePlanTask;
  onPatchTask: (path: string, updates: TaskMetadataUpdates) => Promise<void>;
  compact?: boolean;
}) {
  return (
    <details className={`time-block-tools-disclosure ${compact ? 'compact' : ''}`}>
      <summary aria-label={`Edit scheduling controls for ${task.title}`}>Edit</summary>
      <div className="time-block-tools">
        <DurationEditor task={task} onPatchTask={onPatchTask} compact={compact} />
        <TimePlanTaskActions task={task} onPatchTask={onPatchTask} compact={compact} />
      </div>
    </details>
  );
}

function DurationEditor({
  task,
  onPatchTask,
  compact = false,
}: {
  task: TimePlanTask;
  onPatchTask: (path: string, updates: TaskMetadataUpdates) => Promise<void>;
  compact?: boolean;
}) {
  const currentMinutes = estimateMinutes(task);
  const [draft, setDraft] = useState(String(currentMinutes));
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setDraft(String(currentMinutes));
    setDirty(false);
  }, [currentMinutes, task.path]);

  const saveDuration = (minutes: number) => {
    const normalized = normalizeDurationMinutes(minutes);
    setDraft(String(normalized));
    setDirty(false);
    void onPatchTask(task.path, { estimate_minutes: normalized });
  };

  const saveDraft = () => {
    if (!dirty) return;
    saveDuration(Number(draft));
  };

  return (
    <div className={`duration-editor ${compact ? 'compact' : ''}`} aria-label={`Duration for ${task.title}`}>
      <div className="duration-presets" aria-label={`Duration presets for ${task.title}`}>
        {DURATION_PRESETS.map((preset) => (
          <button
            key={preset.label}
            type="button"
            className={normalizeDurationMinutes(currentMinutes) === preset.minutes ? 'active' : ''}
            onClick={() => saveDuration(preset.minutes)}
            aria-label={`Set ${task.title} duration to ${preset.label} ${minutesLabel(preset.minutes)}`}
            title={`${preset.label} ${minutesLabel(preset.minutes)}`}
          >
            {preset.label}
          </button>
        ))}
      </div>
      <label className="duration-custom">
        <span>Min</span>
        <input
          aria-label={`${task.title} duration minutes`}
          type="number"
          min={15}
          max={1440}
          step={15}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            setDirty(true);
          }}
          onBlur={saveDraft}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.currentTarget.blur();
            }
          }}
        />
      </label>
    </div>
  );
}

function TimePlanTaskActions({
  task,
  onPatchTask,
  compact = false,
}: {
  task: TimePlanTask;
  onPatchTask: (path: string, updates: TaskMetadataUpdates) => Promise<void>;
  compact?: boolean;
}) {
  const patch = (updates: TaskMetadataUpdates) => {
    void onPatchTask(task.path, updates);
  };
  const category = String(task.time_category || '');
  const schedulePolicy = String(task.schedule_policy || '');
  return (
    <div className={`time-task-actions ${compact ? 'compact' : ''}`} aria-label={`Task actions for ${task.title}`}>
      <label>
        <span>Category</span>
        <select
          aria-label={`${task.title} time category`}
          value={category}
          onChange={(event) => patch({ time_category: event.target.value })}
        >
          {TIME_CATEGORY_OPTIONS.map((option) => (
            <option key={option.value || 'auto-category'} value={option.value}>{option.label}</option>
          ))}
        </select>
      </label>
      <label>
        <span>Policy</span>
        <select
          aria-label={`${task.title} schedule policy`}
          value={schedulePolicy}
          onChange={(event) => patch({ schedule_policy: event.target.value })}
        >
          {SCHEDULE_POLICY_OPTIONS.map((option) => (
            <option key={option.value || 'auto-policy'} value={option.value}>{option.label}</option>
          ))}
        </select>
      </label>
      <label className="time-task-action-check">
        <span>Focus</span>
        <input
          aria-label={`${task.title} manual focus`}
          type="checkbox"
          checked={metadataTruthy(task.focus_manual)}
          onChange={(event) => patch({ focus_manual: event.target.checked })}
        />
      </label>
      <button type="button" onClick={() => patch({ status: 'active' })}>Active</button>
      <button type="button" onClick={() => patch({ status: 'waiting' })}>Wait</button>
      <button type="button" onClick={() => patch({ status: 'done' })}>Done</button>
    </div>
  );
}
