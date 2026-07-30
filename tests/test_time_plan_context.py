from __future__ import annotations

from datetime import date
from pathlib import Path

from scripts.time_plan_context import build_agent_plan_context


def write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def test_agent_plan_context_includes_preferences_ad_hoc_and_prompt(tmp_path: Path) -> None:
    write(
        tmp_path / "settings/time_planning.md",
        """---
private: true
---
# Preferences

- Protect morning deep work.
""",
    )
    tasks = [
        {
            "path": "tasks/active/t-one.md",
            "title": "Urgent task",
            "project": "alpha",
            "status": "open",
            "priority": 1,
            "due": "2026-05-06",
            "estimate_minutes": 60,
        },
        {
            "path": "tasks/active/t-private.md",
            "title": "Private task",
            "project": "alpha",
            "status": "open",
            "priority": 1,
            "due": "2026-05-06",
            "estimate_minutes": 60,
            "private": True,
        },
    ]
    projects = [{"id": "alpha", "name": "Alpha", "priority": 1, "status": "active", "path": "projects/alpha/README.md"}]

    context = build_agent_plan_context(
        root=tmp_path,
        tasks=tasks,
        projects=projects,
        target_day=date(2026, 5, 6),
        week_start_day=date(2026, 5, 6),
        start="09:00",
        capacity_minutes=120,
        weekdays=5,
        horizon_days=14,
        week_prefix="2026-05-",
        ad_hoc="Low energy today.",
        include_private=False,
    )

    assert context["preferences"]["exists"] is True
    assert "Protect morning deep work" in context["preferences"]["summary"]
    assert context["ad_hoc"] == "Low energy today."
    assert [task["title"] for task in context["pressing_tasks"]] == ["Urgent task"]
    assert "Private task" not in context["agent_prompt"]
    assert "Low energy today." in context["agent_prompt"]
    assert "Do not mark tasks complete" in context["agent_prompt"]


def test_agent_plan_context_handles_missing_preferences(tmp_path: Path) -> None:
    context = build_agent_plan_context(
        root=tmp_path,
        tasks=[],
        projects=[],
        target_day=date(2026, 5, 6),
        week_start_day=date(2026, 5, 6),
        start="09:00",
        capacity_minutes=120,
        weekdays=5,
        horizon_days=14,
        week_prefix="2026-05-",
    )

    assert context["preferences"]["exists"] is False
    assert "No stored time-planning preference profile found" in context["preferences"]["summary"]
    assert "No deterministic daily allocation" in context["agent_prompt"]
