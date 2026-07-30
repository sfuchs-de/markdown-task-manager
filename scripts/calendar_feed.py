from __future__ import annotations

import json
import hashlib
import os
import re
import time
from dataclasses import dataclass
from datetime import date, datetime, time as DateTime, timedelta
from pathlib import Path
from typing import Any
from urllib.request import urlopen
from zoneinfo import ZoneInfo

import yaml

try:
    import recurring_ical_events
    from icalendar import Calendar
except ImportError as exc:
    recurring_ical_events = None
    Calendar = None
    CALENDAR_DEPENDENCY_ERROR = exc
else:
    CALENDAR_DEPENDENCY_ERROR = None


DEFAULT_WORK_KEYWORDS = [
    "board",
    "conference",
    "meeting",
    "office hours",
    "presentation",
    "research",
    "seminar",
    "talk",
    "workshop",
    "zoom",
]

DEFAULT_EXCLUDE_KEYWORDS = [
    "birthday",
    "dinner",
    "doctor",
    "dentist",
    "medical",
    "personal",
    "reservation",
    "sushi",
]

CACHE_TTL_SECONDS = 600
LOCAL_CACHE_PATH = Path("local_data/calendar/timeplan_events.json")
_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}


@dataclass(frozen=True)
class CalendarSource:
    label: str
    url: str
    scope: str = "mixed"


def _split_frontmatter(text: str) -> tuple[dict[str, Any], str]:
    if not (text.startswith("---\n") or text.startswith("---\r\n")):
        return {}, text
    lines = text.splitlines(keepends=True)
    for index in range(1, len(lines)):
        if lines[index].strip() == "---":
            raw = "".join(lines[1:index])
            try:
                parsed = yaml.safe_load(raw) or {}
            except Exception:
                parsed = {}
            return (parsed if isinstance(parsed, dict) else {}), "".join(lines[index + 1 :])
    return {}, text


def read_calendar_import_settings(root: Path) -> dict[str, Any]:
    path = root / "settings" / "calendar_import.md"
    if not path.exists():
        return {
            "timezone": "America/New_York",
            "work_keywords": DEFAULT_WORK_KEYWORDS,
            "exclude_keywords": DEFAULT_EXCLUDE_KEYWORDS,
        }
    frontmatter, _body = _split_frontmatter(path.read_text(encoding="utf-8", errors="replace"))
    return {
        "timezone": str(frontmatter.get("timezone") or "America/New_York"),
        "work_keywords": _string_list(frontmatter.get("work_keywords")) or DEFAULT_WORK_KEYWORDS,
        "exclude_keywords": _string_list(frontmatter.get("exclude_keywords")) or DEFAULT_EXCLUDE_KEYWORDS,
    }


def _string_list(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    if isinstance(value, str):
        return [item.strip() for item in value.split(",") if item.strip()]
    return []


def _calendar_sources_from_env() -> tuple[list[CalendarSource], str]:
    raw = os.environ.get("TIMEPLAN_CALENDAR_ICS_URLS", "").strip()
    if not raw:
        return [], ""
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        if raw.startswith(("http://", "https://", "file://")):
            return [CalendarSource(label="Calendar", url=raw, scope="mixed")], ""
        return [], "Invalid TIMEPLAN_CALENDAR_ICS_URLS; expected JSON array of calendar sources."
    if isinstance(parsed, dict):
        parsed = [parsed]
    if isinstance(parsed, str):
        parsed = [{"label": "Calendar", "url": parsed, "scope": "mixed"}]
    if not isinstance(parsed, list):
        return [], "Invalid TIMEPLAN_CALENDAR_ICS_URLS; expected a list."
    sources: list[CalendarSource] = []
    for index, item in enumerate(parsed, start=1):
        if not isinstance(item, dict):
            continue
        url = str(item.get("url") or "").strip()
        if not url:
            continue
        label = _sanitize_label(item.get("label") or f"Calendar {index}")
        scope = str(item.get("scope") or "mixed").strip().lower()
        if scope not in {"work", "mixed"}:
            scope = "mixed"
        sources.append(CalendarSource(label=label, url=url, scope=scope))
    return sources, "" if sources else "No usable calendar sources found in TIMEPLAN_CALENDAR_ICS_URLS."


def _read_local_cache(root: Path) -> tuple[dict[str, Any] | None, str]:
    path = root / LOCAL_CACHE_PATH
    if not path.exists():
        return None, ""
    try:
        parsed = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None, "Local calendar cache is not valid JSON."
    if not isinstance(parsed, dict):
        return None, "Local calendar cache must be a JSON object."
    return parsed, ""


def _sanitize_label(value: Any) -> str:
    label = re.sub(r"\s+", " ", str(value or "Calendar")).strip()
    return label[:80] or "Calendar"


def _sanitize_title(value: Any) -> str:
    title = re.sub(r"https?://\S+", "", str(value or "")).strip()
    title = re.sub(r"\s+", " ", title)
    return title[:160] or "Work meeting"


def _parse_cache_date(value: Any) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        return None


def _valid_clock(value: Any) -> str | None:
    text = str(value or "").strip()
    if not re.fullmatch(r"\d{2}:\d{2}", text):
        return None
    hour, minute = [int(part) for part in text.split(":", 1)]
    if 0 <= hour <= 23 and 0 <= minute <= 59:
        return text
    return None


def _cache_source_label(payload: dict[str, Any], entry: dict[str, Any]) -> str:
    return _sanitize_label(entry.get("source_label") or payload.get("source_label") or "Google Calendar snapshot")


def _cache_event_id(entry: dict[str, Any], event_day: date, index: int, source_label: str) -> str:
    key = "|".join(
        [
            source_label,
            _sanitize_title(entry.get("title")),
            event_day.isoformat(),
            str(entry.get("start") or ""),
            str(entry.get("end") or ""),
            str(index),
        ]
    )
    return hashlib.sha256(key.encode("utf-8")).hexdigest()[:16]


def _cache_entry_dates(entry: dict[str, Any], start_day: date, end_day: date) -> list[date]:
    if isinstance(entry.get("dates"), list):
        raw_days = [_parse_cache_date(item) for item in entry["dates"]]
        return sorted(day for day in raw_days if day is not None and start_day <= day < end_day)
    first_day = _parse_cache_date(entry.get("date") or entry.get("start_date"))
    if first_day is None:
        return []
    last_day = _parse_cache_date(entry.get("end_date")) or first_day
    if last_day < first_day:
        last_day = first_day
    days: list[date] = []
    current = max(first_day, start_day)
    final = min(last_day, end_day - timedelta(days=1))
    while current <= final:
        days.append(current)
        current += timedelta(days=1)
    return days


def _cache_entry_is_work_like(entry: dict[str, Any], title: str, settings: dict[str, Any]) -> bool:
    if bool(entry.get("work")) or bool(entry.get("include")):
        return True
    scope = str(entry.get("scope") or "").lower()
    if scope == "work":
        return True
    return _matches_any(title, list(settings["work_keywords"]))


def _load_local_cache_events_by_day(root: Path, start_day: date, end_day: date, settings: dict[str, Any]) -> dict[str, Any] | None:
    payload, cache_error = _read_local_cache(root)
    if payload is None:
        if cache_error:
            return {
                "status": {
                    "enabled": False,
                    "last_fetch": "",
                    "event_count": 0,
                    "source_labels": [],
                    "errors": [cache_error],
                },
                "events_by_day": {},
            }
        return None
    raw_events = payload.get("events")
    if not isinstance(raw_events, list):
        return {
            "status": {
                "enabled": False,
                "last_fetch": str(payload.get("generated_at") or ""),
                "event_count": 0,
                "source_labels": [],
                "errors": ["Local calendar cache must contain an events list."],
            },
            "events_by_day": {},
        }

    events_by_day: dict[date, list[dict[str, Any]]] = {}
    labels: set[str] = set()
    errors: list[str] = []
    for index, raw_entry in enumerate(raw_events):
        if not isinstance(raw_entry, dict):
            continue
        title = _sanitize_title(raw_entry.get("title"))
        if _matches_any(title, list(settings["exclude_keywords"])):
            continue
        if not _cache_entry_is_work_like(raw_entry, title, settings):
            continue
        all_day = bool(raw_entry.get("all_day"))
        start_clock = _valid_clock(raw_entry.get("start"))
        end_clock = _valid_clock(raw_entry.get("end"))
        if not all_day and (start_clock is None or end_clock is None or end_clock <= start_clock):
            errors.append(f"Skipped cached event with invalid time: {title}")
            continue
        source_label = _cache_source_label(payload, raw_entry)
        labels.add(source_label)
        for event_day in _cache_entry_dates(raw_entry, start_day, end_day):
            event_id = _cache_event_id(raw_entry, event_day, index, source_label)
            event: dict[str, Any] = {
                "id": f"local-calendar-{event_id}",
                "path": f"calendar:{source_label}:local-calendar-{event_id}",
                "title": title,
                "date": event_day.isoformat(),
                "source_label": source_label,
                "all_day": all_day,
                "reason": str(raw_entry.get("reason") or ("all-day work event" if all_day else "cached work meeting")),
                "private": bool(raw_entry.get("private")),
            }
            if not all_day:
                event.update({"start": start_clock, "end": end_clock})
            events_by_day.setdefault(event_day, []).append(event)

    for day_events in events_by_day.values():
        day_events.sort(key=lambda event: (event.get("start") or "00:00", event.get("title") or ""))
    return {
        "status": {
            "enabled": True,
            "last_fetch": str(payload.get("generated_at") or ""),
            "event_count": sum(len(events) for events in events_by_day.values()),
            "source_labels": sorted(labels) or [_sanitize_label(payload.get("source_label") or "Google Calendar snapshot")],
            "errors": errors,
        },
        "events_by_day": events_by_day,
    }


def _safe_error(label: str, exc: Exception) -> str:
    return f"{label}: {type(exc).__name__}"


def _cache_key(sources: list[CalendarSource], start_day: date, end_day: date, settings: dict[str, Any]) -> str:
    source_key = [(source.label, source.url, source.scope) for source in sources]
    return json.dumps(
        {
            "sources": source_key,
            "start": start_day.isoformat(),
            "end": end_day.isoformat(),
            "timezone": settings["timezone"],
            "work": settings["work_keywords"],
            "exclude": settings["exclude_keywords"],
            "user_emails": os.environ.get("TIMEPLAN_CALENDAR_USER_EMAILS", ""),
        },
        sort_keys=True,
    )


def _read_ics(source: CalendarSource) -> bytes:
    with urlopen(source.url, timeout=12) as response:
        return response.read()


def _decoded(component: Any, name: str) -> Any:
    try:
        return component.decoded(name)
    except Exception:
        return None


def _as_local_datetime(value: Any, tz: ZoneInfo) -> tuple[datetime | None, bool]:
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=tz)
        return value.astimezone(tz), False
    if isinstance(value, date):
        return datetime.combine(value, DateTime.min, tzinfo=tz), True
    return None, False


def _normalized(value: str) -> str:
    return re.sub(r"\s+", " ", value.lower()).strip()


def _matches_any(text: str, keywords: list[str]) -> bool:
    normalized = _normalized(text)
    return any(keyword.lower() in normalized for keyword in keywords if keyword)


def _attendee_values(component: Any) -> list[Any]:
    attendees = component.get("attendee")
    if attendees is None:
        return []
    return attendees if isinstance(attendees, list) else [attendees]


def _declined_by_user(component: Any) -> bool:
    user_emails = {item.strip().lower() for item in os.environ.get("TIMEPLAN_CALENDAR_USER_EMAILS", "").split(",") if item.strip()}
    if not user_emails:
        return False
    for attendee in _attendee_values(component):
        value = str(attendee).lower().replace("mailto:", "")
        partstat = str(getattr(attendee, "params", {}).get("PARTSTAT", "")).upper()
        if value in user_emails and partstat == "DECLINED":
            return True
    return False


def _is_included_event(
    component: Any,
    *,
    title: str,
    all_day: bool,
    source: CalendarSource,
    work_keywords: list[str],
    exclude_keywords: list[str],
) -> bool:
    status = str(component.get("status") or "").upper()
    if status == "CANCELLED":
        return False
    if _declined_by_user(component):
        return False
    if _matches_any(title, exclude_keywords):
        return False
    transparency = str(component.get("transp") or "OPAQUE").upper()
    work_like = source.scope == "work" or _matches_any(title, work_keywords)
    if not work_like:
        return False
    if transparency == "TRANSPARENT" and not all_day:
        return False
    return True


def _source_event_id(component: Any, day: date, source: CalendarSource) -> str:
    uid = str(component.get("uid") or "event")
    recurrence_id = component.get("recurrence-id")
    suffix = str(recurrence_id) if recurrence_id else day.isoformat()
    return f"{source.label}:{uid}:{suffix}"


def _event_reason(all_day: bool) -> str:
    return "all-day work event" if all_day else "work meeting"


def _component_to_day_events(
    component: Any,
    *,
    source: CalendarSource,
    start_day: date,
    end_day: date,
    tz: ZoneInfo,
    work_keywords: list[str],
    exclude_keywords: list[str],
) -> list[dict[str, Any]]:
    start_raw = _decoded(component, "dtstart")
    end_raw = _decoded(component, "dtend")
    start_dt, start_all_day = _as_local_datetime(start_raw, tz)
    if start_dt is None:
        return []
    end_dt, end_all_day = _as_local_datetime(end_raw, tz)
    all_day = start_all_day or end_all_day
    if end_dt is None:
        end_dt = start_dt + (timedelta(days=1) if all_day else timedelta(hours=1))
    if end_dt <= start_dt:
        end_dt = start_dt + (timedelta(days=1) if all_day else timedelta(hours=1))
    title = _sanitize_title(component.get("summary"))
    if not _is_included_event(
        component,
        title=title,
        all_day=all_day,
        source=source,
        work_keywords=work_keywords,
        exclude_keywords=exclude_keywords,
    ):
        return []

    events: list[dict[str, Any]] = []
    current = max(start_day, start_dt.date())
    while current < end_day:
        day_start = datetime.combine(current, DateTime.min, tzinfo=tz)
        day_end = day_start + timedelta(days=1)
        if end_dt <= day_start:
            break
        if start_dt < day_end and end_dt > day_start:
            segment_start = max(start_dt, day_start)
            segment_end = min(end_dt, day_end)
            event: dict[str, Any] = {
                "id": _source_event_id(component, current, source),
                "path": f"calendar:{source.label}:{_source_event_id(component, current, source)}",
                "title": title,
                "date": current.isoformat(),
                "source_label": source.label,
                "source_event_id": str(component.get("uid") or ""),
                "all_day": all_day,
                "reason": _event_reason(all_day),
                "private": False,
            }
            if not all_day:
                event.update(
                    {
                        "start": segment_start.strftime("%H:%M"),
                        "end": segment_end.strftime("%H:%M"),
                    }
                )
            events.append(event)
        current += timedelta(days=1)
    return events


def _load_source_events(
    source: CalendarSource,
    *,
    start_day: date,
    end_day: date,
    tz: ZoneInfo,
    work_keywords: list[str],
    exclude_keywords: list[str],
) -> list[dict[str, Any]]:
    calendar = Calendar.from_ical(_read_ics(source))
    start_dt = datetime.combine(start_day, DateTime.min, tzinfo=tz)
    end_dt = datetime.combine(end_day, DateTime.min, tzinfo=tz)
    components = recurring_ical_events.of(calendar).between(start_dt, end_dt)
    events: list[dict[str, Any]] = []
    for component in components:
        events.extend(
            _component_to_day_events(
                component,
                source=source,
                start_day=start_day,
                end_day=end_day,
                tz=tz,
                work_keywords=work_keywords,
                exclude_keywords=exclude_keywords,
            )
        )
    return events


def load_calendar_events_by_day(root: Path, start_day: date, end_day: date) -> dict[str, Any]:
    settings = read_calendar_import_settings(root)
    sources, config_error = _calendar_sources_from_env()
    if not sources and not config_error:
        local_result = _load_local_cache_events_by_day(root, start_day, end_day, settings)
        if local_result is not None:
            return local_result
    status: dict[str, Any] = {
        "enabled": bool(sources),
        "last_fetch": "",
        "event_count": 0,
        "source_labels": [source.label for source in sources],
        "errors": [config_error] if config_error else [],
    }
    if not sources:
        return {"status": status, "events_by_day": {}}
    if CALENDAR_DEPENDENCY_ERROR is not None:
        status.update({"errors": ["Calendar feed dependencies are not installed."]})
        return {"status": status, "events_by_day": {}}

    key = _cache_key(sources, start_day, end_day, settings)
    cached = _CACHE.get(key)
    now = time.time()
    if cached and now - cached[0] < CACHE_TTL_SECONDS:
        return cached[1]

    try:
        tz = ZoneInfo(str(settings["timezone"]))
    except Exception:
        status.update({"errors": ["Invalid calendar timezone setting."]})
        result = {"status": status, "events_by_day": {}}
        _CACHE[key] = (now, result)
        return result
    events_by_day: dict[date, list[dict[str, Any]]] = {}
    errors: list[str] = []
    for source in sources:
        try:
            source_events = _load_source_events(
                source,
                start_day=start_day,
                end_day=end_day,
                tz=tz,
                work_keywords=list(settings["work_keywords"]),
                exclude_keywords=list(settings["exclude_keywords"]),
            )
        except Exception as exc:
            errors.append(_safe_error(source.label, exc))
            continue
        for event in source_events:
            event_day = date.fromisoformat(str(event["date"]))
            events_by_day.setdefault(event_day, []).append(event)

    for day_events in events_by_day.values():
        day_events.sort(key=lambda event: (event.get("start") or "00:00", event.get("title") or ""))
    status.update(
        {
            "last_fetch": datetime.now(tz).isoformat(timespec="seconds"),
            "event_count": sum(len(events) for events in events_by_day.values()),
            "errors": errors,
        }
    )
    result = {"status": status, "events_by_day": events_by_day}
    _CACHE[key] = (now, result)
    return result
