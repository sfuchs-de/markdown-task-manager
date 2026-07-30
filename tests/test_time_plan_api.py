from __future__ import annotations

import json
from pathlib import Path

from fastapi.testclient import TestClient

from server.app import app, get_service
from server.vault import VaultService


def write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def task_file(
    root: Path,
    name: str,
    *,
    title: str,
    due: str = "2026-05-06",
    status: str = "open",
    priority: int = 1,
    estimate: int = 60,
    deadline_type: str = "hard",
    extra: str = "",
) -> None:
    write(
        root / f"tasks/active/{name}.md",
        f"""---
kind: task
status: {status}
project: alpha
domain: research
priority: {priority}
due: {due}
deadline_type: {deadline_type}
estimate_minutes: {estimate}
next: "Do {title}"
{extra}---
# {title}
""",
    )


def date_event_file(
    root: Path,
    name: str,
    *,
    title: str,
    event_date: str,
    event_type: str,
    end_date: str | None = None,
) -> None:
    end_line = f'end_date: "{end_date}"\n' if end_date else ""
    write(
        root / f"dates/{name}.md",
        f"""---
kind: event
id: {name}
date: "{event_date}"
{end_line}title: "{title}"
project: alpha
type: "{event_type}"
---
# {title}
""",
    )


def client_for(root: Path, monkeypatch) -> TestClient:
    app.dependency_overrides[get_service] = lambda: VaultService(root)
    monkeypatch.setenv("PM_APP_TOKEN", "test-token")
    monkeypatch.setenv("PM_REQUIRE_LOCAL_AUTH", "true")
    monkeypatch.delenv("TIMEPLAN_CALENDAR_ICS_URLS", raising=False)
    monkeypatch.delenv("TIMEPLAN_CALENDAR_USER_EMAILS", raising=False)
    return TestClient(app)


def teardown_client() -> None:
    app.dependency_overrides.clear()


def test_time_plan_endpoint_allocates_daily_and_weekly_plan(tmp_path: Path, monkeypatch) -> None:
    task_file(tmp_path, "manual", title="Manual", due="2026-06-01", priority=4, extra="block_day: 2026-05-06\n")
    task_file(tmp_path, "today", title="Today")
    task_file(tmp_path, "done", title="Done", status="done")

    client = client_for(tmp_path, monkeypatch)
    try:
        response = client.get(
            "/api/time-plan?date=2026-05-06&week_start=2026-05-06&capacity_minutes=120",
            headers={"Authorization": "Bearer test-token"},
        )
    finally:
        teardown_client()

    assert response.status_code == 200
    body = response.json()
    assert body["settings"]["date"] == "2026-05-06"
    assert body["settings"]["week_start"] == "2026-05-06"
    assert len(body["weekly"]) == 5
    assert [block["title"] for block in body["daily"]["blocks"]] == ["Manual", "Today"]
    assert [block["reason"] for block in body["daily"]["blocks"]] == ["manual day", "due today"]
    assert "Done" not in [block["title"] for block in body["daily"]["blocks"]]


def test_time_plan_endpoint_respects_lunch_and_overflow(tmp_path: Path, monkeypatch) -> None:
    for title in ["Alpha", "Beta", "Gamma", "Example Air", "Overflow"]:
        task_file(tmp_path, title.lower(), title=title)

    client = client_for(tmp_path, monkeypatch)
    try:
        response = client.get(
            "/api/time-plan?date=2026-05-06&capacity_minutes=240",
            headers={"Authorization": "Bearer test-token"},
        )
    finally:
        teardown_client()

    assert response.status_code == 200
    body = response.json()
    assert [(block["start"], block["end"]) for block in body["daily"]["blocks"]] == [
        ("09:00", "10:00"),
        ("10:00", "11:00"),
        ("11:00", "12:00"),
        ("13:00", "14:00"),
    ]
    assert [task["title"] for task in body["daily_overflow"]] == ["Overflow"]


def test_time_plan_endpoint_excludes_waiting_and_exposes_split_segments(tmp_path: Path, monkeypatch) -> None:
    task_file(tmp_path, "waiting", title="Waiting", status="waiting", estimate=60)
    task_file(tmp_path, "deep", title="Deep", estimate=240)
    task_file(tmp_path, "follow", title="Follow", estimate=180)

    client = client_for(tmp_path, monkeypatch)
    try:
        response = client.get(
            "/api/time-plan?date=2026-05-06&capacity_minutes=420",
            headers={"Authorization": "Bearer test-token"},
        )
    finally:
        teardown_client()

    assert response.status_code == 200
    body = response.json()
    assert [(block["title"], block["start"], block["end"], block["segment_index"], block["segment_count"]) for block in body["daily"]["blocks"]] == [
        ("Deep", "09:00", "12:00", 1, 2),
        ("Deep", "13:00", "14:00", 2, 2),
        ("Follow", "14:00", "17:00", 1, 1),
    ]
    assert "Waiting" not in [block["title"] for block in body["daily"]["blocks"]]


def test_time_plan_endpoint_respects_no_work_before_setting(tmp_path: Path, monkeypatch) -> None:
    write(
        tmp_path / "settings/time_planning.md",
        "---\nprivate: true\nno_work_before: 2026-05-11\n---\n# Time preferences\n",
    )
    task_file(tmp_path, "urgent", title="Urgent", due="2026-05-08", priority=1)

    client = client_for(tmp_path, monkeypatch)
    try:
        response = client.get(
            "/api/time-plan?date=2026-05-08&week_start=2026-05-08&capacity_minutes=60&weekdays=2",
            headers={"Authorization": "Bearer test-token"},
        )
    finally:
        teardown_client()

    assert response.status_code == 200
    body = response.json()
    assert body["settings"]["no_work_before"] == "2026-05-11"
    assert body["daily"]["blocks"] == []
    assert [task["reason"] for task in body["daily_overflow"]] == ["non-working day"]
    assert [day["date"] for day in body["weekly"]] == ["2026-05-11", "2026-05-12"]


def test_time_plan_endpoint_imports_calendar_blocks_and_keeps_feed_private(tmp_path: Path, monkeypatch) -> None:
    task_file(tmp_path, "today", title="Today", estimate=120)
    ics_path = tmp_path / "work.ics"
    write(
        ics_path,
        """BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:meeting-1
SUMMARY:Research meeting https://secret.example/token
DTSTART:20260506T100000
DTEND:20260506T110000
TRANSP:OPAQUE
END:VEVENT
END:VCALENDAR
""",
    )

    client = client_for(tmp_path, monkeypatch)
    monkeypatch.setenv(
        "TIMEPLAN_CALENDAR_ICS_URLS",
        json.dumps([{"label": "Work", "url": ics_path.as_uri(), "scope": "mixed"}]),
    )
    try:
        response = client.get(
            "/api/time-plan?date=2026-05-06&week_start=2026-05-06&capacity_minutes=240",
            headers={"Authorization": "Bearer test-token"},
        )
        agent_response = client.get(
            "/api/time-plan/agent-context?date=2026-05-06&week_start=2026-05-06&capacity_minutes=240",
            headers={"Authorization": "Bearer test-token"},
        )
    finally:
        teardown_client()

    assert response.status_code == 200
    body = response.json()
    assert body["calendar"]["enabled"] is True
    assert body["calendar"]["source_labels"] == ["Work"]
    assert "file://" not in str(body)
    assert [(block["kind"], block["title"], block["start"], block["end"]) for block in body["daily"]["blocks"]] == [
        ("task", "Today", "09:00", "10:00"),
        ("calendar", "Research meeting", "10:00", "11:00"),
        ("task", "Today", "11:00", "12:00"),
    ]
    calendar_block = body["daily"]["blocks"][1]
    assert calendar_block["readonly"] is True
    assert calendar_block["sourceLabel"] == "Work"
    assert "https://" not in calendar_block["title"]
    assert agent_response.status_code == 200
    agent_body = agent_response.json()
    assert agent_body["calendar"]["event_count"] == 1
    assert "Research meeting" in agent_body["agent_prompt"]
    assert "file://" not in agent_body["agent_prompt"]


def test_time_plan_endpoint_uses_private_local_calendar_snapshot(tmp_path: Path, monkeypatch) -> None:
    task_file(tmp_path, "today", title="Today", estimate=120)
    write(
        tmp_path / "local_data/calendar/timeplan_events.json",
        json.dumps(
            {
                "generated_at": "2026-05-11T18:00:00-04:00",
                "source_label": "Google Calendar snapshot",
                "events": [
                    {
                        "title": "Research meeting https://secret.example/token",
                        "date": "2026-05-06",
                        "start": "10:00",
                        "end": "11:00",
                        "work": True,
                    }
                ],
            }
        ),
    )

    client = client_for(tmp_path, monkeypatch)
    try:
        response = client.get(
            "/api/time-plan?date=2026-05-06&week_start=2026-05-06&capacity_minutes=240",
            headers={"Authorization": "Bearer test-token"},
        )
    finally:
        teardown_client()

    assert response.status_code == 200
    body = response.json()
    assert body["calendar"]["enabled"] is True
    assert body["calendar"]["source_labels"] == ["Google Calendar snapshot"]
    assert "local_data" not in str(body)
    assert [(block["kind"], block["title"], block["start"], block["end"]) for block in body["daily"]["blocks"]] == [
        ("task", "Today", "09:00", "10:00"),
        ("calendar", "Research meeting", "10:00", "11:00"),
        ("task", "Today", "11:00", "12:00"),
    ]
    assert body["daily"]["blocks"][1]["private"] is False
    assert "https://" not in body["daily"]["blocks"][1]["title"]


def test_time_plan_endpoint_blocks_markdown_conference_and_travel_dates(tmp_path: Path, monkeypatch) -> None:
    task_file(tmp_path, "today", title="Today", estimate=60)
    date_event_file(
        tmp_path,
        "research-conference",
        title="Research conference",
        event_date="2026-05-06",
        end_date="2026-05-07",
        event_type="conference",
    )
    date_event_file(
        tmp_path,
        "travel-day",
        title="Return travel",
        event_date="2026-05-08",
        event_type="travel",
    )

    client = client_for(tmp_path, monkeypatch)
    try:
        response = client.get(
            "/api/time-plan?date=2026-05-06&week_start=2026-05-06&capacity_minutes=120&weekdays=3",
            headers={"Authorization": "Bearer test-token"},
        )
    finally:
        teardown_client()

    assert response.status_code == 200
    body = response.json()
    assert body["calendar"]["enabled"] is True
    assert body["calendar"]["event_count"] == 3
    assert body["calendar"]["source_labels"] == ["Markdown dates"]
    assert [(block["kind"], block["title"], block["allDay"], block["start"], block["end"]) for block in body["daily"]["blocks"]] == [
        ("calendar", "Research conference", True, "09:00", "11:00")
    ]
    assert [task["title"] for task in body["daily_overflow"]] == ["Today"]
    assert body["daily_overflow"][0]["reason"] == "calendar conflict"
    assert [
        [(block["kind"], block["title"]) for block in day["blocks"]]
        for day in body["weekly"]
    ] == [
        [("calendar", "Research conference")],
        [("calendar", "Research conference")],
        [("calendar", "Return travel")],
    ]


def test_time_plan_endpoint_uses_same_auth_boundary(tmp_path: Path, monkeypatch) -> None:
    task_file(tmp_path, "today", title="Today")
    app.dependency_overrides[get_service] = lambda: VaultService(tmp_path)
    monkeypatch.delenv("PM_APP_TOKEN", raising=False)
    monkeypatch.setenv("PM_REQUIRE_LOCAL_AUTH", "true")
    client = TestClient(app)
    try:
        response = client.get("/api/time-plan?date=2026-05-06")
    finally:
        teardown_client()

    assert response.status_code == 503
    assert "PM_APP_TOKEN" in response.json()["detail"]


def test_vault_drift_endpoint_reports_counts_and_respects_auth(tmp_path: Path, monkeypatch) -> None:
    source = tmp_path / "source"
    target = tmp_path / "target"
    write(source / "tasks/active/source-only.md", "# Source Only\n")
    write(source / "tasks/active/changed.md", "# Source Version\n")
    write(target / "tasks/active/changed.md", "# Target Version\n")
    write(target / "tasks/active/extra.md", "# Extra\n")
    monkeypatch.setenv("PM_VAULT_SEED_SOURCE", str(source))

    client = client_for(target, monkeypatch)
    try:
        unauthorized = client.get("/api/vault/drift")
        response = client.get("/api/vault/drift?include_paths=true", headers={"Authorization": "Bearer test-token"})
    finally:
        teardown_client()

    assert unauthorized.status_code == 401
    assert response.status_code == 200
    body = response.json()
    assert body["counts"]["missing"] == 1
    assert body["counts"]["changed"] == 1
    assert body["counts"]["extra"] == 1
    assert body["paths"]["missing"] == ["tasks/active/source-only.md"]


def test_time_plan_agent_context_endpoint_returns_prompt_and_respects_private_filter(tmp_path: Path, monkeypatch) -> None:
    write(
        tmp_path / "settings/time_planning.md",
        """---
private: true
---
# Preferences

- Batch admin late.
""",
    )
    task_file(tmp_path, "today", title="Today")
    task_file(tmp_path, "private", title="Private", extra="private: true\n")
    write(
        tmp_path / "projects/alpha/README.md",
        """---
kind: project
id: alpha
title: Alpha
status: active
priority: 1
---
# Alpha
""",
    )

    client = client_for(tmp_path, monkeypatch)
    try:
        response = client.get(
            "/api/time-plan/agent-context?date=2026-05-06&week_start=2026-05-06&include_private=false&ad_hoc=protect%20writing",
            headers={"Authorization": "Bearer test-token"},
        )
    finally:
        teardown_client()

    assert response.status_code == 200
    body = response.json()
    assert body["preferences"]["exists"] is True
    assert "Batch admin late" in body["preferences"]["summary"]
    assert body["ad_hoc"] == "protect writing"
    assert [task["title"] for task in body["pressing_tasks"]] == ["Today"]
    assert "Private" not in body["agent_prompt"]
    assert "protect writing" in body["agent_prompt"]
    assert body["pressing_projects"][0]["title"] == "Alpha"
