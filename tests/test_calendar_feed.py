from __future__ import annotations

import json
from datetime import date
from pathlib import Path

from scripts.calendar_feed import _CACHE, load_calendar_events_by_day


def write_ics(path: Path, body: str) -> None:
    path.write_text(
        "BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//Research Workbench Test//EN\n"
        + body.strip()
        + "\nEND:VCALENDAR\n",
        encoding="utf-8",
    )


def configure_calendar(monkeypatch, path: Path, *, scope: str = "mixed") -> None:
    _CACHE.clear()
    monkeypatch.setenv(
        "TIMEPLAN_CALENDAR_ICS_URLS",
        json.dumps([{"label": "Work", "url": path.as_uri(), "scope": scope}]),
    )


def test_calendar_feed_disabled_without_env(tmp_path: Path, monkeypatch) -> None:
    _CACHE.clear()
    monkeypatch.delenv("TIMEPLAN_CALENDAR_ICS_URLS", raising=False)

    result = load_calendar_events_by_day(tmp_path, date(2026, 5, 11), date(2026, 5, 12))

    assert result["status"]["enabled"] is False
    assert result["events_by_day"] == {}


def test_calendar_feed_uses_private_local_cache_without_env(tmp_path: Path, monkeypatch) -> None:
    _CACHE.clear()
    monkeypatch.delenv("TIMEPLAN_CALENDAR_ICS_URLS", raising=False)
    cache_path = tmp_path / "local_data/calendar/timeplan_events.json"
    cache_path.parent.mkdir(parents=True)
    cache_path.write_text(
        json.dumps(
            {
                "generated_at": "2026-05-11T18:00:00-04:00",
                "source_label": "Google Calendar snapshot",
                "events": [
                    {
                        "title": "Shipping meeting https://secret.example/token",
                        "date": "2026-05-11",
                        "start": "09:00",
                        "end": "10:00",
                        "work": True,
                    },
                    {
                        "title": "Spatial Inequality Conference",
                        "date": "2026-05-14",
                        "end_date": "2026-05-15",
                        "all_day": True,
                        "work": True,
                    },
                    {
                        "title": "Sushi reservation",
                        "date": "2026-05-11",
                        "start": "12:00",
                        "end": "13:00",
                        "work": True,
                    },
                ],
            }
        ),
        encoding="utf-8",
    )

    result = load_calendar_events_by_day(tmp_path, date(2026, 5, 11), date(2026, 5, 16))

    assert result["status"]["enabled"] is True
    assert result["status"]["event_count"] == 3
    assert result["status"]["source_labels"] == ["Google Calendar snapshot"]
    assert result["events_by_day"][date(2026, 5, 11)][0]["title"] == "Shipping meeting"
    assert "https://" not in result["events_by_day"][date(2026, 5, 11)][0]["title"]
    assert [event["date"] for event in result["events_by_day"][date(2026, 5, 14)]] == ["2026-05-14"]
    assert [event["date"] for event in result["events_by_day"][date(2026, 5, 15)]] == ["2026-05-15"]
    assert date(2026, 5, 12) not in result["events_by_day"]


def test_calendar_feed_expands_recurring_events_and_sanitizes_titles(tmp_path: Path, monkeypatch) -> None:
    ics_path = tmp_path / "work.ics"
    write_ics(
        ics_path,
        """
BEGIN:VEVENT
UID:recurring-meeting
SUMMARY:Research meeting https://token.example/private
DTSTART:20260511T100000
DTEND:20260511T110000
RRULE:FREQ=DAILY;COUNT=2
TRANSP:OPAQUE
END:VEVENT
""",
    )
    configure_calendar(monkeypatch, ics_path)

    result = load_calendar_events_by_day(tmp_path, date(2026, 5, 11), date(2026, 5, 14))

    assert result["status"]["enabled"] is True
    assert result["status"]["event_count"] == 2
    assert [event["date"] for events in result["events_by_day"].values() for event in events] == [
        "2026-05-11",
        "2026-05-12",
    ]
    first = result["events_by_day"][date(2026, 5, 11)][0]
    assert first["title"] == "Research meeting"
    assert first["start"] == "10:00"
    assert first["end"] == "11:00"
    assert "https://" not in first["title"]


def test_calendar_feed_filters_cancelled_declined_personal_and_transparent_nonwork(tmp_path: Path, monkeypatch) -> None:
    ics_path = tmp_path / "work.ics"
    write_ics(
        ics_path,
        """
BEGIN:VEVENT
UID:cancelled
SUMMARY:Research meeting cancelled
DTSTART:20260511T090000
DTEND:20260511T100000
STATUS:CANCELLED
END:VEVENT
BEGIN:VEVENT
UID:declined
SUMMARY:Research meeting declined
DTSTART:20260511T100000
DTEND:20260511T110000
ATTENDEE;PARTSTAT=DECLINED:mailto:owner@example.com
END:VEVENT
BEGIN:VEVENT
UID:personal
SUMMARY:Sushi reservation
DTSTART:20260511T120000
DTEND:20260511T130000
END:VEVENT
BEGIN:VEVENT
UID:transparent
SUMMARY:Research sync
DTSTART:20260511T140000
DTEND:20260511T150000
TRANSP:TRANSPARENT
END:VEVENT
BEGIN:VEVENT
UID:included
SUMMARY:Policy seminar
DTSTART:20260511T150000
DTEND:20260511T160000
TRANSP:OPAQUE
END:VEVENT
""",
    )
    configure_calendar(monkeypatch, ics_path)
    monkeypatch.setenv("TIMEPLAN_CALENDAR_USER_EMAILS", "owner@example.com")

    result = load_calendar_events_by_day(tmp_path, date(2026, 5, 11), date(2026, 5, 12))

    assert [event["title"] for event in result["events_by_day"][date(2026, 5, 11)]] == ["Policy seminar"]


def test_calendar_feed_includes_transparent_all_day_work_conference(tmp_path: Path, monkeypatch) -> None:
    ics_path = tmp_path / "work.ics"
    write_ics(
        ics_path,
        """
BEGIN:VEVENT
UID:spatial-inequality
SUMMARY:Spatial Inequality Conference
DTSTART;VALUE=DATE:20260514
DTEND;VALUE=DATE:20260516
TRANSP:TRANSPARENT
END:VEVENT
""",
    )
    configure_calendar(monkeypatch, ics_path)

    result = load_calendar_events_by_day(tmp_path, date(2026, 5, 14), date(2026, 5, 17))

    assert [event["date"] for events in result["events_by_day"].values() for event in events] == [
        "2026-05-14",
        "2026-05-15",
    ]
    assert all(event["all_day"] for events in result["events_by_day"].values() for event in events)
