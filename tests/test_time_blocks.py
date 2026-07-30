from __future__ import annotations

from datetime import date

from scripts.time_blocks import allocate_daily_plan, allocate_weekly_plan, should_auto_schedule, task_time_category


def task(
    title: str,
    *,
    due: str = "",
    priority: int = 3,
    estimate: int = 60,
    status: str = "open",
    category: str = "research",
    deadline_type: str = "hard",
    urgent: bool = False,
    focus_rank: int | None = None,
    focus_manual: bool = False,
    schedule_policy: str = "",
) -> dict:
    return {
        "id": title,
        "path": f"tasks/active/{title}.md",
        "title": title,
        "due": due,
        "priority": priority,
        "estimate_minutes": estimate,
        "status": status,
        "project": "alpha",
        "domain": "admin" if category == "admin" else category,
        "time_category": category,
        "deadline_type": deadline_type,
        "urgent": urgent,
        "focus_rank": focus_rank,
        "focus_manual": focus_manual,
        "schedule_policy": schedule_policy,
    }


def test_daily_allocator_prioritizes_overdue_today_and_p1_tasks() -> None:
    scheduled, overflow = allocate_daily_plan(
        [
            task("later", due="2026-05-12", priority=3),
            task("p1", due="2026-05-10", priority=1),
            task("today", due="2026-05-06", priority=2),
            task("overdue", due="2026-05-05", priority=3),
        ],
        date(2026, 5, 6),
        capacity_minutes=180,
    )

    assert [item.task["title"] for item in scheduled] == ["overdue", "today", "p1"]
    assert [item.reason for item in scheduled] == ["overdue", "due today", "priority 1"]
    assert [item["title"] for item in overflow] == ["later"]


def test_soft_deadlines_have_lighter_auto_scheduling_and_reason_labels() -> None:
    scheduled, overflow = allocate_daily_plan(
        [
            task("hard-today", due="2026-05-06", priority=3, deadline_type="hard"),
            task("soft-today", due="2026-05-06", priority=3, deadline_type="soft"),
            task("soft-far", due="2026-05-12", priority=3, deadline_type="soft"),
        ],
        date(2026, 5, 6),
        capacity_minutes=120,
        horizon_days=14,
    )

    assert [(item.task["title"], item.reason) for item in scheduled] == [
        ("hard-today", "due today"),
        ("soft-today", "soft target today"),
    ]
    assert overflow == []
    assert not should_auto_schedule(task("soft-far", due="2026-05-12", priority=3, deadline_type="soft"), date(2026, 5, 6), 14)


def test_schedule_policy_overrides_auto_scheduling_and_category() -> None:
    target_day = date(2026, 5, 6)
    anchor = task("anchor", priority=4, category="", schedule_policy="research-anchor")
    deferred = task("deferred", due="2026-05-06", priority=1, schedule_policy="defer")

    assert should_auto_schedule(anchor, target_day, 14)
    assert not should_auto_schedule(deferred, target_day, 14)
    assert task_time_category(anchor) == "research"

    scheduled, overflow = allocate_daily_plan([deferred, anchor], target_day, capacity_minutes=60)

    assert [(item.task["title"], item.reason) for item in scheduled] == [("anchor", "policy: research anchor")]
    assert overflow == []


def test_daily_allocator_respects_manual_block_day() -> None:
    scheduled, _ = allocate_daily_plan(
        [
            {**task("manual", due="2026-06-01", priority=4), "block_day": "2026-05-06"},
            task("today", due="2026-05-06", priority=1),
        ],
        date(2026, 5, 6),
        capacity_minutes=120,
    )

    assert scheduled[0].task["title"] == "manual"
    assert scheduled[0].reason == "manual day"


def test_p4_hard_deadline_stays_deferred_until_explicitly_focused_or_blocked() -> None:
    parked = task("parked-hard", due="2026-05-08", priority=4, deadline_type="hard")
    focused = task("focused-hard", due="2026-05-20", priority=4, deadline_type="hard", focus_rank=1)
    blocked = {**task("blocked-hard", due="2026-05-20", priority=4, deadline_type="hard"), "block_day": "2026-05-06"}

    scheduled, overflow = allocate_daily_plan(
        [parked, focused, blocked],
        date(2026, 5, 6),
        capacity_minutes=180,
        horizon_days=14,
    )

    assert [(item.task["title"], item.reason) for item in scheduled] == [
        ("focused-hard", "focus #1"),
        ("blocked-hard", "manual day"),
    ]
    assert overflow == []
    assert not should_auto_schedule(parked, date(2026, 5, 6), 14)


def test_weekly_allocator_spreads_without_duplicates() -> None:
    scheduled_by_day, overflow = allocate_weekly_plan(
        [
            task("due-today", due="2026-05-06", priority=2),
            task("due-friday", due="2026-05-08", priority=2),
            task("p1-undated", priority=1),
        ],
        date(2026, 5, 6),
        capacity_minutes=60,
        weekdays=3,
    )

    scheduled_titles = [item.task["title"] for items in scheduled_by_day.values() for item in items]
    assert scheduled_titles == ["due-today", "due-friday", "p1-undated"]
    assert len(scheduled_titles) == len(set(scheduled_titles))
    assert overflow == []


def test_manual_urgent_tasks_dominate_daily_schedule() -> None:
    scheduled, overflow = allocate_daily_plan(
        [
            task("ordinary-overdue", due="2026-05-05", priority=1, estimate=60),
            task("manual-urgent", due="2026-05-20", priority=3, estimate=60, urgent=True),
            task("ordinary-today", due="2026-05-06", priority=1, estimate=60),
        ],
        date(2026, 5, 6),
        capacity_minutes=120,
    )

    assert [(item.task["title"], item.reason) for item in scheduled] == [
        ("manual-urgent", "manual urgent"),
        ("ordinary-overdue", "overdue"),
    ]
    assert [item["title"] for item in overflow] == ["ordinary-today"]


def test_manual_urgent_tasks_are_included_without_due_or_high_priority() -> None:
    scheduled, overflow = allocate_daily_plan(
        [
            task("manual-urgent", priority=4, estimate=60, urgent=True),
            task("ordinary-low", priority=4, estimate=60),
        ],
        date(2026, 5, 6),
        capacity_minutes=60,
    )

    assert [(item.task["title"], item.reason) for item in scheduled] == [("manual-urgent", "manual urgent")]
    assert overflow == []


def test_focus_rank_tasks_are_scheduled_before_regular_urgent_tasks() -> None:
    scheduled, overflow = allocate_daily_plan(
        [
            task("manual-urgent", due="2026-05-20", priority=3, estimate=60, urgent=True),
            task("rank-two", priority=4, estimate=60, focus_rank=2),
            task("rank-one", priority=4, estimate=60, focus_rank=1),
        ],
        date(2026, 5, 6),
        capacity_minutes=120,
    )

    assert [(item.task["title"], item.reason) for item in scheduled] == [
        ("rank-one", "focus #1"),
        ("rank-two", "focus #2"),
    ]
    assert [item["title"] for item in overflow] == ["manual-urgent"]


def test_manual_urgent_admin_task_overrides_admin_cap() -> None:
    scheduled, overflow = allocate_daily_plan(
        [
            task("manual-urgent-admin", priority=3, estimate=120, category="admin", urgent=True),
            task("research-anchor", due="2026-05-06", priority=2, estimate=120),
            task("ordinary-admin", due="2026-05-06", priority=1, estimate=120, category="admin"),
        ],
        date(2026, 5, 6),
        capacity_minutes=240,
    )

    assert [(item.task["title"], item.reason, item.segment_index, item.segment_count) for item in scheduled] == [
        ("manual-urgent-admin", "manual urgent", 1, 1),
        ("research-anchor", "due today", 1, 2),
        ("research-anchor", "due today", 2, 2),
    ]
    assert [item["title"] for item in overflow] == ["ordinary-admin"]


def test_completed_and_cancelled_tasks_are_excluded() -> None:
    scheduled, _ = allocate_daily_plan(
        [
            task("done", due="2026-05-06", priority=1, status="done"),
            task("cancelled", due="2026-05-06", priority=1, status="cancelled"),
            task("open", due="2026-05-06", priority=1),
        ],
        date(2026, 5, 6),
        capacity_minutes=180,
    )

    assert [item.task["title"] for item in scheduled] == ["open"]


def test_waiting_and_blocked_tasks_are_excluded_unless_manually_forced() -> None:
    scheduled, overflow = allocate_daily_plan(
        [
            task("waiting", due="2026-05-06", priority=1, status="waiting"),
            task("blocked", due="2026-05-06", priority=1, status="blocked"),
            {**task("forced", due="2026-06-01", priority=4, status="waiting"), "block_day": "2026-05-06"},
            task("open", due="2026-05-06", priority=1),
        ],
        date(2026, 5, 6),
        capacity_minutes=270,
    )

    assert [item.task["title"] for item in scheduled] == ["forced", "open"]
    assert [item.task["title"] for item in scheduled if item.reason == "manual day"] == ["forced"]
    assert overflow == []


def test_daily_allocator_skips_default_lunch_break() -> None:
    scheduled, _ = allocate_daily_plan(
        [
            task("one", due="2026-05-06", priority=1),
            task("two", due="2026-05-06", priority=1),
            task("three", due="2026-05-06", priority=1),
            task("four", due="2026-05-06", priority=1),
        ],
        date(2026, 5, 6),
        capacity_minutes=270,
    )

    assert [(item.start, item.end) for item in scheduled] == [
        ("09:00", "10:00"),
        ("10:00", "11:00"),
        ("11:00", "12:00"),
        ("13:00", "14:00"),
    ]


def test_daily_allocator_splits_tasks_around_lunch_without_crossing_or_extending_day() -> None:
    scheduled, overflow = allocate_daily_plan(
        [
            task("deep", due="2026-05-06", priority=1, estimate=240),
            task("follow", due="2026-05-06", priority=1, estimate=180),
        ],
        date(2026, 5, 6),
        capacity_minutes=420,
    )

    assert [(item.task["title"], item.start, item.end, item.segment_index, item.segment_count) for item in scheduled] == [
        ("deep", "09:00", "12:00", 1, 2),
        ("deep", "13:00", "14:00", 2, 2),
        ("follow", "14:00", "17:00", 1, 1),
    ]
    assert overflow == []


def test_daily_allocator_does_not_partially_schedule_task_that_cannot_fit() -> None:
    scheduled, overflow = allocate_daily_plan(
        [
            task("too-large", due="2026-05-06", priority=1, estimate=500),
            task("small", due="2026-05-06", priority=1, estimate=60),
        ],
        date(2026, 5, 6),
        capacity_minutes=420,
    )

    assert [item.task["title"] for item in scheduled] == ["small"]
    assert [item["title"] for item in overflow] == ["too-large"]


def test_daily_allocator_limits_admin_tasks_by_default() -> None:
    scheduled, overflow = allocate_daily_plan(
        [
            task("research-anchor", due="2026-05-06", priority=2, estimate=180),
            task("admin-a", due="2026-05-15", priority=3, estimate=30, category="admin"),
            task("admin-b", due="2026-05-15", priority=3, estimate=30, category="admin"),
            task("admin-c", due="2026-05-15", priority=3, estimate=30, category="admin"),
        ],
        date(2026, 5, 6),
        capacity_minutes=300,
        horizon_days=14,
    )

    assert [item.task["title"] for item in scheduled] == ["research-anchor", "admin-a"]
    assert [item["title"] for item in overflow] == ["admin-b", "admin-c"]
    assert {item["_overflow_reason"] for item in overflow} == {"admin cap"}


def test_daily_allocator_allows_second_admin_when_due_or_p1() -> None:
    scheduled, overflow = allocate_daily_plan(
        [
            task("research-anchor", due="2026-05-06", priority=2, estimate=180),
            task("admin-p1", priority=1, estimate=30, category="admin"),
            task("admin-due", due="2026-05-06", priority=3, estimate=30, category="admin"),
            task("admin-extra", due="2026-05-15", priority=3, estimate=30, category="admin"),
        ],
        date(2026, 5, 6),
        capacity_minutes=300,
        horizon_days=14,
    )

    assert [item.task["title"] for item in scheduled] == ["research-anchor", "admin-due", "admin-p1"]
    assert [item["title"] for item in overflow] == ["admin-extra"]
    assert overflow[0]["_overflow_reason"] == "admin cap"


def test_daily_allocator_batches_admin_at_day_edge_after_research_fill() -> None:
    scheduled, overflow = allocate_daily_plan(
        [
            task("research-anchor", due="2026-05-06", priority=2, estimate=180),
            task("research-fill", due="2026-05-07", priority=2, estimate=210),
            task("admin-slot", due="2026-05-06", priority=1, estimate=30, category="admin"),
        ],
        date(2026, 5, 6),
        capacity_minutes=420,
    )

    assert [item.task["title"] for item in scheduled] == [
        "research-anchor",
        "research-fill",
        "admin-slot",
    ]
    assert [(item.task["title"], item.start, item.end) for item in scheduled] == [
        ("research-anchor", "09:00", "12:00"),
        ("research-fill", "13:00", "16:30"),
        ("admin-slot", "16:30", "17:00"),
    ]
    assert overflow == []


def test_daily_allocator_keeps_admin_batch_contiguous_and_capped() -> None:
    scheduled, overflow = allocate_daily_plan(
        [
            task("research-anchor", due="2026-05-06", priority=2, estimate=180),
            task("research-fill", due="2026-05-07", priority=2, estimate=90),
            task("admin-due", due="2026-05-06", priority=3, estimate=45, category="admin"),
            task("admin-p1", priority=1, estimate=45, category="admin"),
            task("admin-extra", due="2026-05-15", priority=3, estimate=30, category="admin"),
        ],
        date(2026, 5, 6),
        capacity_minutes=420,
    )

    assert [(item.task["title"], item.start, item.end) for item in scheduled] == [
        ("research-anchor", "09:00", "12:00"),
        ("research-fill", "13:00", "14:30"),
        ("admin-due", "15:30", "16:15"),
        ("admin-p1", "16:15", "17:00"),
    ]
    assert [item["title"] for item in overflow] == ["admin-extra"]
    assert overflow[0]["_overflow_reason"] == "admin cap"


def test_daily_allocator_keeps_research_as_largest_block() -> None:
    scheduled, overflow = allocate_daily_plan(
        [
            task("research-anchor", due="2026-05-06", priority=2, estimate=120),
            task("large-admin", due="2026-05-06", priority=1, estimate=120, category="admin"),
            task("small-admin", due="2026-05-06", priority=1, estimate=30, category="admin"),
        ],
        date(2026, 5, 6),
        capacity_minutes=300,
    )

    assert [item.task["title"] for item in scheduled] == ["research-anchor", "small-admin"]
    assert [item["title"] for item in overflow] == ["large-admin"]
    assert overflow[0]["_overflow_reason"] == "research anchor protected"


def test_daily_allocator_defers_admin_when_no_research_block_fits() -> None:
    scheduled, overflow = allocate_daily_plan(
        [
            task("too-large-research", due="2026-05-06", priority=1, estimate=500),
            task("small-admin", due="2026-05-06", priority=1, estimate=30, category="admin"),
        ],
        date(2026, 5, 6),
        capacity_minutes=120,
    )

    assert scheduled == []
    assert [item["title"] for item in overflow] == ["too-large-research", "small-admin"]
    assert overflow[1]["_overflow_reason"] == "no research block fits"


def test_weekly_allocator_applies_admin_cap_per_day() -> None:
    scheduled_by_day, overflow = allocate_weekly_plan(
        [
            task("research-day-one", due="2026-05-06", priority=2, estimate=120),
            task("admin-day-one", due="2026-05-06", priority=3, estimate=30, category="admin"),
            task("research-day-two", due="2026-05-07", priority=2, estimate=120),
            task("admin-day-two", due="2026-05-07", priority=3, estimate=30, category="admin"),
        ],
        date(2026, 5, 6),
        capacity_minutes=150,
        weekdays=2,
    )

    assert [item.task["title"] for item in scheduled_by_day[date(2026, 5, 6)]] == ["research-day-one", "admin-day-one"]
    assert [item.task["title"] for item in scheduled_by_day[date(2026, 5, 7)]] == ["research-day-two", "admin-day-two"]
    assert overflow == []


def test_weekly_allocator_backfills_weekend_deadlines_before_weekend_or_overflows() -> None:
    scheduled_by_day, overflow = allocate_weekly_plan(
        [
            task("friday-full", due="2026-05-08", priority=1, estimate=420),
            task("sunday-deadline", due="2026-05-10", priority=1, estimate=60),
        ],
        date(2026, 5, 8),
        capacity_minutes=420,
        weekdays=3,
    )

    assert [item.task["title"] for item in scheduled_by_day[date(2026, 5, 8)]] == ["friday-full", "friday-full"]
    assert [item.task["title"] for item in scheduled_by_day[date(2026, 5, 11)]] == []
    assert [item.task["title"] for item in scheduled_by_day[date(2026, 5, 12)]] == []
    assert [item["title"] for item in overflow] == ["sunday-deadline"]
    assert overflow[0]["_overflow_reason"] == "missed weekend deadline"


def test_no_work_before_blocks_daily_and_rolls_weekly_start() -> None:
    daily, daily_overflow = allocate_daily_plan(
        [task("urgent", due="2026-05-08", priority=1)],
        date(2026, 5, 8),
        capacity_minutes=60,
        no_work_before=date(2026, 5, 11),
    )
    weekly, _weekly_overflow = allocate_weekly_plan(
        [task("urgent", due="2026-05-08", priority=1)],
        date(2026, 5, 8),
        capacity_minutes=60,
        weekdays=2,
        no_work_before=date(2026, 5, 11),
    )

    assert daily == []
    assert [item["title"] for item in daily_overflow] == ["urgent"]
    assert daily_overflow[0]["_overflow_reason"] == "non-working day"
    assert list(weekly) == [date(2026, 5, 11), date(2026, 5, 12)]


def test_calendar_events_block_task_windows_without_becoming_admin_tasks() -> None:
    scheduled, overflow = allocate_daily_plan(
        [
            task("research-anchor", due="2026-05-06", priority=1, estimate=180),
            task("admin-slot", due="2026-05-06", priority=1, estimate=30, category="admin"),
        ],
        date(2026, 5, 6),
        capacity_minutes=270,
        calendar_events=[
            {
                "id": "meeting-1",
                "date": "2026-05-06",
                "title": "Research meeting",
                "start": "10:00",
                "end": "11:00",
                "source_label": "Work",
            }
        ],
    )

    assert [(item.task.get("kind", "task"), item.task["title"], item.start, item.end) for item in scheduled] == [
        ("task", "research-anchor", "09:00", "10:00"),
        ("calendar", "Research meeting", "10:00", "11:00"),
        ("task", "research-anchor", "11:00", "12:00"),
        ("task", "research-anchor", "13:00", "14:00"),
        ("task", "admin-slot", "14:00", "14:30"),
    ]
    assert overflow == []


def test_calendar_conflict_explains_overflow_when_meetings_consume_capacity() -> None:
    scheduled, overflow = allocate_daily_plan(
        [task("research-anchor", due="2026-05-06", priority=1, estimate=180)],
        date(2026, 5, 6),
        capacity_minutes=180,
        calendar_events=[
            {
                "id": "meeting-1",
                "date": "2026-05-06",
                "title": "Morning meeting",
                "start": "09:00",
                "end": "11:00",
                "source_label": "Work",
            }
        ],
    )

    assert [item.task["title"] for item in scheduled] == ["Morning meeting"]
    assert [item["title"] for item in overflow] == ["research-anchor"]
    assert overflow[0]["_overflow_reason"] == "calendar conflict"


def test_all_day_calendar_event_blocks_full_workday() -> None:
    scheduled, overflow = allocate_daily_plan(
        [task("research-anchor", due="2026-05-06", priority=1, estimate=60)],
        date(2026, 5, 6),
        capacity_minutes=420,
        calendar_events=[
            {
                "id": "conference",
                "date": "2026-05-06",
                "title": "Spatial Inequality Conference",
                "all_day": True,
                "source_label": "Work",
            }
        ],
    )

    assert [(item.task.get("kind", "task"), item.task["title"], item.start, item.end, item.minutes) for item in scheduled] == [
        ("calendar", "Spatial Inequality Conference", "09:00", "17:00", 420)
    ]
    assert [item["title"] for item in overflow] == ["research-anchor"]
    assert overflow[0]["_overflow_reason"] == "calendar conflict"


def test_overlapping_all_day_calendar_events_do_not_create_zero_minute_blocks() -> None:
    scheduled, overflow = allocate_daily_plan(
        [task("research-anchor", due="2026-05-06", priority=1, estimate=60)],
        date(2026, 5, 6),
        capacity_minutes=420,
        calendar_events=[
            {
                "id": "conference",
                "date": "2026-05-06",
                "title": "Spatial Inequality Conference",
                "all_day": True,
                "source_label": "Work",
            },
            {
                "id": "markdown-conference",
                "date": "2026-05-06",
                "title": "Spatial Inequality Conference begins",
                "all_day": True,
                "source_label": "Markdown dates",
            },
        ],
    )

    assert [(item.task["title"], item.minutes) for item in scheduled] == [("Spatial Inequality Conference", 420)]
    assert [item["title"] for item in overflow] == ["research-anchor"]


def test_weekly_allocator_applies_calendar_blocks_per_day() -> None:
    scheduled_by_day, overflow = allocate_weekly_plan(
        [
            task("research-day-one", due="2026-05-06", priority=1, estimate=60),
            task("research-day-two", due="2026-05-07", priority=1, estimate=60),
        ],
        date(2026, 5, 6),
        capacity_minutes=120,
        weekdays=2,
        calendar_events_by_day={
            date(2026, 5, 6): [
                {
                    "id": "meeting-1",
                    "date": "2026-05-06",
                    "title": "Work meeting",
                    "start": "09:00",
                    "end": "10:00",
                    "source_label": "Work",
                }
            ],
        },
    )

    assert [item.task["title"] for item in scheduled_by_day[date(2026, 5, 6)]] == ["Work meeting", "research-day-one"]
    assert [item.task["title"] for item in scheduled_by_day[date(2026, 5, 7)]] == ["research-day-two"]
    assert overflow == []
