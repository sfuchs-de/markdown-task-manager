from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any


DONE_STATUSES = {
    "done",
    "complete",
    "completed",
    "cancelled",
    "canceled",
    "archive",
    "archived",
}

UNSCHEDULABLE_STATUSES = {
    "waiting",
    "blocked",
    "pending",
    "follow-up",
    "followup",
}

ADMIN_BATCH_MAX_MINUTES = 90
SOFT_DEADLINE_HORIZON_DAYS = 3
SOFT_OVERDUE_ESCALATION_DAYS = 7


@dataclass(frozen=True)
class ScheduledTask:
    task: dict[str, Any]
    day: date
    start: str
    end: str
    minutes: int
    reason: str
    segment_index: int = 1
    segment_count: int = 1


def parse_date(value: Any) -> date | None:
    if value is None or not str(value).strip():
        return None
    try:
        return date.fromisoformat(str(value))
    except Exception:
        return None


def parse_minutes(value: Any, default: int = 60) -> int:
    try:
        minutes = int(value)
    except Exception:
        return default
    return minutes if minutes > 0 else default


def parse_clock(value: str) -> int:
    raw = value.strip()
    hour, minute = raw.split(":", 1)
    return int(hour) * 60 + int(minute)


def format_clock(minutes: int) -> str:
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def priority_value(task: dict[str, Any]) -> int:
    try:
        return int(task.get("priority", 9))
    except Exception:
        return 9


def is_open_task(task: dict[str, Any]) -> bool:
    status = str(task.get("status", "open")).strip().lower()
    return status not in DONE_STATUSES


def is_deferred_task(task: dict[str, Any]) -> bool:
    status = str(task.get("status", "open")).strip().lower()
    path = str(task.get("path", "")).lower()
    return status in {"someday", "later", "parked", "paused"} or "/someday/" in path or priority_value(task) >= 4


def is_schedulable_task(task: dict[str, Any], target_day: date) -> bool:
    if not is_open_task(task):
        return False
    if str(task.get("block_day", "")) == target_day.isoformat():
        return True
    status = str(task.get("status", "open")).strip().lower()
    policy = normalized_schedule_policy(task)
    policy_schedules = policy in {"schedule-today", "today", "research-anchor", "anchor", "admin-edge", "admin-batch", "edge"}
    if is_deferred_task(task) and not is_manual_urgent(task) and not policy_schedules:
        return False
    return status not in UNSCHEDULABLE_STATUSES


def task_identity(task: dict[str, Any]) -> str:
    return str(task.get("path") or task.get("id") or task.get("title") or id(task))


def is_calendar_event(task: dict[str, Any]) -> bool:
    return str(task.get("kind") or "") == "calendar"


def urgent_status(task: dict[str, Any]) -> bool:
    status = str(task.get("status", "")).lower()
    project = str(task.get("project", "")).lower()
    return "urgent" in status or "urgent" in project


def is_manual_urgent(task: dict[str, Any]) -> bool:
    values = (task.get("urgent"), task.get("focus_manual"))
    if any(value is True for value in values):
        return True
    if any(str(value or "").strip().lower() in {"true", "1", "yes", "urgent", "focus"} for value in values):
        return True
    return focus_rank_value(task) is not None


def focus_rank_value(task: dict[str, Any]) -> int | None:
    value = task.get("focus_rank")
    if value in (None, ""):
        return None
    try:
        return int(value)
    except Exception:
        return None


def deadline_type(task: dict[str, Any]) -> str:
    normalized = str(task.get("deadline_type") or "").strip().lower()
    return normalized if normalized in {"hard", "soft"} else "soft"


def is_soft_deadline(task: dict[str, Any]) -> bool:
    return deadline_type(task) == "soft"


def normalized_category(value: Any) -> str:
    return str(value or "").strip().lower().replace("_", "-")


def normalized_schedule_policy(task: dict[str, Any]) -> str:
    return normalized_category(task.get("schedule_policy"))


def task_time_category(task: dict[str, Any]) -> str:
    explicit = normalized_category(task.get("time_category"))
    if explicit in {"research", "admin", "other"}:
        return explicit
    policy = normalized_schedule_policy(task)
    if policy in {"research-anchor", "anchor"}:
        return "research"
    if policy in {"admin-edge", "admin-batch", "edge"}:
        return "admin"
    raw = normalized_category(task.get("domain") or task.get("area"))
    if raw == "research":
        return "research"
    if raw == "admin":
        return "admin"
    if raw in {"other", "personal", "life-admin", "service", "teaching", "data", "system", "archive"}:
        return "other"
    # Preserve legacy/test payload behavior until the API enriches real tasks.
    return "research"


def is_research_task(task: dict[str, Any]) -> bool:
    if is_calendar_event(task):
        return False
    return task_time_category(task) == "research"


def is_admin_like_task(task: dict[str, Any]) -> bool:
    if is_calendar_event(task):
        return False
    return not is_research_task(task)


def is_manual_day_task(task: dict[str, Any], target_day: date) -> bool:
    return str(task.get("block_day", "")) == target_day.isoformat()


def is_due_urgent_admin(task: dict[str, Any], target_day: date) -> bool:
    due = parse_date(task.get("due"))
    return is_manual_urgent(task) or priority_value(task) <= 1 or (due is not None and due <= target_day)


def with_overflow_reason(task: dict[str, Any], reason: str) -> dict[str, Any]:
    return {**task, "_overflow_reason": reason}


def largest_research_block_minutes(scheduled: list[ScheduledTask]) -> int:
    return max((item.minutes for item in scheduled if is_research_task(item.task)), default=0)


def admin_like_task_count(scheduled: list[ScheduledTask]) -> int:
    return len({task_identity(item.task) for item in scheduled if is_admin_like_task(item.task)})


def admin_like_scheduled_minutes(scheduled: list[ScheduledTask]) -> int:
    return sum(item.minutes for item in scheduled if is_admin_like_task(item.task))


def should_defer_admin_like_task(
    task: dict[str, Any],
    scheduled: list[ScheduledTask],
    target_day: date,
    has_research_candidate: bool,
    pending_admin_count: int = 0,
    pending_admin_minutes: int = 0,
) -> str | None:
    if not is_admin_like_task(task) or is_manual_day_task(task, target_day):
        return None
    if is_manual_urgent(task):
        return None
    largest_research = largest_research_block_minutes(scheduled)
    if has_research_candidate and largest_research <= 0:
        return "no research block fits"
    if largest_research > 0 and task_minutes(task) >= largest_research:
        return "research anchor protected"
    admin_count = admin_like_task_count(scheduled) + pending_admin_count
    if admin_count >= 2:
        return "admin cap"
    if admin_count >= 1 and not is_due_urgent_admin(task, target_day):
        return "admin cap"
    admin_minutes = admin_like_scheduled_minutes(scheduled) + pending_admin_minutes
    if admin_minutes + task_minutes(task) > ADMIN_BATCH_MAX_MINUTES:
        return "admin batch cap"
    return None


def task_reason(task: dict[str, Any], target_day: date, week_prefix: str | None = None) -> str:
    if task.get("_overflow_reason"):
        return str(task["_overflow_reason"])
    target = target_day.isoformat()
    due = parse_date(task.get("due"))
    priority = priority_value(task)
    soft = is_soft_deadline(task)
    rank = focus_rank_value(task)
    policy = normalized_schedule_policy(task)
    if rank is not None:
        return f"focus #{rank}"
    if is_manual_urgent(task):
        return "manual urgent"
    if str(task.get("block_day", "")) == target:
        return "manual day"
    if week_prefix and str(task.get("block_week", "")) == week_prefix:
        return "manual week"
    if policy in {"schedule-today", "today"}:
        return "policy: today"
    if policy in {"research-anchor", "anchor"}:
        return "policy: research anchor"
    if policy in {"admin-edge", "admin-batch", "edge"}:
        return "policy: admin edge"
    if soft and due is not None and due < target_day:
        return "soft target overdue"
    if soft and due == target_day:
        return "soft target today"
    if soft and due is not None and (due - target_day).days <= SOFT_DEADLINE_HORIZON_DAYS:
        return "soft target"
    if due is not None and due < target_day:
        return "overdue"
    if due == target_day:
        return "due today"
    if due is not None and (due - target_day).days <= 3:
        return "due soon"
    if priority <= 1:
        return "priority 1"
    if due is not None and (due - target_day).days <= 7:
        return "this week"
    if priority <= 2:
        return "priority 2"
    if urgent_status(task):
        return "urgent status"
    return "selected"


def urgency_bucket(task: dict[str, Any], target_day: date, week_prefix: str | None = None) -> tuple[int, int, int, str]:
    target = target_day.isoformat()
    due = parse_date(task.get("due"))
    due_delta = 9999 if due is None else (due - target_day).days
    priority = priority_value(task)
    title = str(task.get("title", ""))
    soft = is_soft_deadline(task)

    focus_rank = focus_rank_value(task)
    policy = normalized_schedule_policy(task)
    if focus_rank is not None:
        bucket = 0
        due_delta = focus_rank
    elif is_manual_urgent(task):
        bucket = 0
    elif str(task.get("block_day", "")) == target:
        bucket = 1
    elif policy in {"schedule-today", "today"}:
        bucket = 1
    elif policy in {"research-anchor", "anchor", "admin-edge", "admin-batch", "edge"}:
        bucket = 5
    elif soft and priority <= 1:
        bucket = 5
    elif soft and priority <= 2:
        bucket = 7
    elif soft and due is not None and due_delta <= -SOFT_OVERDUE_ESCALATION_DAYS:
        bucket = 9
    elif soft and week_prefix and str(task.get("block_week", "")) == week_prefix:
        bucket = 9
    elif soft and urgent_status(task):
        bucket = 9
    elif soft and due is not None and due_delta <= SOFT_DEADLINE_HORIZON_DAYS:
        bucket = 10
    elif soft:
        bucket = 11
    elif due is not None and due < target_day:
        bucket = 2
    elif due == target_day:
        bucket = 3
    elif due is not None and due_delta <= 3:
        bucket = 4
    elif priority <= 1:
        bucket = 5
    elif due is not None and due_delta <= 7:
        bucket = 6
    elif priority <= 2:
        bucket = 7
    elif week_prefix and str(task.get("block_week", "")) == week_prefix:
        bucket = 8
    elif urgent_status(task):
        bucket = 9
    elif due is not None and due_delta <= 14:
        bucket = 10
    else:
        bucket = 11
    return (bucket, due_delta, priority, title)


def should_auto_schedule(task: dict[str, Any], target_day: date, horizon_days: int, week_prefix: str | None = None) -> bool:
    if not is_open_task(task):
        return False
    policy = normalized_schedule_policy(task)
    if str(task.get("block_day", "")) == target_day.isoformat():
        return True
    if not is_schedulable_task(task, target_day):
        return False
    if week_prefix and str(task.get("block_week", "")) == week_prefix:
        return True
    if policy in {"defer", "deferred", "park", "parked"} and not is_manual_urgent(task):
        return False
    if policy in {"schedule-today", "today", "research-anchor", "anchor", "admin-edge", "admin-batch", "edge"}:
        return True
    if is_deferred_task(task) and not is_manual_urgent(task):
        return False
    due = parse_date(task.get("due"))
    due_horizon = min(horizon_days, SOFT_DEADLINE_HORIZON_DAYS) if is_soft_deadline(task) else horizon_days
    if due is not None and (due - target_day).days <= due_horizon:
        return True
    return priority_value(task) <= 2 or is_manual_urgent(task) or urgent_status(task)


def ranked_candidates(
    tasks: list[dict[str, Any]],
    target_day: date,
    *,
    horizon_days: int = 14,
    week_prefix: str | None = None,
) -> list[dict[str, Any]]:
    candidates = [task for task in tasks if should_auto_schedule(task, target_day, horizon_days, week_prefix)]
    return sorted(candidates, key=lambda task: urgency_bucket(task, target_day, week_prefix))


def non_working_overflow(tasks: list[dict[str, Any]], target_day: date, horizon_days: int, week_prefix: str | None) -> list[dict[str, Any]]:
    return [
        {**task, "_overflow_reason": "non-working day"}
        for task in ranked_candidates(tasks, target_day, horizon_days=horizon_days, week_prefix=week_prefix)
    ]


def task_minutes(task: dict[str, Any]) -> int:
    return parse_minutes(task.get("estimate_minutes", task.get("duration_minutes")), 60)


def work_windows(
    *,
    start: str = "09:00",
    capacity_minutes: int = 420,
    lunch_start: str | None = "12:00",
    lunch_end: str | None = "13:00",
) -> list[tuple[int, int]]:
    cursor = parse_clock(start)
    remaining = max(0, capacity_minutes)
    windows: list[tuple[int, int]] = []
    lunch_start_minutes = parse_clock(lunch_start) if lunch_start else None
    lunch_end_minutes = parse_clock(lunch_end) if lunch_end else None

    while remaining > 0:
        if lunch_start_minutes is not None and lunch_end_minutes is not None:
            if lunch_start_minutes <= cursor < lunch_end_minutes:
                cursor = lunch_end_minutes
                continue
            if cursor < lunch_start_minutes:
                end = min(lunch_start_minutes, cursor + remaining)
                if end > cursor:
                    windows.append((cursor, end))
                    remaining -= end - cursor
                cursor = lunch_end_minutes if end == lunch_start_minutes else end
                continue

        end = cursor + remaining
        if end > cursor:
            windows.append((cursor, end))
        remaining = 0

    return windows


def available_minutes(windows: list[tuple[int, int]]) -> int:
    return sum(max(0, end - start) for start, end in windows)


def subtract_interval_from_windows(windows: list[tuple[int, int]], busy_start: int, busy_end: int) -> list[tuple[int, int]]:
    if busy_end <= busy_start:
        return windows
    updated: list[tuple[int, int]] = []
    for start_minute, end_minute in windows:
        if busy_end <= start_minute or busy_start >= end_minute:
            updated.append((start_minute, end_minute))
            continue
        if start_minute < busy_start:
            updated.append((start_minute, min(busy_start, end_minute)))
        if busy_end < end_minute:
            updated.append((max(busy_end, start_minute), end_minute))
    return [(start_minute, end_minute) for start_minute, end_minute in updated if end_minute > start_minute]


def reserve_calendar_events(
    windows: list[tuple[int, int]],
    calendar_events: list[dict[str, Any]] | None,
    target_day: date,
) -> tuple[list[ScheduledTask], list[tuple[int, int]], int]:
    if not calendar_events:
        return [], windows, 0
    scheduled: list[ScheduledTask] = []
    remaining_windows = list(windows)
    blocked_minutes = 0
    work_start = min((start_minute for start_minute, _ in windows), default=parse_clock("09:00"))
    work_end = max((end_minute for _, end_minute in windows), default=work_start)

    for index, event in enumerate(calendar_events):
        if str(event.get("date") or target_day.isoformat()) != target_day.isoformat():
            continue
        all_day = bool(event.get("all_day"))
        if all_day:
            display_start = work_start
            display_end = work_end
            before = available_minutes(remaining_windows)
            for start_minute, end_minute in list(remaining_windows):
                remaining_windows = subtract_interval_from_windows(remaining_windows, start_minute, end_minute)
            blocked = before - available_minutes(remaining_windows)
        else:
            try:
                display_start = parse_clock(str(event.get("start")))
                display_end = parse_clock(str(event.get("end")))
            except Exception:
                continue
            before = available_minutes(remaining_windows)
            remaining_windows = subtract_interval_from_windows(remaining_windows, display_start, display_end)
            blocked = before - available_minutes(remaining_windows)
        if display_end <= display_start:
            continue
        if all_day and blocked <= 0:
            continue
        blocked_minutes += max(0, blocked)
        event_task = {
            "id": event.get("id") or f"calendar-{target_day.isoformat()}-{index}",
            "path": event.get("path") or f"calendar:{target_day.isoformat()}:{index}",
            "title": event.get("title") or "Work meeting",
            "project": event.get("source_label") or "Calendar",
            "domain": "calendar",
            "time_category": "calendar",
            "priority": "",
            "status": "busy",
            "due": target_day.isoformat(),
            "next": "",
            "private": bool(event.get("private")),
            "kind": "calendar",
            "readonly": True,
            "source_label": event.get("source_label") or "Calendar",
            "source_event_id": event.get("source_event_id") or "",
            "all_day": all_day,
            "blocking": blocked > 0 or all_day,
        }
        minutes = available_minutes([(display_start, display_end)]) if not all_day else max(0, blocked)
        scheduled.append(
            ScheduledTask(
                task=event_task,
                day=target_day,
                start=format_clock(display_start),
                end=format_clock(display_end),
                minutes=minutes,
                reason=str(event.get("reason") or ("all-day work event" if all_day else "work meeting")),
            )
        )
    return scheduled, remaining_windows, blocked_minutes


def reserve_segments(windows: list[tuple[int, int]], minutes: int) -> list[tuple[int, int]] | None:
    if minutes > available_minutes(windows):
        return None
    needed = minutes
    segments: list[tuple[int, int]] = []
    for index, (start_minute, end_minute) in enumerate(windows):
        if needed <= 0:
            break
        available = end_minute - start_minute
        if available <= 0:
            continue
        take = min(needed, available)
        segments.append((start_minute, start_minute + take))
        windows[index] = (start_minute + take, end_minute)
        needed -= take
    return segments if needed == 0 else None


def reserve_single_segment_from_end(windows: list[tuple[int, int]], minutes: int) -> tuple[int, int] | None:
    if minutes <= 0:
        return None
    for index in range(len(windows) - 1, -1, -1):
        start_minute, end_minute = windows[index]
        if end_minute - start_minute < minutes:
            continue
        segment = (end_minute - minutes, end_minute)
        replacement: list[tuple[int, int]] = []
        if start_minute < segment[0]:
            replacement.append((start_minute, segment[0]))
        if segment[1] < end_minute:
            replacement.append((segment[1], end_minute))
        windows[index:index + 1] = replacement
        return segment
    return None


def latest_schedulable_day(task: dict[str, Any]) -> date | None:
    due = parse_date(task.get("due"))
    if due is None:
        return None
    if due.weekday() == 5:
        return due - timedelta(days=1)
    if due.weekday() == 6:
        return due - timedelta(days=2)
    return due


def missed_weekend_deadline(task: dict[str, Any], day: date, plan_start: date) -> bool:
    due = parse_date(task.get("due"))
    latest = latest_schedulable_day(task)
    if due is None or latest is None or due.weekday() < 5:
        return False
    return plan_start <= latest < day


def should_consider_for_week(
    task: dict[str, Any],
    workdays: list[date],
    *,
    start_day: date,
    horizon_days: int,
    week_prefix: str | None = None,
) -> bool:
    if not is_open_task(task):
        return False
    if any(str(task.get("block_day", "")) == day.isoformat() for day in workdays):
        return True
    if not is_schedulable_task(task, start_day):
        return False
    if week_prefix and str(task.get("block_week", "")) == week_prefix:
        return True
    if is_deferred_task(task) and not is_manual_urgent(task):
        return False
    due = parse_date(task.get("due"))
    if due is not None and (due - start_day).days <= horizon_days:
        return True
    return priority_value(task) <= 2 or is_manual_urgent(task) or urgent_status(task)


def allocate_daily_plan(
    tasks: list[dict[str, Any]],
    target_day: date,
    *,
    start: str = "09:00",
    capacity_minutes: int = 420,
    horizon_days: int = 14,
    week_prefix: str | None = None,
    lunch_start: str | None = "12:00",
    lunch_end: str | None = "13:00",
    no_work_before: date | None = None,
    calendar_events: list[dict[str, Any]] | None = None,
) -> tuple[list[ScheduledTask], list[dict[str, Any]]]:
    if no_work_before is not None and target_day < no_work_before:
        return [], non_working_overflow(tasks, target_day, horizon_days, week_prefix)

    windows = work_windows(
        start=start,
        capacity_minutes=capacity_minutes,
        lunch_start=lunch_start,
        lunch_end=lunch_end,
    )
    initial_available = available_minutes(windows)
    calendar_blocks, windows, calendar_blocked_minutes = reserve_calendar_events(windows, calendar_events, target_day)
    scheduled: list[ScheduledTask] = list(calendar_blocks)
    overflow: list[dict[str, Any]] = []
    candidates = ranked_candidates(tasks, target_day, horizon_days=horizon_days, week_prefix=week_prefix)
    urgent_candidates = [task for task in candidates if is_manual_urgent(task)]
    manual_candidates = [task for task in candidates if not is_manual_urgent(task) and is_manual_day_task(task, target_day)]
    research_candidates = [task for task in candidates if not is_manual_urgent(task) and not is_manual_day_task(task, target_day) and is_research_task(task)]
    admin_candidates = [task for task in candidates if not is_manual_urgent(task) and not is_manual_day_task(task, target_day) and is_admin_like_task(task)]
    has_research_candidate = bool(research_candidates)
    considered_ids: set[str] = set()

    def consider_task(task: dict[str, Any]) -> None:
        considered_ids.add(task_identity(task))
        if defer_reason := should_defer_admin_like_task(task, scheduled, target_day, has_research_candidate):
            overflow.append(with_overflow_reason(task, defer_reason))
            return
        minutes = task_minutes(task)
        segments = reserve_segments(windows, minutes)
        if segments is None:
            if calendar_blocked_minutes > 0 and minutes <= initial_available:
                overflow.append(with_overflow_reason(task, "calendar conflict"))
            else:
                overflow.append(task)
            return
        segment_count = len(segments)
        for segment_index, (segment_start, segment_end) in enumerate(segments, start=1):
            scheduled.append(
                ScheduledTask(
                    task=task,
                    day=target_day,
                    start=format_clock(segment_start),
                    end=format_clock(segment_end),
                    minutes=segment_end - segment_start,
                    reason=task_reason(task, target_day, week_prefix),
                    segment_index=segment_index,
                    segment_count=segment_count,
                )
            )

    def schedule_admin_batch() -> None:
        selected: list[dict[str, Any]] = []
        selected_minutes = 0
        for task in admin_candidates:
            considered_ids.add(task_identity(task))
            defer_reason = should_defer_admin_like_task(
                task,
                scheduled,
                target_day,
                has_research_candidate,
                pending_admin_count=len(selected),
                pending_admin_minutes=selected_minutes,
            )
            if defer_reason:
                overflow.append(with_overflow_reason(task, defer_reason))
                continue
            selected.append(task)
            selected_minutes += task_minutes(task)
        if not selected:
            return
        segment = reserve_single_segment_from_end(windows, selected_minutes)
        if segment is None:
            reason = "calendar conflict" if calendar_blocked_minutes > 0 and selected_minutes <= initial_available else "admin batch window"
            overflow.extend(with_overflow_reason(task, reason) for task in selected)
            return
        cursor = segment[0]
        for task in selected:
            minutes = task_minutes(task)
            scheduled.append(
                ScheduledTask(
                    task=task,
                    day=target_day,
                    start=format_clock(cursor),
                    end=format_clock(cursor + minutes),
                    minutes=minutes,
                    reason=task_reason(task, target_day, week_prefix),
                )
            )
            cursor += minutes

    for task in urgent_candidates:
        consider_task(task)

    for task in manual_candidates:
        consider_task(task)

    if has_research_candidate and largest_research_block_minutes(scheduled) <= 0:
        for task in research_candidates:
            consider_task(task)
            if largest_research_block_minutes(scheduled) > 0:
                break

    schedule_admin_batch()

    for task in research_candidates:
        if task_identity(task) not in considered_ids:
            consider_task(task)
    scheduled.sort(key=lambda item: (parse_clock(item.start), 0 if is_calendar_event(item.task) else 1, item.task.get("title", "")))
    return scheduled, overflow


def workdays_from(start_day: date, count: int) -> list[date]:
    days: list[date] = []
    current = start_day
    while len(days) < count:
        if current.weekday() < 5:
            days.append(current)
        current += timedelta(days=1)
    return days


def first_planning_day(start_day: date, no_work_before: date | None) -> date:
    if no_work_before is not None and start_day < no_work_before:
        return no_work_before
    return start_day


def allocate_weekly_plan(
    tasks: list[dict[str, Any]],
    start_day: date,
    *,
    start: str = "09:00",
    capacity_minutes: int = 420,
    weekdays: int = 5,
    horizon_days: int = 14,
    week_prefix: str | None = None,
    lunch_start: str | None = "12:00",
    lunch_end: str | None = "13:00",
    no_work_before: date | None = None,
    calendar_events_by_day: dict[date, list[dict[str, Any]]] | None = None,
) -> tuple[dict[date, list[ScheduledTask]], list[dict[str, Any]]]:
    effective_start = first_planning_day(start_day, no_work_before)
    days = workdays_from(effective_start, weekdays)
    remaining_tasks = [task for task in tasks if is_open_task(task)]
    scheduled_by_day: dict[date, list[ScheduledTask]] = {}
    overflow_reasons_by_id: dict[str, str] = {}

    for day in days:
        eligible_tasks = [
            task
            for task in remaining_tasks
            if not missed_weekend_deadline(task, day, start_day)
        ]
        scheduled, _day_overflow = allocate_daily_plan(
            eligible_tasks,
            day,
            start=start,
            capacity_minutes=capacity_minutes,
            horizon_days=horizon_days,
            week_prefix=week_prefix,
            lunch_start=lunch_start,
            lunch_end=lunch_end,
            no_work_before=no_work_before,
            calendar_events=(calendar_events_by_day or {}).get(day, []),
        )
        for task in _day_overflow:
            if task.get("_overflow_reason"):
                overflow_reasons_by_id[task_identity(task)] = str(task["_overflow_reason"])
        scheduled_by_day[day] = scheduled
        scheduled_ids = {task_identity(item.task) for item in scheduled}
        remaining_tasks = [task for task in remaining_tasks if task_identity(task) not in scheduled_ids]

    missed = [
        {**task, "_overflow_reason": "missed weekend deadline"}
        for task in remaining_tasks
        if (latest := latest_schedulable_day(task)) is not None
        and (due := parse_date(task.get("due"))) is not None
        and due.weekday() >= 5
        and start_day <= latest <= days[-1]
    ]
    missed_ids = {task_identity(task) for task in missed}
    overflow = missed + [
        with_overflow_reason(task, overflow_reasons_by_id[task_identity(task)])
        if task_identity(task) in overflow_reasons_by_id
        else task
        for task in remaining_tasks
        if task_identity(task) not in missed_ids
        and should_consider_for_week(
            task,
            days,
            start_day=start_day,
            horizon_days=horizon_days,
            week_prefix=week_prefix,
        )
    ]
    overflow.sort(key=lambda task: urgency_bucket(task, start_day, week_prefix))
    return scheduled_by_day, overflow
