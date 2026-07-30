from __future__ import annotations

import hashlib
import hmac
import json
import logging
import os
import time
import urllib.error
import urllib.request
from datetime import date as Date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from scripts.time_blocks import (
    allocate_daily_plan,
    allocate_weekly_plan,
    parse_clock,
    parse_date,
    task_minutes,
    task_reason,
)
from scripts.calendar_feed import load_calendar_events_by_day
from scripts.seed_render_vault import calculate_drift, configured_path, repo_root, vault_manifest_path
from .github_sync import GitHubSyncError, GitHubSyncService, sync_files
from scripts.time_plan_context import build_agent_plan_context, read_time_planning_settings
from scripts.workbench_config import load_workbench_config, safe_ui_config
from scripts.workbench_paths import APP_ROOT, DASHBOARD_ROOT, DATA_ROOT
from .vault import ROOT as VAULT_ROOT, SaveConflictError, VaultError, VaultService


logger = logging.getLogger("pm.performance")
PERF_LOGS_ENABLED = os.environ.get("PM_PERF_LOGS", "").lower() in {"1", "true", "yes", "on"}
LAST_HOSTED_SERVICE_SUCCESS_AT: str | None = None
LAST_VAULT_SCAN_AT: str | None = None
LAST_MARKDOWN_SAVE_AT: str | None = None
if PERF_LOGS_ENABLED:
    logging.basicConfig(level=logging.INFO)
    logger.setLevel(logging.INFO)


def log_perf(event: str, **fields: Any) -> None:
    if not PERF_LOGS_ENABLED:
        return
    parts = " ".join(f"{key}={value}" for key, value in fields.items())
    logger.info("%s %s", event, parts)


class SaveFileRequest(BaseModel):
    path: str
    content: str
    current_modified_at: float | None = None
    move_to: str | None = None


class TaskMetadataPatchRequest(BaseModel):
    path: str
    updates: dict[str, Any]
    current_modified_at: float | None = None


class MetadataPatchRequest(BaseModel):
    path: str
    updates: dict[str, Any]
    current_modified_at: float | None = None


class CreateFileRequest(BaseModel):
    kind: str = "note"
    title: str
    directory: str | None = None


class GitHubSyncPushRequest(BaseModel):
    commit_message: str = ""
    dry_run: bool = True
    delete_missing: bool = False


class GitHubSyncResetRequest(BaseModel):
    backup: bool = True
    delete_extra: bool = False
    dry_run: bool = True


def get_service() -> VaultService:
    return VaultService(VAULT_ROOT)


def get_github_sync_service(service: VaultService = Depends(get_service)) -> GitHubSyncService:
    return GitHubSyncService(service.root)


def is_task_entry(entry: dict[str, Any]) -> bool:
    kind = str(entry.get("kind") or entry.get("type") or "").lower()
    return kind == "task" or str(entry.get("path") or "").startswith("tasks/")


def entry_properties(entry: dict[str, Any]) -> dict[str, Any]:
    return entry.get("properties") if isinstance(entry.get("properties"), dict) else {}


def normalized_token(value: Any) -> str:
    return str(value or "").strip().strip('"').strip("'").lower().replace("_", "-")


def project_id_for_entry(entry: dict[str, Any]) -> str:
    raw = entry.get("project") or entry.get("id")
    if raw:
        return str(raw).strip().strip('"').strip("'")
    path = str(entry.get("path") or "")
    parts = path.split("/")
    if len(parts) >= 2 and parts[0] == "projects":
        return parts[1]
    return ""


def domain_from_token(value: Any) -> str:
    token = normalized_token(value)
    return token if token in {"research", "admin", "teaching", "personal", "system", "archive", "other"} else ""


def build_project_time_metadata(entries: list[dict[str, Any]]) -> dict[str, dict[str, str]]:
    metadata: dict[str, dict[str, str]] = {}
    for entry in entries:
        kind = str(entry.get("kind") or entry.get("type") or "").lower()
        if kind != "project":
            continue
        project_id = project_id_for_entry(entry)
        if not project_id:
            continue
        properties = entry_properties(entry)
        domain = domain_from_token(entry.get("domain") or properties.get("domain"))
        area = domain_from_token(entry.get("area") or properties.get("area"))
        metadata[project_id] = {
            "domain": domain,
            "area": area,
        }
    return metadata


def infer_time_domain(entry: dict[str, Any], project_metadata: dict[str, dict[str, str]]) -> str:
    properties = entry_properties(entry)
    direct = domain_from_token(entry.get("domain") or properties.get("domain"))
    if direct:
        return direct
    area = domain_from_token(entry.get("area") or properties.get("area"))
    if area:
        return area

    project_id = project_id_for_entry(entry)
    project_meta = project_metadata.get(project_id, {})
    if project_meta.get("domain"):
        return project_meta["domain"]
    if project_meta.get("area"):
        return project_meta["area"]

    return "other"


def time_category_from_domain(domain: str) -> str:
    if domain == "research":
        return "research"
    if domain == "admin":
        return "admin"
    return "other"


def time_plan_task(entry: dict[str, Any], project_metadata: dict[str, dict[str, str]] | None = None) -> dict[str, Any]:
    project_metadata = project_metadata or {}
    properties = entry.get("properties") if isinstance(entry.get("properties"), dict) else {}
    domain = infer_time_domain(entry, project_metadata)
    time_category = normalized_token(properties.get("time_category") or entry.get("time_category")) or time_category_from_domain(domain)
    if time_category not in {"research", "admin", "other"}:
        time_category = time_category_from_domain(domain)
    return {
        "id": entry.get("id") or entry.get("path"),
        "path": entry.get("path", ""),
        "title": entry.get("title", ""),
        "project": entry.get("project", ""),
        "domain": domain,
        "time_category": time_category,
        "status": entry.get("status") or "open",
        "priority": entry.get("priority") or 9,
        "urgent": bool(entry.get("urgent") or properties.get("urgent")),
        "due": entry.get("due") or "",
        "deadline_type": entry.get("deadline_type") or properties.get("deadline_type") or "",
        "next": entry.get("next") or "",
        "estimate_minutes": properties.get("estimate_minutes", properties.get("duration_minutes", 60)),
        "block_day": properties.get("block_day", ""),
        "block_week": properties.get("block_week", ""),
        "time_block": properties.get("time_block", ""),
        "private": bool(entry.get("private")),
    }


def time_plan_project(entry: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": entry.get("id") or entry.get("project") or "",
        "name": entry.get("title") or entry.get("id") or entry.get("path") or "Untitled project",
        "title": entry.get("title") or "",
        "path": entry.get("path", ""),
        "status": entry.get("status", ""),
        "priority": entry.get("priority", ""),
        "deadline": entry.get("deadline") or entry.get("due") or entry.get("date") or "",
        "deadline_type": entry.get("deadline_type") or "",
        "next_action": entry.get("next") or entry.get("snippet") or "",
        "private": bool(entry.get("private")),
    }


def time_task_summary(task: dict[str, Any], target_day: Date, week_prefix: str) -> dict[str, Any]:
    minutes = task_minutes(task)
    payload = {
        "path": task.get("path", ""),
        "title": task.get("title", ""),
        "project": task.get("project", ""),
        "domain": task.get("domain", ""),
        "time_category": task.get("time_category", ""),
        "priority": str(task.get("priority", "")) if task.get("priority") is not None else "",
        "urgent": bool(task.get("urgent")),
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


def parse_plan_date(value: str | None, field: str, default: Date | None = None) -> Date:
    if not value:
        if default is not None:
            return default
        return Date.today()
    parsed = parse_date(value)
    if parsed is None:
        raise HTTPException(status_code=400, detail=f"Invalid {field}; expected YYYY-MM-DD")
    return parsed


def no_work_before_date(service: VaultService) -> Date | None:
    raw = read_time_planning_settings(service.root).get("no_work_before")
    if not raw:
        return None
    parsed = parse_date(raw)
    if parsed is None:
        return None
    return parsed


def calendar_fetch_range(target_day: Date, week_start_day: Date, weekdays: int) -> tuple[Date, Date]:
    start_day = min(target_day, week_start_day)
    end_day = max(target_day + timedelta(days=1), week_start_day + timedelta(days=weekdays + 14))
    return start_day, end_day


def markdown_block_kind(entry: dict[str, Any]) -> str:
    if is_task_entry(entry):
        return ""
    properties = entry_properties(entry)
    status = normalized_token(entry.get("status") or properties.get("status"))
    if status in {"cancelled", "canceled"}:
        return ""
    entry_type = normalized_token(entry.get("type") or properties.get("type"))
    entry_kind = normalized_token(entry.get("kind") or properties.get("kind"))
    if entry_type in {"conference", "travel"}:
        return entry_type
    if entry_kind in {"conference", "travel"}:
        return entry_kind
    return ""


def markdown_block_dates(entry: dict[str, Any], start_day: Date, end_day: Date) -> list[Date]:
    properties = entry_properties(entry)
    raw_start = (
        entry.get("start_date")
        or properties.get("start_date")
        or entry.get("date")
        or properties.get("date")
    )
    first_day = parse_date(raw_start)
    if first_day is None:
        return []
    raw_end = entry.get("end_date") or properties.get("end_date") or raw_start
    last_day = parse_date(raw_end) or first_day
    if last_day < first_day:
        last_day = first_day

    days: list[Date] = []
    current = max(first_day, start_day)
    final = min(last_day, end_day - timedelta(days=1))
    while current <= final:
        days.append(current)
        current += timedelta(days=1)
    return days


def markdown_calendar_blocks_by_day(entries: list[dict[str, Any]], start_day: Date, end_day: Date) -> dict[Date, list[dict[str, Any]]]:
    grouped: dict[Date, list[dict[str, Any]]] = {}
    for entry in entries:
        block_kind = markdown_block_kind(entry)
        if not block_kind:
            continue
        for block_day in markdown_block_dates(entry, start_day, end_day):
            grouped.setdefault(block_day, []).append(
                {
                    "title": entry.get("title") or entry.get("id") or "Blocked day",
                    "path": entry.get("path") or "",
                    "project": entry.get("project") or "",
                    "block_kind": block_kind,
                    "private": bool(entry.get("private")),
                }
            )

    events_by_day: dict[Date, list[dict[str, Any]]] = {}
    for block_day, items in grouped.items():
        items.sort(key=lambda item: (item["block_kind"], item["title"]))
        titles = [str(item["title"]) for item in items if item.get("title")]
        kinds = sorted({str(item["block_kind"]) for item in items if item.get("block_kind")})
        if len(titles) == 1:
            title = titles[0]
        else:
            title = f"{'/'.join(kinds).title()} day: {titles[0]} + {len(titles) - 1} more"
        reason = "travel day" if kinds == ["travel"] else "conference day" if kinds == ["conference"] else "conference/travel day"
        source_id = "|".join([block_day.isoformat(), *titles, *kinds])
        event_id = hashlib.sha256(source_id.encode("utf-8")).hexdigest()[:16]
        events_by_day[block_day] = [
            {
                "id": f"markdown-date-{event_id}",
                "path": items[0].get("path") or f"calendar:markdown:{block_day.isoformat()}",
                "title": title,
                "date": block_day.isoformat(),
                "source_label": "Markdown dates",
                "source_event_id": str(items[0].get("path") or ""),
                "all_day": True,
                "reason": reason,
                "private": any(bool(item.get("private")) for item in items),
            }
        ]
    return events_by_day


def merge_calendar_imports(calendar_import: dict[str, Any], markdown_events_by_day: dict[Date, list[dict[str, Any]]]) -> dict[str, Any]:
    imported_events = calendar_import.get("events_by_day") if isinstance(calendar_import.get("events_by_day"), dict) else {}
    events_by_day: dict[Date, list[dict[str, Any]]] = {
        day: list(events)
        for day, events in imported_events.items()
    }
    for day, events in markdown_events_by_day.items():
        events_by_day.setdefault(day, []).extend(events)
    for day_events in events_by_day.values():
        day_events.sort(key=lambda event: (event.get("start") or "00:00", event.get("title") or ""))

    status = dict(calendar_import.get("status") or {})
    markdown_event_count = sum(len(events) for events in markdown_events_by_day.values())
    labels = list(status.get("source_labels") or [])
    if markdown_event_count and "Markdown dates" not in labels:
        labels.append("Markdown dates")
    status.update(
        {
            "enabled": bool(status.get("enabled")) or markdown_event_count > 0,
            "event_count": int(status.get("event_count") or 0) + markdown_event_count,
            "source_labels": labels,
            "errors": list(status.get("errors") or []),
            "last_fetch": str(status.get("last_fetch") or ""),
        }
    )
    return {"status": status, "events_by_day": events_by_day}


def is_local_request(request: Request) -> bool:
    host = request.client.host if request.client else ""
    require_local_auth = os.environ.get("PM_REQUIRE_LOCAL_AUTH", "").strip().lower() in {"1", "true", "yes", "on"}
    return not require_local_auth and host in {"127.0.0.1", "::1", "localhost", "testclient"}


async def require_auth(
    request: Request,
    authorization: str | None = Header(default=None),
    x_pm_app_token: str | None = Header(default=None),
) -> None:
    if is_local_request(request):
        return
    expected = os.environ.get("PM_APP_TOKEN")
    if not expected:
        raise HTTPException(status_code=503, detail="PM_APP_TOKEN is required for non-local requests")
    supplied = x_pm_app_token
    if authorization and authorization.lower().startswith("bearer "):
        supplied = authorization.split(" ", 1)[1].strip()
    # Constant-time comparison so a timing side channel cannot reveal the token
    # byte-by-byte.
    if not supplied or not hmac.compare_digest(supplied, expected):
        raise HTTPException(status_code=401, detail="Invalid or missing app token")


app = FastAPI(title="Research Workbench", version="1.1.0")
configured_origins = [
    origin.strip()
    for origin in os.environ.get("PM_CORS_ORIGINS", "").split(",")
    if origin.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1:5173",
        "http://localhost:5173",
        "http://127.0.0.1:8765",
        "http://localhost:8765",
        *configured_origins,
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def log_request_timing(request: Request, call_next):
    started = time.perf_counter()
    response = await call_next(request)
    if request.url.path == "/dashboard" or request.url.path.startswith("/dashboard/"):
        response.headers["Cache-Control"] = "no-store, max-age=0"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    if PERF_LOGS_ENABLED and request.url.path.startswith("/api/"):
        elapsed_ms = round((time.perf_counter() - started) * 1000, 2)
        logger.info(
            "api.request method=%s path=%s status=%s elapsed_ms=%s",
            request.method,
            request.url.path,
            response.status_code,
            elapsed_ms,
        )
    return response


@app.get("/api/health")
async def health() -> dict[str, Any]:
    app_commit = (
        os.environ.get("RENDER_GIT_COMMIT")
        or os.environ.get("GIT_COMMIT")
        or os.environ.get("SOURCE_VERSION")
    )
    vault_exists = VAULT_ROOT.exists()
    payload: dict[str, Any] = {
        "ok": vault_exists,
        "vault_root_exists": vault_exists,
        "auth_configured": bool(os.environ.get("PM_APP_TOKEN")),
        "seed_configured": bool(os.environ.get("PM_VAULT_SEED_SOURCE")),
        "app_commit": app_commit,
        "vault_manifest_exists": vault_manifest_path(VAULT_ROOT).exists(),
    }
    if not vault_exists:
        payload["error"] = "Vault root does not exist"
    return payload


@app.get("/api/config", dependencies=[Depends(require_auth)])
async def config(service: VaultService = Depends(get_service)) -> dict[str, Any]:
    """Return display-safe configuration without filesystem paths or secrets."""
    return safe_ui_config(load_workbench_config(service.root))


def file_mtime(path: Path) -> float | None:
    try:
        return path.stat().st_mtime
    except OSError:
        return None


def short_vault_hash(root: Path) -> dict[str, Any]:
    digest = hashlib.sha256()
    files = sync_files(root)
    for raw_path in files:
        rel_path = Path(raw_path)
        path = rel_path if rel_path.is_absolute() else root / rel_path
        rel = rel_path.as_posix() if not rel_path.is_absolute() else path.relative_to(root).as_posix()
        digest.update(rel.encode("utf-8"))
        digest.update(b"\0")
        try:
            digest.update(path.read_bytes())
        except OSError:
            continue
        digest.update(b"\0")
    return {"algorithm": "sha256", "value": digest.hexdigest(), "file_count": len(files)}


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def mark_vault_scan() -> str:
    global LAST_VAULT_SCAN_AT
    LAST_VAULT_SCAN_AT = utc_now_iso()
    return LAST_VAULT_SCAN_AT


def mark_markdown_save() -> str:
    global LAST_MARKDOWN_SAVE_AT
    LAST_MARKDOWN_SAVE_AT = utc_now_iso()
    return LAST_MARKDOWN_SAVE_AT


def entry_counts(entries: list[dict[str, Any]]) -> dict[str, int]:
    return {
        "entries": len(entries),
        "tasks": sum(1 for entry in entries if entry.get("kind") == "task"),
        "projects": sum(1 for entry in entries if entry.get("kind") == "project"),
    }


def seed_manifest_status(root: Path) -> dict[str, Any]:
    path = vault_manifest_path(root)
    payload: dict[str, Any] = {
        "exists": path.exists(),
        "path": str(path),
        "generated_at": None,
        "mode": None,
        "seed_source": None,
        "app_commit": None,
        "counts": {},
        "error": "",
    }
    if not path.exists():
        return payload
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        payload["error"] = str(exc)
        return payload
    if not isinstance(raw, dict):
        payload["error"] = "Seed manifest is not a JSON object"
        return payload
    counts = raw.get("counts")
    payload.update(
        {
            "generated_at": raw.get("generated_at"),
            "mode": raw.get("mode"),
            "seed_source": raw.get("seed_source"),
            "app_commit": raw.get("app_commit"),
            "counts": counts if isinstance(counts, dict) else {},
        }
    )
    return payload


def generated_cache_freshness(root: Path) -> dict[str, Any]:
    source_files = sync_files(root)
    newest_source = max(
        (file_mtime(path if (path := Path(raw_path)).is_absolute() else root / path) or 0 for raw_path in source_files),
        default=0,
    )
    generated_paths = [
        DATA_ROOT / "projects.json",
        DATA_ROOT / "tasks.json",
        DATA_ROOT / "vault_entries.json",
        DATA_ROOT / "relationships.json",
        DASHBOARD_ROOT / "boards.html",
        DASHBOARD_ROOT / "calendar.html",
        DASHBOARD_ROOT / "graph.html",
        DASHBOARD_ROOT / "index.html",
        DASHBOARD_ROOT / "public.html",
        DASHBOARD_ROOT / "status.html",
        DASHBOARD_ROOT / "today.html",
    ]
    files = []
    stale = False
    for path in generated_paths:
        mtime = file_mtime(path)
        fresh = bool(mtime and (not newest_source or mtime >= newest_source))
        if not fresh:
            stale = True
        files.append(
            {
                "path": path.relative_to(DATA_ROOT.parent).as_posix(),
                "exists": mtime is not None,
                "modified_at": mtime,
                "fresh": fresh,
            }
        )
    return {
        "fresh": not stale,
        "source_file_count": len(source_files),
        "newest_source_modified_at": newest_source or None,
        "files": files,
    }


def hosted_service_check_url() -> str:
    exact = os.environ.get("PM_PUBLIC_DASHBOARD_URL") or os.environ.get("PM_HOSTED_HEALTH_URL")
    if exact:
        return exact
    base = os.environ.get("PM_SELF_HOSTED_URL") or os.environ.get("PM_RENDER_SERVICE_URL") or os.environ.get("RENDER_EXTERNAL_URL")
    if not base:
        return ""
    return f"{base.rstrip('/')}/api/health"


def hosted_service_availability() -> dict[str, Any]:
    global LAST_HOSTED_SERVICE_SUCCESS_AT

    url = hosted_service_check_url()
    checked_at = datetime.now(timezone.utc).isoformat()
    if not url:
        return {
            "configured": False,
            "url": "",
            "checked_at": checked_at,
            "ok": None,
            "status_code": None,
            "last_success_at": LAST_HOSTED_SERVICE_SUCCESS_AT,
            "error": "Set PM_HOSTED_HEALTH_URL or PM_SELF_HOSTED_URL to enable live checks.",
        }

    try:
        request = urllib.request.Request(url, headers={"User-Agent": "research-workbench-diagnostics"})
        with urllib.request.urlopen(request, timeout=2) as response:
            status_code = int(response.getcode())
        ok = 200 <= status_code < 400
        if ok:
            LAST_HOSTED_SERVICE_SUCCESS_AT = checked_at
        return {
            "configured": True,
            "url": url,
            "checked_at": checked_at,
            "ok": ok,
            "status_code": status_code,
            "last_success_at": LAST_HOSTED_SERVICE_SUCCESS_AT,
            "error": "" if ok else f"HTTP {status_code}",
        }
    except urllib.error.HTTPError as exc:
        return {
            "configured": True,
            "url": url,
            "checked_at": checked_at,
            "ok": False,
            "status_code": int(exc.code),
            "last_success_at": LAST_HOSTED_SERVICE_SUCCESS_AT,
            "error": f"HTTP {exc.code}",
        }
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        return {
            "configured": True,
            "url": url,
            "checked_at": checked_at,
            "ok": False,
            "status_code": None,
            "last_success_at": LAST_HOSTED_SERVICE_SUCCESS_AT,
            "error": str(exc),
        }


@app.get("/api/diagnostics", dependencies=[Depends(require_auth)])
async def diagnostics(
    service: VaultService = Depends(get_service),
    sync: GitHubSyncService = Depends(get_github_sync_service),
) -> dict[str, Any]:
    health_payload = await health()
    sync_payload = sync.status()
    actions = sync_payload.get("actions") if isinstance(sync_payload.get("actions"), dict) else {}
    entries = service.scan_entries()
    scan_at = mark_vault_scan()
    return {
        "app_commit": health_payload.get("app_commit"),
        "vault_root": str(service.root),
        "vault_hash": short_vault_hash(service.root),
        "entry_counts": entry_counts(entries),
        "last_vault_scan_at": scan_at,
        "last_markdown_save_at": LAST_MARKDOWN_SAVE_AT,
        "seed": seed_manifest_status(service.root),
        "generated_cache": generated_cache_freshness(service.root),
        "hosted_service": hosted_service_availability(),
        "github_sync": {
            "enabled": sync_payload.get("enabled"),
            "configured": sync_payload.get("configured"),
            "token_configured": sync_payload.get("token_configured"),
            "git_available": sync_payload.get("git_available"),
            "repo": sync_payload.get("repo"),
            "branch": sync_payload.get("branch"),
            "remote_head": sync_payload.get("remote_head"),
            "vault_file_count": sync_payload.get("vault_file_count"),
            "errors": sync_payload.get("errors") or [],
        },
        "actions": {
            "latest": actions.get("latest"),
            "errors": actions.get("errors") or [],
        },
    }


@app.get("/api/vault/drift", dependencies=[Depends(require_auth)])
async def vault_drift(
    include_paths: bool = Query(default=False),
    service: VaultService = Depends(get_service),
) -> dict[str, Any]:
    source = configured_path("PM_VAULT_SEED_SOURCE", repo_root())
    if source is None or not source.exists():
        raise HTTPException(status_code=400, detail=f"Seed source does not exist: {source}")
    drift = calculate_drift(source, service.root, include_paths=include_paths)
    drift["seed_source"] = str(source)
    drift["vault_root"] = str(service.root)
    drift["vault_manifest_exists"] = vault_manifest_path(service.root).exists()
    return drift


@app.get("/api/vault/entries", dependencies=[Depends(require_auth)])
async def entries(service: VaultService = Depends(get_service)) -> dict[str, Any]:
    entries_payload = service.scan_entries()
    mark_vault_scan()
    return {"entries": entries_payload}


@app.get("/api/scholar", dependencies=[Depends(require_auth)])
async def scholar(service: VaultService = Depends(get_service)) -> dict[str, Any]:
    """Serve the optional scholar-statistics snapshot configured by the vault.

    The workbench reads a stored snapshot rather than scraping any external
    profile. The configured path must remain inside the active vault.
    """
    workbench_config = load_workbench_config(service.root)
    profile = workbench_config.get("profile") if isinstance(workbench_config.get("profile"), dict) else {}
    relative_source = str(profile.get("scholar_statistics_source") or "").strip()
    if not relative_source:
        return {"available": False}
    snapshot = (service.root / relative_source).resolve()
    try:
        snapshot.relative_to(service.root)
    except ValueError:
        return {"available": False}
    if not snapshot.exists():
        return {"available": False}
    try:
        data = json.loads(snapshot.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"available": False}
    if not isinstance(data, dict):
        return {"available": False}
    data["available"] = True
    return data


@app.get("/api/vault/file", dependencies=[Depends(require_auth)])
async def file(
    path: str = Query(..., min_length=1),
    service: VaultService = Depends(get_service),
) -> dict[str, Any]:
    try:
        return service.get_file(path)
    except VaultError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="File not found") from exc


@app.put("/api/vault/file", dependencies=[Depends(require_auth)])
async def save_file(
    payload: SaveFileRequest,
    service: VaultService = Depends(get_service),
) -> dict[str, Any]:
    try:
        result = service.save_file(payload.path, payload.content, payload.current_modified_at, payload.move_to)
        mark_markdown_save()
        return result
    except SaveConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except VaultError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.patch("/api/vault/task-metadata", dependencies=[Depends(require_auth)])
async def patch_task_metadata(
    payload: TaskMetadataPatchRequest,
    service: VaultService = Depends(get_service),
) -> dict[str, Any]:
    try:
        result = service.patch_task_metadata(payload.path, payload.updates, payload.current_modified_at)
        mark_markdown_save()
        return result
    except SaveConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except VaultError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.patch("/api/vault/metadata", dependencies=[Depends(require_auth)])
async def patch_metadata(
    payload: MetadataPatchRequest,
    service: VaultService = Depends(get_service),
) -> dict[str, Any]:
    try:
        result = service.patch_metadata(payload.path, payload.updates, payload.current_modified_at)
        mark_markdown_save()
        return result
    except SaveConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except VaultError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/vault/reload", dependencies=[Depends(require_auth)])
async def reload_vault(service: VaultService = Depends(get_service)) -> dict[str, Any]:
    service.invalidate_scan_cache()
    entries_payload = service.scan_entries(force=True)
    mark_vault_scan()
    return {"entries": entries_payload}


@app.post("/api/vault/create", dependencies=[Depends(require_auth)])
async def create_file(
    payload: CreateFileRequest,
    service: VaultService = Depends(get_service),
) -> dict[str, Any]:
    try:
        result = service.create_file(payload.kind, payload.title, payload.directory)
        mark_markdown_save()
        return result
    except VaultError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/git/status", dependencies=[Depends(require_auth)])
async def git_status(service: VaultService = Depends(get_service)) -> dict[str, Any]:
    return service.git_status()


@app.get("/api/github-sync/status", dependencies=[Depends(require_auth)])
async def github_sync_status(sync: GitHubSyncService = Depends(get_github_sync_service)) -> dict[str, Any]:
    return sync.status()


@app.post("/api/github-sync/push", dependencies=[Depends(require_auth)])
async def github_sync_push(
    payload: GitHubSyncPushRequest,
    sync: GitHubSyncService = Depends(get_github_sync_service),
) -> dict[str, Any]:
    try:
        return sync.push(payload.commit_message, dry_run=payload.dry_run, delete_missing=payload.delete_missing)
    except GitHubSyncError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/github-sync/reset-from-github", dependencies=[Depends(require_auth)])
async def github_sync_reset_from_github(
    payload: GitHubSyncResetRequest,
    service: VaultService = Depends(get_service),
    sync: GitHubSyncService = Depends(get_github_sync_service),
) -> dict[str, Any]:
    try:
        result = sync.reset_from_github(
            backup=payload.backup,
            delete_extra=payload.delete_extra,
            dry_run=payload.dry_run,
        )
        if not payload.dry_run:
            service.invalidate_scan_cache()
        return result
    except GitHubSyncError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/time-plan", dependencies=[Depends(require_auth)])
async def time_plan(
    date_value: str | None = Query(default=None, alias="date"),
    week_start: str | None = Query(default=None),
    start: str = Query(default="09:00"),
    capacity_minutes: int = Query(default=420, ge=1, le=1440),
    weekdays: int = Query(default=5, ge=1, le=14),
    horizon_days: int = Query(default=14, ge=0, le=365),
    service: VaultService = Depends(get_service),
) -> dict[str, Any]:
    target_day = parse_plan_date(date_value, "date")
    week_start_day = parse_plan_date(week_start, "week_start", target_day)
    week_prefix = week_start_day.isoformat()[:8]
    try:
        parse_clock(start)
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid start; expected HH:MM") from exc

    endpoint_started = time.perf_counter()
    entries = service.scan_entries()
    project_time_metadata = build_project_time_metadata(entries)
    tasks = [time_plan_task(entry, project_time_metadata) for entry in entries if is_task_entry(entry)]
    no_work_before = no_work_before_date(service)
    calendar_start, calendar_end = calendar_fetch_range(target_day, week_start_day, weekdays)
    calendar_started = time.perf_counter()
    calendar_import = load_calendar_events_by_day(service.root, calendar_start, calendar_end)
    markdown_calendar_events = markdown_calendar_blocks_by_day(entries, calendar_start, calendar_end)
    calendar_import = merge_calendar_imports(calendar_import, markdown_calendar_events)
    calendar_events_by_day = calendar_import["events_by_day"]
    calendar_ms = round((time.perf_counter() - calendar_started) * 1000, 2)
    try:
        allocation_started = time.perf_counter()
        daily_blocks, daily_overflow = allocate_daily_plan(
            tasks,
            target_day,
            start=start,
            capacity_minutes=capacity_minutes,
            horizon_days=horizon_days,
            week_prefix=week_prefix,
            no_work_before=no_work_before,
            calendar_events=calendar_events_by_day.get(target_day, []),
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
        allocation_ms = round((time.perf_counter() - allocation_started) * 1000, 2)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    log_perf(
        "time_plan.build",
        entries=len(entries),
        tasks=len(tasks),
        calendar_ms=calendar_ms,
        allocation_ms=allocation_ms,
        elapsed_ms=round((time.perf_counter() - endpoint_started) * 1000, 2),
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
        "calendar": calendar_import["status"],
    }


@app.get("/api/time-plan/agent-context", dependencies=[Depends(require_auth)])
async def time_plan_agent_context(
    date_value: str | None = Query(default=None, alias="date"),
    week_start: str | None = Query(default=None),
    start: str = Query(default="09:00"),
    capacity_minutes: int = Query(default=420, ge=1, le=1440),
    weekdays: int = Query(default=5, ge=1, le=14),
    horizon_days: int = Query(default=14, ge=0, le=365),
    ad_hoc: str = Query(default=""),
    include_private: bool = Query(default=False),
    service: VaultService = Depends(get_service),
) -> dict[str, Any]:
    target_day = parse_plan_date(date_value, "date")
    week_start_day = parse_plan_date(week_start, "week_start", target_day)
    week_prefix = week_start_day.isoformat()[:8]
    try:
        parse_clock(start)
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid start; expected HH:MM") from exc

    endpoint_started = time.perf_counter()
    entries = service.scan_entries()
    project_time_metadata = build_project_time_metadata(entries)
    tasks = [time_plan_task(entry, project_time_metadata) for entry in entries if is_task_entry(entry)]
    calendar_start, calendar_end = calendar_fetch_range(target_day, week_start_day, weekdays)
    calendar_started = time.perf_counter()
    calendar_import = load_calendar_events_by_day(service.root, calendar_start, calendar_end)
    markdown_calendar_events = markdown_calendar_blocks_by_day(entries, calendar_start, calendar_end)
    calendar_import = merge_calendar_imports(calendar_import, markdown_calendar_events)
    calendar_ms = round((time.perf_counter() - calendar_started) * 1000, 2)
    projects = [
        time_plan_project(entry)
        for entry in entries
        if str(entry.get("kind") or entry.get("type") or "").lower() == "project"
    ]
    try:
        context_started = time.perf_counter()
        context = build_agent_plan_context(
            root=service.root,
            tasks=tasks,
            projects=projects,
            target_day=target_day,
            week_start_day=week_start_day,
            start=start,
            capacity_minutes=capacity_minutes,
            weekdays=weekdays,
            horizon_days=horizon_days,
            week_prefix=week_prefix,
            ad_hoc=ad_hoc,
            include_private=include_private,
            calendar_events_by_day=calendar_import["events_by_day"],
            calendar_status=calendar_import["status"],
        )
        log_perf(
            "time_plan.agent_context",
            entries=len(entries),
            tasks=len(tasks),
            projects=len(projects),
            calendar_ms=calendar_ms,
            context_ms=round((time.perf_counter() - context_started) * 1000, 2),
            elapsed_ms=round((time.perf_counter() - endpoint_started) * 1000, 2),
        )
        return context
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


DIST = APP_ROOT / "web" / "dist"

if DASHBOARD_ROOT.exists():
    app.mount("/dashboard", StaticFiles(directory=DASHBOARD_ROOT, html=True), name="dashboard")

if DIST.exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def serve_app(full_path: str):
        # Never serve the SPA shell for an unknown API path: returning index.html
        # with HTTP 200 masks bugs and breaks JSON clients. 404 instead.
        if full_path == "api" or full_path.startswith("api/"):
            return JSONResponse({"detail": "Not found"}, status_code=404)
        requested = (DIST / full_path).resolve()
        try:
            requested.relative_to(DIST.resolve())
        except ValueError:
            requested = DIST / "index.html"
        if requested.is_file():
            return FileResponse(requested)
        return FileResponse(DIST / "index.html")
