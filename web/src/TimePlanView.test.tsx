import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getTimePlan, getTimePlanAgentContext } from './api';
import { TimePlanView, visibleTimePlan } from './TimePlanView';
import type { TimePlanAgentContext, TimePlanResponse } from './types';

vi.mock('./api', () => ({
  getTimePlan: vi.fn(),
  getTimePlanAgentContext: vi.fn(),
}));

const plan: TimePlanResponse = {
  settings: {
    date: '2026-05-06',
    week_start: '2026-05-06',
    start: '09:00',
    capacity_minutes: 420,
    weekdays: 5,
    horizon_days: 14,
  },
  daily: {
    date: '2026-05-06',
    total_minutes: 120,
    blocks: [
      {
        path: 'tasks/active/t-daily.md',
        title: 'Daily task',
        project: 'alpha',
        domain: 'research',
        time_category: 'research',
        priority: '1',
        status: 'open',
        due: '2026-05-06',
        next: 'Do the daily task',
        start: '09:00',
        end: '10:00',
        minutes: 60,
        reason: 'due today',
        private: false,
      },
      {
        path: 'tasks/active/t-private.md',
        title: 'Private task',
        project: 'alpha',
        domain: 'admin',
        time_category: 'admin',
        priority: '1',
        status: 'open',
        due: '2026-05-06',
        next: 'Private next',
        start: '10:00',
        end: '11:00',
        minutes: 60,
        reason: 'priority 1',
        private: true,
      },
    ],
  },
  daily_overflow: [
    {
      path: 'tasks/active/t-overflow.md',
      title: 'Overflow task',
      project: 'alpha',
      domain: 'admin',
      time_category: 'admin',
      priority: '2',
      status: 'open',
      due: '2026-05-10',
      next: 'Do overflow',
      minutes: 60,
      reason: 'admin cap',
      private: false,
    },
  ],
  weekly: [
    {
      date: '2026-05-06',
      total_minutes: 60,
      blocks: [
        {
          path: 'tasks/active/t-daily.md',
          title: 'Daily task',
          project: 'alpha',
          domain: 'research',
          time_category: 'research',
          priority: '1',
          status: 'open',
          due: '2026-05-06',
          next: 'Do the daily task',
          start: '09:00',
          end: '10:00',
          minutes: 60,
          reason: 'due today',
          private: false,
        },
      ],
    },
  ],
  weekly_overflow: [],
};

const agentContext: TimePlanAgentContext = {
  settings: { ...plan.settings, include_private: false },
  ad_hoc: '',
  preferences: {
    path: 'settings/time_planning.md',
    exists: true,
    private: true,
    summary: 'Protect morning deep work.',
    content: '# Preferences\n\n- Protect morning deep work.',
  },
  deterministic_plan: plan,
  pressing_tasks: [plan.daily.blocks[0]],
  pressing_projects: [
    {
      path: 'projects/alpha/README.md',
      title: 'Alpha',
      id: 'alpha',
      status: 'active',
      priority: '1',
      deadline: '2026-05-20',
      days_until_deadline: 14,
      next: 'Review plan',
      open_task_count: 1,
      private: false,
    },
  ],
  agent_prompt: '# Codex Agent Planning Brief\n\nProtect morning deep work.\n',
};

function mockApis() {
  vi.mocked(getTimePlan).mockResolvedValue(plan);
  vi.mocked(getTimePlanAgentContext).mockResolvedValue(agentContext);
}

function waitPastFetchDebounce() {
  return new Promise((resolve) => setTimeout(resolve, 320));
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('TimePlanView', () => {
  it('renders daily and weekly blocks from the API and opens clicked tasks', async () => {
    mockApis();
    const onOpen = vi.fn();

    render(<TimePlanView privateMode={false} onOpen={onOpen} />);

    expect(await screen.findByRole('heading', { name: 'Time Plan' })).toBeVisible();
    expect(await screen.findByRole('heading', { name: 'Agent Brief' })).toBeVisible();
    expect(getTimePlanAgentContext).not.toHaveBeenCalled();
    expect((await screen.findAllByText('Daily task'))[0]).toBeVisible();
    expect(screen.getByLabelText('Time plan daily summary')).toBeVisible();
    expect(screen.getByText('Research anchor')).toBeVisible();
    expect(screen.getByText('Admin edge')).toBeVisible();
    expect(screen.getByText('Meetings')).toBeVisible();
    expect(screen.getByText('No blocking meeting imported')).toBeVisible();
    expect(screen.getByText('1 items')).toBeVisible();
    expect(screen.getByLabelText('Toggle weekly plan')).toBeVisible();
    expect(screen.getByLabelText('Toggle overflow plan')).toBeVisible();
    expect(screen.getByText('Not scheduled today')).not.toBeVisible();
    expect(screen.getByText('Ad hoc constraints')).not.toBeVisible();
    fireEvent.click(screen.getByLabelText('Toggle overflow plan'));
    expect(screen.getByText('Not scheduled today')).toBeVisible();
    expect(screen.getAllByText('Overflow task').some((node) => {
      try {
        expect(node).toBeVisible();
        return true;
      } catch {
        return false;
      }
    })).toBe(true);
    expect(screen.getByText('Research fills the main day; admin is batched at a day edge, usually late PM, capped at 90m.')).toBeVisible();
    expect(screen.getByLabelText('Toggle time plan settings')).toBeVisible();
    expect(screen.getByLabelText('Time plan controls')).not.toBeVisible();
    expect(screen.getByRole('heading', { name: 'Why this plan' })).toBeVisible();
    fireEvent.click(screen.getByLabelText('Toggle time plan rationale'));
    expect(screen.getByText('Scheduled today')).toBeVisible();
    expect(screen.getAllByText(/Daily task/).length).toBeGreaterThan(1);
    expect(screen.getAllByText(/due today/).length).toBeGreaterThan(1);
    expect(screen.getByText('Overflow today')).toBeVisible();
    expect(screen.getAllByText(/admin cap/).length).toBeGreaterThan(1);
    expect(screen.getAllByText('Research').some((node) => {
      try {
        expect(node).toBeVisible();
        return true;
      } catch {
        return false;
      }
    })).toBe(true);
    expect(screen.getAllByText('Admin').some((node) => {
      try {
        expect(node).toBeVisible();
        return true;
      } catch {
        return false;
      }
    })).toBe(true);
    expect(screen.getByText('admin cap')).toBeVisible();
    fireEvent.click(screen.getAllByRole('button', { name: /Daily task/ })[0]);
    expect(onOpen).toHaveBeenCalledWith('tasks/active/t-daily.md');
  });

  it('renders calendar meetings as read-only fixed blocks', async () => {
    const calendarPlan: TimePlanResponse = {
      ...plan,
      calendar: {
        enabled: true,
        last_fetch: '2026-05-11T08:00:00-04:00',
        event_count: 1,
        source_labels: ['Work'],
        errors: [],
      },
      daily: {
        ...plan.daily,
        blocks: [
          {
            kind: 'calendar',
            path: 'calendar:work:meeting-1',
            title: 'Shipping Concentration',
            project: 'Work',
            domain: 'calendar',
            time_category: 'calendar',
            priority: '',
            status: 'busy',
            due: '2026-05-06',
            next: '',
            start: '09:00',
            end: '10:00',
            minutes: 60,
            reason: 'work meeting',
            readonly: true,
            sourceLabel: 'Work',
            allDay: false,
            blocking: true,
            private: false,
          },
          plan.daily.blocks[0],
        ],
      },
      weekly: [],
      daily_overflow: [],
      weekly_overflow: [],
    };
    vi.mocked(getTimePlan).mockResolvedValue(calendarPlan);
    vi.mocked(getTimePlanAgentContext).mockResolvedValue({
      ...agentContext,
      calendar: calendarPlan.calendar,
      deterministic_plan: calendarPlan,
    });
    const onOpen = vi.fn();

    render(<TimePlanView privateMode={false} onOpen={onOpen} />);

    expect(await screen.findByLabelText('Calendar block Shipping Concentration')).toBeVisible();
    expect(screen.getByText('Calendar/date blocks scheduling · 1 events · Work')).toBeVisible();
    expect(screen.getAllByText('Meeting').length).toBeGreaterThan(0);
    expect(screen.getByText('Work · blocks tasks')).toBeVisible();
    expect(screen.queryByLabelText('Shipping Concentration duration minutes')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Task actions for Shipping Concentration')).not.toBeInTheDocument();
  });

  it('debounces repeated control changes before refetching', async () => {
    mockApis();

    render(<TimePlanView privateMode={false} onOpen={vi.fn()} />);

    await screen.findAllByText('Daily task');
    vi.mocked(getTimePlan).mockClear();
    fireEvent.click(screen.getByLabelText('Toggle time plan settings'));
    fireEvent.change(screen.getByLabelText('Capacity'), { target: { value: '120' } });
    fireEvent.change(screen.getByLabelText('Capacity'), { target: { value: '135' } });

    expect(getTimePlan).not.toHaveBeenCalled();

    await waitFor(() => {
      expect(getTimePlan).toHaveBeenCalledTimes(1);
    });
    expect(vi.mocked(getTimePlan).mock.calls.at(-1)?.[0]).toMatchObject({ capacityMinutes: 135 });
    expect(getTimePlanAgentContext).not.toHaveBeenCalled();
  });

  it('uses the agent-context response as the plan while the agent brief is open', async () => {
    mockApis();

    render(<TimePlanView privateMode={false} onOpen={vi.fn()} />);

    await screen.findAllByText('Daily task');
    const initialPlanCalls = vi.mocked(getTimePlan).mock.calls.length;
    fireEvent.click(screen.getByRole('heading', { name: 'Agent Brief' }));

    await waitFor(() => expect(getTimePlanAgentContext).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByLabelText('Toggle time plan settings'));
    fireEvent.change(screen.getByLabelText('Capacity'), { target: { value: '120' } });

    await waitFor(() => {
      expect(vi.mocked(getTimePlanAgentContext).mock.calls.at(-1)?.[0]).toMatchObject({ capacityMinutes: 120 });
    });
    expect(vi.mocked(getTimePlan).mock.calls.length).toBe(initialPlanCalls);
  });

  it('shares cached agent-context plans with the daily plan and reuses identical agent briefs', async () => {
    mockApis();

    render(<TimePlanView privateMode={false} onOpen={vi.fn()} />);

    await screen.findAllByText('Daily task');
    fireEvent.click(screen.getByRole('heading', { name: 'Agent Brief' }));
    await waitFor(() => expect(getTimePlanAgentContext).toHaveBeenCalledTimes(1));

    vi.mocked(getTimePlan).mockClear();
    vi.mocked(getTimePlanAgentContext).mockClear();

    fireEvent.click(screen.getByRole('heading', { name: 'Agent Brief' }));
    await waitPastFetchDebounce();
    expect(getTimePlan).not.toHaveBeenCalled();
    expect(getTimePlanAgentContext).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('heading', { name: 'Agent Brief' }));
    await waitPastFetchDebounce();
    expect(getTimePlan).not.toHaveBeenCalled();
    expect(getTimePlanAgentContext).not.toHaveBeenCalled();
  });

  it('updates and copies the Codex agent brief', async () => {
    mockApis();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    render(<TimePlanView privateMode={true} onOpen={vi.fn()} />);

    fireEvent.click(await screen.findByRole('heading', { name: 'Agent Brief' }));
    fireEvent.change(screen.getByLabelText('Ad hoc planning constraints'), { target: { value: 'Low energy today.' } });

    await waitFor(() => {
      expect(vi.mocked(getTimePlanAgentContext).mock.calls.at(-1)?.[0]).toMatchObject({
        adHoc: 'Low energy today.',
        includePrivate: false,
      });
    });

    fireEvent.click(screen.getByRole('button', { name: /Copy Codex Brief/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(agentContext.agent_prompt));
  });

  it('hides private blocks when private mode is enabled', () => {
    const visible = visibleTimePlan(plan, true);

    expect(visible.daily.blocks.map((block) => block.title)).toEqual(['Daily task']);
    expect(visible.daily.total_minutes).toBe(60);
  });

  it('renders multi-hour blocks with proportional sizing and segment labels', async () => {
    const durationPlan: TimePlanResponse = {
      ...plan,
      daily: {
        ...plan.daily,
        total_minutes: 180,
        blocks: [
          {
            ...plan.daily.blocks[0],
            path: 'tasks/active/t-research.md',
            title: 'Research sprint',
            start: '09:00',
            end: '12:00',
            minutes: 180,
            estimate_minutes: 240,
            segment_index: 1,
            segment_count: 2,
          },
        ],
      },
      daily_overflow: [],
      weekly: [],
    };
    vi.mocked(getTimePlan).mockResolvedValue(durationPlan);
    vi.mocked(getTimePlanAgentContext).mockResolvedValue({
      ...agentContext,
      deterministic_plan: durationPlan,
      pressing_tasks: durationPlan.daily.blocks,
    });

    render(<TimePlanView privateMode={false} onOpen={vi.fn()} />);

    const block = await screen.findByLabelText('Scheduled block Research sprint');
    expect(block).toHaveClass('duration-deep');
    expect(block).toHaveStyle('--time-block-min-height: 189px');
    expect(screen.getAllByText('3h')[0]).toBeVisible();
    expect(screen.getByText('segment 1/2')).toBeVisible();
    fireEvent.click(screen.getByLabelText('Edit scheduling controls for Research sprint'));
    expect(screen.getByLabelText('Research sprint duration minutes')).toHaveValue(240);
  });

  it('persists preset duration edits and refreshes the plan', async () => {
    mockApis();
    const onPatchTaskMetadata = vi.fn().mockResolvedValue(undefined);

    render(<TimePlanView privateMode={false} onOpen={vi.fn()} onPatchTaskMetadata={onPatchTaskMetadata} />);

    const editButtons = await screen.findAllByLabelText('Edit scheduling controls for Daily task');
    fireEvent.click(editButtons[0]);
    const presetButtons = await screen.findAllByLabelText('Set Daily task duration to L 2h');
    const initialPlanCalls = vi.mocked(getTimePlan).mock.calls.length;
    fireEvent.click(presetButtons[0]);

    await waitFor(() => {
      expect(onPatchTaskMetadata).toHaveBeenCalledWith('tasks/active/t-daily.md', { estimate_minutes: 120 });
    });
    await waitFor(() => {
      expect(vi.mocked(getTimePlan).mock.calls.length).toBeGreaterThan(initialPlanCalls);
    });
  });

  it('persists explicit scheduling heuristic overrides', async () => {
    mockApis();
    const onPatchTaskMetadata = vi.fn().mockResolvedValue(undefined);

    render(<TimePlanView privateMode={false} onOpen={vi.fn()} onPatchTaskMetadata={onPatchTaskMetadata} />);

    const editButtons = await screen.findAllByLabelText('Edit scheduling controls for Daily task');
    fireEvent.click(editButtons[0]);

    fireEvent.change(screen.getAllByLabelText('Daily task time category')[0], { target: { value: 'admin' } });
    fireEvent.change(screen.getAllByLabelText('Daily task schedule policy')[0], { target: { value: 'research-anchor' } });
    fireEvent.click(screen.getAllByLabelText('Daily task manual focus')[0]);

    await waitFor(() => {
      expect(onPatchTaskMetadata).toHaveBeenCalledWith('tasks/active/t-daily.md', { time_category: 'admin' });
    });
    expect(onPatchTaskMetadata).toHaveBeenCalledWith('tasks/active/t-daily.md', { schedule_policy: 'research-anchor' });
    expect(onPatchTaskMetadata).toHaveBeenCalledWith('tasks/active/t-daily.md', { focus_manual: true });
  });

  it('persists custom duration edits in 15-minute increments', async () => {
    mockApis();
    const onPatchTaskMetadata = vi.fn().mockResolvedValue(undefined);

    render(<TimePlanView privateMode={false} onOpen={vi.fn()} onPatchTaskMetadata={onPatchTaskMetadata} />);

    fireEvent.click(await screen.findByLabelText('Edit scheduling controls for Overflow task'));
    const input = await screen.findByLabelText('Overflow task duration minutes');
    fireEvent.change(input, { target: { value: '135' } });
    fireEvent.blur(input);

    await waitFor(() => {
      expect(onPatchTaskMetadata).toHaveBeenCalledWith('tasks/active/t-overflow.md', { estimate_minutes: 135 });
    });
  });

  it('does not rewrite unchanged custom durations on blur', async () => {
    mockApis();
    const onPatchTaskMetadata = vi.fn().mockResolvedValue(undefined);

    render(<TimePlanView privateMode={false} onOpen={vi.fn()} onPatchTaskMetadata={onPatchTaskMetadata} />);

    fireEvent.click(await screen.findByLabelText('Edit scheduling controls for Overflow task'));
    const input = await screen.findByLabelText('Overflow task duration minutes');
    fireEvent.blur(input);

    expect(onPatchTaskMetadata).not.toHaveBeenCalled();
  });
});
