from __future__ import annotations

from datetime import date
from pathlib import Path
from typing import Any

import yaml

try:
    from scripts.time_blocks import (
        allocate_daily_plan,
        allocate_weekly_plan,
        is_open_task,
        ranked_candidates,
        task_minutes,
        task_reason,
    )
except ImportError:
    from time_blocks import (
        allocate_daily_plan,
        allocate_weekly_plan,
        is_open_task,
        ranked_candidates,
        task_minutes,
        task_reason,
    )


def _truthy(value: Any) -> bool:
    return bool(value) and str(value).lower() not in {"false", "0", "no", "none"}


def _priority(value: Any) -> int:
    try:
        return int(value)
    except Exception:
        return 99


def _days_until(value: Any, target_day: date) -> int | None:
    try:
        return (date.fromisoformat(str(value)[:10]) - target_day).days
    except Exception:
        return None


def _split_frontmatter(text: str) -> tuple[dict[str, Any], str]:
    if not (text.startswith("---\n") or text.startswith("---\r\n")):
        return {}, text
    lines = text.splitlines(keepends=True)
    for i in range(1, len(lines)):
        if lines[i].strip() == "---":
            raw = "".join(lines[1:i])
            try:
                parsed = yaml.safe_load(raw) or {}
            except Exception:
                parsed = {}
            return (parsed if isinstance(parsed, dict) else {}), "".join(lines[i + 1 :])
    return {}, text


def read_time_planning_settings(root: Path) -> dict[str, Any]:
    rel_path = Path("settings/time_planning.md")
    path = root / rel_path
    if not path.exists():
        return {"no_work_before": None}
    raw = path.read_text(encoding="utf-8", errors="replace")
    frontmatter, _ = _split_frontmatter(raw)
    no_work_before = frontmatter.get("no_work_before") or frontmatter.get("not_working_until")
    return {"no_work_before": str(no_work_before) if no_work_before else None}


def read_time_planning_preferences(root: Path) -> dict[str, Any]:
    rel_path = Path("settings/time_planning.md")
    path = root / rel_path
    if not path.exists():
        return {
            "path": rel_path.as_posix(),
            "exists": False,
            "private": True,
            "summary": "No stored time-planning preference profile found.",
            "content": "",
        }
    raw = path.read_text(encoding="utf-8", errors="replace")
    frontmatter, body = _split_frontmatter(raw)
    content = body.strip()
    return {
        "path": rel_path.as_posix(),
        "exists": True,
        "private": True,
        "summary": content[:1400] + ("..." if len(content) > 1400 else ""),
        "content": content,
        "settings": {
            "no_work_before": str(frontmatter.get("no_work_before") or frontmatter.get("not_working_until") or ""),
        },
    }


def time_task_summary(task: dict[str, Any], target_day: date, week_prefix: str | None = None) -> dict[str, Any]:
    minutes = task_minutes(task)
    payload = {
        "path": task.get("path", ""),
        "title": task.get("title", ""),
        "project": task.get("project", ""),
        "domain": task.get("domain", ""),
        "time_category": task.get("time_category", ""),
        "schedule_policy": task.get("schedule_policy", ""),
        "priority": str(task.get("priority", "")) if task.get("priority") is not None else "",
        "urgent": bool(task.get("urgent")),
        "focus_manual": bool(task.get("focus_manual")),
        "focus_rank": task.get("focus_rank", ""),
        "status": task.get("status", ""),
        "due": task.get("due", ""),
        "deadline_type": task.get("deadline_type", ""),
        "next": task.get("next", ""),
        "minutes": minutes,
        "estimate_minutes": minutes,
        "reason": task_reason(task, target_day, week_prefix),
        "private": bool(task.get("private")),
        "kind": task.get("kind") or "task",
    }
    if task.get("readonly"):
        payload["readonly"] = bool(task.get("readonly"))
    if task.get("source_label"):
        payload["sourceLabel"] = task.get("source_label")
    if task.get("source_event_id"):
        payload["sourceEventId"] = task.get("source_event_id")
    if task.get("all_day") is not None:
        payload["allDay"] = bool(task.get("all_day"))
    if task.get("blocking") is not None:
        payload["blocking"] = bool(task.get("blocking"))
    return payload


def time_block_payload(item: Any) -> dict[str, Any]:
    payload = time_task_summary(item.task, item.day, "")
    payload.update(
        {
            "start": item.start,
            "end": item.end,
            "minutes": item.minutes,
            "reason": item.reason,
            "segment_index": getattr(item, "segment_index", 1),
            "segment_count": getattr(item, "segment_count", 1),
        }
    )
    return payload


def build_deterministic_plan(
    tasks: list[dict[str, Any]],
    target_day: date,
    week_start_day: date,
    *,
    start: str,
    capacity_minutes: int,
    weekdays: int,
    horizon_days: int,
    week_prefix: str,
    no_work_before: date | None = None,
    calendar_events_by_day: dict[date, list[dict[str, Any]]] | None = None,
    calendar_status: dict[str, Any] | None = None,
) -> dict[str, Any]:
    daily_blocks, daily_overflow = allocate_daily_plan(
        tasks,
        target_day,
        start=start,
        capacity_minutes=capacity_minutes,
        horizon_days=horizon_days,
        week_prefix=week_prefix,
        no_work_before=no_work_before,
        calendar_events=(calendar_events_by_day or {}).get(target_day, []),
    )
    weekly_blocks, weekly_overflow = allocate_weekly_plan(
        tasks,
        week_start_day,
        start=start,
        capacity_minutes=capacity_minutes,
        weekdays=weekdays,
        horizon_days=horizon_days,
        week_prefix=week_prefix,
        no_work_before=no_work_before,
        calendar_events_by_day=calendar_events_by_day,
    )
    return {
        "settings": {
            "date": target_day.isoformat(),
            "week_start": week_start_day.isoformat(),
            "start": start,
            "capacity_minutes": capacity_minutes,
            "weekdays": weekdays,
            "horizon_days": horizon_days,
            "no_work_before": no_work_before.isoformat() if no_work_before else "",
        },
        "daily": {
            "date": target_day.isoformat(),
            "total_minutes": sum(item.minutes for item in daily_blocks),
            "blocks": [time_block_payload(item) for item in daily_blocks],
        },
        "daily_overflow": [time_task_summary(task, target_day, week_prefix) for task in daily_overflow],
        "weekly": [
            {
                "date": day.isoformat(),
                "total_minutes": sum(item.minutes for item in items),
                "blocks": [time_block_payload(item) for item in items],
            }
            for day, items in weekly_blocks.items()
        ],
        "weekly_overflow": [time_task_summary(task, week_start_day, week_prefix) for task in weekly_overflow],
        "calendar": calendar_status or {"enabled": False, "last_fetch": "", "event_count": 0, "source_labels": [], "errors": []},
    }


def pressing_tasks(
    tasks: list[dict[str, Any]],
    target_day: date,
    *,
    horizon_days: int,
    week_prefix: str,
    include_private: bool,
    limit: int = 18,
) -> list[dict[str, Any]]:
    visible = [task for task in tasks if include_private or not _truthy(task.get("private"))]
    ranked = ranked_candidates(visible, target_day, horizon_days=horizon_days, week_prefix=week_prefix)
    return [time_task_summary(task, target_day, week_prefix) for task in ranked[:limit]]


def _project_identity(project: dict[str, Any]) -> str:
    return str(project.get("id") or project.get("project") or project.get("name") or project.get("title") or "").lower()


def _project_matches_task(project: dict[str, Any], task: dict[str, Any]) -> bool:
    key = _project_identity(project)
    if not key:
        return False
    candidates = {
        str(task.get("project") or "").lower(),
        str(task.get("project_id") or "").lower(),
    }
    return key in candidates


def pressing_projects(
    projects: list[dict[str, Any]],
    tasks: list[dict[str, Any]],
    target_day: date,
    *,
    include_private: bool,
    limit: int = 10,
) -> list[dict[str, Any]]:
    open_tasks = [task for task in tasks if is_open_task(task) and (include_private or not _truthy(task.get("private")))]
    summaries: list[dict[str, Any]] = []
    for project in projects:
        if not include_private and _truthy(project.get("private")):
            continue
        linked = [task for task in open_tasks if _project_matches_task(project, task)]
        deadline = project.get("deadline") or project.get("due") or project.get("date") or ""
        days = _days_until(deadline, target_day)
        priority = _priority(project.get("priority"))
        status = str(project.get("status") or "").lower()
        pressing = linked or priority <= 2 or (days is not None and days <= 14) or any(token in status for token in ["active", "urgent", "needs", "waiting"])
        if not pressing:
            continue
        summaries.append(
            {
                "path": project.get("path", ""),
                "title": project.get("name") or project.get("title") or project.get("id") or "Untitled project",
                "id": project.get("id") or project.get("project") or "",
                "status": project.get("status", ""),
                "priority": str(project.get("priority", "")) if project.get("priority") is not None else "",
                "deadline": deadline,
                "deadline_type": project.get("deadline_type") or "",
                "days_until_deadline": days,
                "next": project.get("next_action") or project.get("next") or project.get("snippet") or "",
                "open_task_count": len(linked),
                "private": bool(project.get("private")),
            }
        )
    return sorted(
        summaries,
        key=lambda item: (
            _priority(item.get("priority")),
            item.get("days_until_deadline") if item.get("days_until_deadline") is not None else 9999,
            -int(item.get("open_task_count") or 0),
            str(item.get("title", "")),
        ),
    )[:limit]


def _format_task_line(task: dict[str, Any]) -> str:
    category = task.get("time_category") or task.get("domain") or "uncategorized"
    return (
        f"- {task.get('reason', 'selected')} | P{task.get('priority') or '-'} | "
        f"{category} | {task.get('deadline_type') or 'soft'} deadline | {task.get('title')} [{task.get('project') or 'no project'}] | "
        f"due {task.get('due') or 'no date'} | {task.get('minutes')}m | file: {task.get('path')}"
    )


def _format_plan_block(block: dict[str, Any]) -> str:
    if block.get("kind") == "calendar":
        source = block.get("sourceLabel") or block.get("project") or "Calendar"
        return (
            f"- {block.get('start')}-{block.get('end')} | calendar | {source} | "
            f"{block.get('title')} | {block.get('minutes')}m | {block.get('reason')}"
        )
    category = block.get("time_category") or block.get("domain") or "uncategorized"
    return (
        f"- {block.get('start')}-{block.get('end')} | {block.get('reason')} | "
        f"P{block.get('priority') or '-'} | {category} | {block.get('deadline_type') or 'soft'} deadline | {block.get('title')} "
        f"[{block.get('project') or 'no project'}] | {block.get('minutes')}m"
    )


def render_agent_prompt(context: dict[str, Any]) -> str:
    plan = context["deterministic_plan"]
    lines = [
        "# Codex Agent Planning Brief",
        "",
        "You are helping create an ad hoc time plan. Markdown tasks are canonical.",
        "Do not mark tasks complete, do not edit task frontmatter, and do not write journal/schedule files unless explicitly asked after this plan.",
        "",
        "## Requested Output",
        "- A revised daily time-block plan with start/end times.",
        "- A weekly allocation sketch for work that does not fit today.",
        "- A short rationale explaining which urgent projects/tasks were prioritized.",
        "- An overflow/defer list with why each item was deferred.",
        "",
        "## Settings",
        f"- Date: {context['settings']['date']}",
        f"- Week start: {context['settings']['week_start']}",
        f"- Start: {context['settings']['start']}",
        f"- Capacity/day: {context['settings']['capacity_minutes']} minutes",
        f"- Workdays: {context['settings']['weekdays']}",
        f"- Horizon: {context['settings']['horizon_days']} days",
        f"- No work before: {context['settings'].get('no_work_before') or 'none'}",
        "",
        "## Ad Hoc Constraints",
        context.get("ad_hoc") or "None provided.",
        "",
        "## Stored Planning Preferences",
        context["preferences"].get("content") or context["preferences"].get("summary") or "No stored preferences.",
        "",
        "## Deterministic Daily Baseline",
    ]
    if plan["daily"]["blocks"]:
        lines.extend(_format_plan_block(block) for block in plan["daily"]["blocks"])
    else:
        lines.append("- No deterministic daily allocation.")
    lines.extend(["", "## Deterministic Weekly Baseline"])
    for day in plan["weekly"]:
        lines.append(f"### {day['date']} ({day['total_minutes']}m)")
        if day["blocks"]:
            lines.extend(_format_plan_block(block) for block in day["blocks"])
        else:
            lines.append("- No allocation.")
    lines.extend(["", "## Pressing Tasks"])
    if context["pressing_tasks"]:
        lines.extend(_format_task_line(task) for task in context["pressing_tasks"])
    else:
        lines.append("- No pressing open tasks found.")
    lines.extend(["", "## Pressing Projects"])
    if context["pressing_projects"]:
        for project in context["pressing_projects"]:
            lines.append(
                f"- P{project.get('priority') or '-'} | {project.get('title')} | "
                f"{project.get('open_task_count')} open tasks | {project.get('deadline_type') or 'soft'} deadline {project.get('deadline') or 'none'} | "
                f"next: {project.get('next') or 'none'} | file: {project.get('path')}"
            )
    else:
        lines.append("- No pressing project summaries found.")
    lines.extend(["", "## Overflow From Deterministic Plan"])
    if plan["daily_overflow"]:
        lines.append("### Today")
        lines.extend(_format_task_line(task) for task in plan["daily_overflow"][:12])
    if plan["weekly_overflow"]:
        lines.append("### Week")
        lines.extend(_format_task_line(task) for task in plan["weekly_overflow"][:12])
    if not plan["daily_overflow"] and not plan["weekly_overflow"]:
        lines.append("- No deterministic overflow.")
    calendar = plan.get("calendar") or {}
    if calendar.get("enabled"):
        lines.extend(
            [
                "",
                "## Calendar Import",
                f"- Sources: {', '.join(calendar.get('source_labels') or []) or 'none'}",
                f"- Imported work events in planning range: {calendar.get('event_count', 0)}",
                f"- Last fetch: {calendar.get('last_fetch') or 'not fetched'}",
            ]
        )
        if calendar.get("errors"):
            lines.append(f"- Calendar warnings: {'; '.join(calendar.get('errors') or [])}")
    return "\n".join(lines).strip() + "\n"


def build_agent_plan_context(
    *,
    root: Path,
    tasks: list[dict[str, Any]],
    projects: list[dict[str, Any]],
    target_day: date,
    week_start_day: date,
    start: str,
    capacity_minutes: int,
    weekdays: int,
    horizon_days: int,
    week_prefix: str,
    ad_hoc: str = "",
    include_private: bool = True,
    calendar_events_by_day: dict[date, list[dict[str, Any]]] | None = None,
    calendar_status: dict[str, Any] | None = None,
) -> dict[str, Any]:
    visible_tasks = [task for task in tasks if include_private or not _truthy(task.get("private"))]
    visible_projects = [project for project in projects if include_private or not _truthy(project.get("private"))]
    planning_settings = read_time_planning_settings(root)
    no_work_before = None
    try:
        no_work_before = date.fromisoformat(str(planning_settings.get("no_work_before"))) if planning_settings.get("no_work_before") else None
    except Exception:
        no_work_before = None
    context = {
        "settings": {
            "date": target_day.isoformat(),
            "week_start": week_start_day.isoformat(),
            "start": start,
            "capacity_minutes": capacity_minutes,
            "weekdays": weekdays,
            "horizon_days": horizon_days,
            "include_private": include_private,
            "no_work_before": no_work_before.isoformat() if no_work_before else "",
        },
        "ad_hoc": ad_hoc.strip(),
        "preferences": read_time_planning_preferences(root),
        "deterministic_plan": build_deterministic_plan(
            visible_tasks,
            target_day,
            week_start_day,
            start=start,
            capacity_minutes=capacity_minutes,
            weekdays=weekdays,
            horizon_days=horizon_days,
            week_prefix=week_prefix,
            no_work_before=no_work_before,
            calendar_events_by_day=calendar_events_by_day,
            calendar_status=calendar_status,
        ),
        "pressing_tasks": pressing_tasks(
            tasks,
            target_day,
            horizon_days=horizon_days,
            week_prefix=week_prefix,
            include_private=include_private,
        ),
        "pressing_projects": pressing_projects(
            visible_projects,
            tasks,
            target_day,
            include_private=include_private,
        ),
    }
    context["calendar"] = calendar_status or {"enabled": False, "last_fetch": "", "event_count": 0, "source_labels": [], "errors": []}
    context["agent_prompt"] = render_agent_prompt(context)
    return context
