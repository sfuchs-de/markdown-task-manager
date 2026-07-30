from __future__ import annotations

import json
import logging
import os
import re
import subprocess
import tempfile
import time
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from threading import RLock
from typing import Any, ClassVar

import yaml

from scripts.vault_parsing import (  # shared frontmatter/body primitives
    CODEX_INSTRUCTION_ITEM_RE,
    CODEX_INSTRUCTIONS_HEADING_RE,
    H1_RE,
    STRUCTURED_PROPERTY_FIELDS,
    WIKILINK_RE,
    extract_codex_instructions,
    extract_title,
    json_safe,
    listify,
    scalar,
    snippet,
    split_frontmatter,
    wikilinks_from_value,
    word_count,
)


APP_ROOT = Path(__file__).resolve().parents[1]
ROOT = Path(os.environ.get("PM_VAULT_ROOT", APP_ROOT / "vault")).expanduser().resolve()

# Server-specific: parse_file promotes assignee/assigned_to/domain to top-level
# entry fields, so they are core here. See scripts/vault_parsing.py for why this
# is intentionally NOT shared with the CLI reader's CORE_FIELDS.
CORE_FIELDS = {
    "title", "type", "kind", "status", "icon", "url", "date", "start_date", "end_date",
    "goal", "result", "Workspace", "workspace", "belongs_to", "related_to", "has",
    "aliases", "project", "domain", "id", "priority", "due", "deadline_type", "next",
    "area", "dashboard", "private", "source", "energy", "deadline", "last_touched",
    "lead", "owner", "assignee", "assigned_to", "urgent",
}


TASK_METADATA_FIELDS = {"status", "priority", "urgent", "due", "deadline_type", "project", "estimate_minutes", "assignee"}
TASK_STATUSES = {"open", "active", "waiting", "blocked", "done", "cancelled", "archived"}
TASK_COCKPIT_FIELDS = {
    "status",
    "priority",
    "urgent",
    "due",
    "deadline_type",
    "project",
    "estimate_minutes",
    "next",
    "block_day",
    "block_week",
    "time_block",
    "belongs_to",
    "related_to",
    "has",
    "energy",
    "assignee",
}
PROJECT_COCKPIT_FIELDS = {
    "status",
    "priority",
    "deadline",
    "deadline_type",
    "area",
    "lead",
    "energy",
    "next_action",
    "last_touched",
    "dashboard",
}
NOTE_COCKPIT_FIELDS = {"project", "area", "domain", "date", "private"}

EXCLUDED_DIRS = {
    ".git",
    ".github",
    ".venv",
    "__pycache__",
    ".pytest_cache",
    ".mypy_cache",
    ".ruff_cache",
    ".cache",
    "node_modules",
    "dist",
    "data",
    "dashboard",
    "private",
    "imports",
    "local_data",
    "large_data",
}

EXCLUDED_PREFIXES = {
    "exports/private",
    "areas/health/private",
    "areas/health/imports",
    "web/node_modules",
    "web/dist",
    "web/.tmp",
    "web/fixtures",
    "web/test-results",
    "web/playwright-report",
}

TEXT_EXTENSIONS = {".md", ".markdown"}
TASK_LIFECYCLE_DIRS = {"tasks/active", "tasks/waiting", "tasks/done"}
TASK_LIFECYCLE_CLOSED_STATUSES = {"done", "cancelled", "archived"}
TASK_LIFECYCLE_ACTIVE_STATUSES = {"open", "active", "blocked"}

PROJECT_NOTE_ROLES = {
    "README.md": ("project", "project-overview"),
    "status.md": ("project-status", "project-status"),
    "paper_status.md": ("paper-status", "paper-status"),
    "project_status.md": ("project-status", "project-status"),
    "next.md": ("project-note", "next-actions"),
    "progress.md": ("project-note", "progress-log"),
    "linked_sources.md": ("project-note", "linked-sources"),
    "decision_log.md": ("project-note", "decision-log"),
    "questions.md": ("project-note", "open-questions"),
    "scratch.md": ("project-note", "scratch"),
    "source_inventory.md": ("project-note", "source-inventory"),
}

PROJECT_FOLDER_KINDS = {
    "meetings": ("meeting-note", "meeting"),
    "feedback": ("feedback-note", "feedback"),
    "modeling": ("model-note", "modeling"),
    "empirics": ("result-note", "empirics"),
    "data": ("data-note", "data"),
    "code-runs": ("code-run-log", "code-run"),
    "writing": ("writing-note", "writing"),
    "presentations": ("presentation-note", "presentation"),
    "revisions": ("revision-matrix", "revision"),
    "sources": ("source-note", "source"),
    "notes/literature": ("literature-note", "literature"),
    "notes/ideas": ("idea-note", "idea"),
    "notes/technical": ("technical-note", "technical"),
    "notes/procedural": ("procedural-note", "procedural"),
    "notes": ("project-note", "note"),
    "ra": ("ra-status", "ra"),
}


class VaultError(ValueError):
    pass


class SaveConflictError(VaultError):
    pass


logger = logging.getLogger("pm.performance")
PERF_LOGS_ENABLED = os.environ.get("PM_PERF_LOGS", "").lower() in {"1", "true", "yes", "on"}
if PERF_LOGS_ENABLED:
    logging.basicConfig(level=logging.INFO)
    logger.setLevel(logging.INFO)


def log_perf(event: str, **fields: Any) -> None:
    if not PERF_LOGS_ENABLED:
        return
    parts = " ".join(f"{key}={value}" for key, value in fields.items())
    logger.info("%s %s", event, parts)


@dataclass
class ParsedEntryCache:
    signatures: dict[str, tuple[int, int]]
    parsed_entries: dict[str, dict[str, Any]]
    linked_entries: list[dict[str, Any]]


ENTRY_LIST_FIELDS = {
    "aliases",
    "belongs_to",
    "related_to",
    "has",
    "outgoing_links",
    "backlinks",
}
ENTRY_DICT_FIELDS = {
    "properties",
    "system_properties",
}


def entry_response_copy(entry: dict[str, Any]) -> dict[str, Any]:
    copied = entry.copy()
    for key in ENTRY_LIST_FIELDS:
        value = copied.get(key)
        if isinstance(value, list):
            copied[key] = list(value)
    relationships = copied.get("relationships")
    if isinstance(relationships, dict):
        copied["relationships"] = {
            str(key): list(value) if isinstance(value, list) else value
            for key, value in relationships.items()
        }
    for key in ENTRY_DICT_FIELDS:
        value = copied.get(key)
        if isinstance(value, dict):
            copied[key] = json_safe(value)
    return copied


def entries_response_copy(entries: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [entry_response_copy(entry) for entry in entries]


def slugify(value: str) -> str:
    slug = re.sub(r"[^A-Za-z0-9]+", "-", value.strip().lower()).strip("-")
    return slug or "untitled"


def serialize_frontmatter(frontmatter: dict[str, Any]) -> str:
    dumped = yaml.safe_dump(frontmatter, sort_keys=False, allow_unicode=False).strip()
    return f"---\n{dumped}\n---\n"


def replace_frontmatter(text: str, frontmatter: dict[str, Any]) -> str:
    serialized = serialize_frontmatter(frontmatter)
    if not (text.startswith("---\n") or text.startswith("---\r\n")):
        return f"{serialized}{text}"
    lines = text.splitlines(keepends=True)
    for i in range(1, len(lines)):
        if lines[i].strip() == "---":
            return f"{serialized}{''.join(lines[i + 1:])}"
    return f"{serialized}{text}"


def format_frontmatter_scalar(value: Any) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return str(value)
    text = str(value)
    if not text:
        return '""'
    # Defer scalar quoting to PyYAML so any value round-trips back to the same
    # string. A hand-rolled allow-list previously emitted ":" / "@" / "yes" / "null"
    # unquoted, producing invalid or type-coerced YAML that silently dropped the
    # whole frontmatter block on the next read (split_frontmatter swallows errors).
    dumped = yaml.safe_dump(text, default_flow_style=True, allow_unicode=False).rstrip()
    if dumped.endswith("\n..."):
        dumped = dumped[:-4].rstrip()
    if "\n" in dumped:
        # Block/multi-line scalar can't be written by the line-based patcher;
        # fall back to a single-line JSON (valid YAML double-quoted) form.
        return json.dumps(text, ensure_ascii=True)
    return dumped


def patch_frontmatter_scalars(text: str, updates: dict[str, Any]) -> str:
    rendered = {key: format_frontmatter_scalar(value) for key, value in updates.items() if value is not None}
    removals = {key for key, value in updates.items() if value is None}
    if not (text.startswith("---\n") or text.startswith("---\r\n")):
        lines = [f"{key}: {value}\n" for key, value in rendered.items()]
        return f"---\n{''.join(lines)}---\n{text}"

    lines = text.splitlines(keepends=True)
    end = None
    for i in range(1, len(lines)):
        if lines[i].strip() == "---":
            end = i
            break
    if end is None:
        lines = [f"{key}: {value}\n" for key, value in rendered.items()]
        return f"---\n{''.join(lines)}---\n{text}"

    changed: set[str] = set()
    next_frontmatter: list[str] = []
    i = 1
    while i < end:
        line = lines[i]
        match = re.match(r"^([A-Za-z0-9_ -]+):(?:\s.*)?$", line)
        if not match:
            next_frontmatter.append(line)
            i += 1
            continue
        key = match.group(1).strip()
        if key in rendered or key in removals:
            changed.add(key)
            i += 1
            while i < end and (lines[i].startswith((" ", "\t")) or not re.match(r"^([A-Za-z0-9_ -]+):(?:\s.*)?$", lines[i])):
                i += 1
            if key in rendered:
                next_frontmatter.append(f"{key}: {rendered[key]}\n")
            continue
        next_frontmatter.append(line)
        i += 1

    for key, value in rendered.items():
        if key not in changed:
            next_frontmatter.append(f"{key}: {value}\n")
    return "".join([lines[0], *next_frontmatter, *lines[end:]])


def is_truthy(value: Any) -> bool:
    return bool(value) and str(value).lower() not in {"false", "0", "no", "none"}


def normalize_task_metadata_update(key: str, value: Any) -> Any:
    if key not in TASK_METADATA_FIELDS:
        raise VaultError(f"Task metadata field is not editable: {key}")
    text = "" if value is None else str(value).strip()
    if key == "status":
        if not text:
            raise VaultError("Task status is required")
        normalized = text.lower()
        if normalized not in TASK_STATUSES:
            raise VaultError(f"Unsupported task status: {text}")
        return normalized
    if not text:
        return None
    if key == "priority":
        if text not in {"1", "2", "3", "4"}:
            raise VaultError("Task priority must be blank or 1-4")
        return int(text)
    if key == "urgent":
        normalized = text.lower()
        if normalized in {"true", "1", "yes", "urgent"}:
            return True
        if normalized in {"false", "0", "no", "off"}:
            return False
        raise VaultError("Task urgent must be blank, true, or false")
    if key == "due":
        if not re.match(r"^\d{4}-\d{2}-\d{2}$", text):
            raise VaultError("Task due date must be blank or YYYY-MM-DD")
        return text
    if key == "deadline_type":
        normalized = text.lower()
        if normalized not in {"hard", "soft"}:
            raise VaultError("Task deadline_type must be blank, hard, or soft")
        return normalized
    if key == "estimate_minutes":
        try:
            minutes = int(text)
        except ValueError as exc:
            raise VaultError("Task estimate_minutes must be blank or a whole number") from exc
        if minutes < 1 or minutes > 1440:
            raise VaultError("Task estimate_minutes must be between 1 and 1440")
        return minutes
    return text


def task_lifecycle_destination(rel_path: str, status: str) -> str | None:
    if not rel_path.startswith("tasks/"):
        return None
    filename = Path(rel_path).name
    if not filename:
        return None
    normalized = status.strip().lower()
    folder = ""
    if normalized in TASK_LIFECYCLE_CLOSED_STATUSES:
        folder = "tasks/done"
    elif normalized == "waiting":
        folder = "tasks/waiting"
    elif normalized in TASK_LIFECYCLE_ACTIVE_STATUSES:
        folder = "tasks/active"
    if not folder:
        return None
    target = f"{folder}/{filename}"
    return None if target == rel_path else target


def entry_cockpit_kind(entry: dict[str, Any]) -> str:
    kind = str(entry.get("kind") or entry.get("type") or "").lower()
    path = str(entry.get("path") or "")
    if kind == "task" or path.startswith("tasks/"):
        return "task"
    if kind == "project" or (path.startswith("projects/") and path.endswith("/README.md")):
        return "project"
    return "note"


def allowed_metadata_fields(kind: str) -> set[str]:
    if kind == "task":
        return TASK_COCKPIT_FIELDS
    if kind == "project":
        return PROJECT_COCKPIT_FIELDS
    return NOTE_COCKPIT_FIELDS


def normalize_date_field(key: str, text: str) -> str:
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", text):
        raise VaultError(f"{key} must be blank or YYYY-MM-DD")
    return text


def normalize_metadata_update(kind: str, key: str, value: Any) -> Any:
    allowed = allowed_metadata_fields(kind)
    if key not in allowed:
        raise VaultError(f"{kind.title()} metadata field is not editable: {key}")

    text = "" if value is None else str(value).strip()
    if key == "status" and kind == "task":
        if not text:
            raise VaultError("Task status is required")
        normalized = text.lower()
        if normalized not in TASK_STATUSES:
            raise VaultError(f"Unsupported task status: {text}")
        return normalized
    if not text:
        return None
    if key == "priority":
        if text not in {"1", "2", "3", "4"}:
            raise VaultError("Priority must be blank or 1-4")
        return int(text)
    if key == "urgent":
        normalized = text.lower()
        if normalized in {"true", "1", "yes", "urgent"}:
            return True
        if normalized in {"false", "0", "no", "off"}:
            return False
        raise VaultError("urgent must be blank, true, or false")
    if key == "estimate_minutes":
        try:
            minutes = int(text)
        except ValueError as exc:
            raise VaultError("estimate_minutes must be blank or a whole number") from exc
        if minutes < 1 or minutes > 1440:
            raise VaultError("estimate_minutes must be between 1 and 1440")
        return minutes
    if key in {"due", "date", "deadline", "last_touched", "block_day"}:
        return normalize_date_field(key, text)
    if key == "deadline_type":
        normalized = text.lower()
        if normalized not in {"hard", "soft"}:
            raise VaultError("deadline_type must be blank, hard, or soft")
        return normalized
    if key == "block_week":
        if not re.match(r"^\d{4}-\d{2}-?$", text):
            raise VaultError("block_week must be blank, YYYY-MM, or YYYY-MM-")
        return text if text.endswith("-") else f"{text}-"
    if key in {"private", "dashboard"}:
        normalized = text.lower()
        if normalized in {"true", "1", "yes"}:
            return True
        if normalized in {"false", "0", "no"}:
            return False
        raise VaultError(f"{key} must be true or false")
    return text


def is_excluded(path: Path, root: Path) -> bool:
    try:
        rel = path.relative_to(root).as_posix()
        parts = path.relative_to(root).parts
    except Exception:
        return True
    if path.name.startswith(".") and path.name not in {".gitkeep"}:
        return True
    if any(part.startswith(".") for part in parts[:-1]):
        return True
    if any(part in EXCLUDED_DIRS for part in parts):
        return True
    return any(rel == prefix or rel.startswith(prefix + "/") for prefix in EXCLUDED_PREFIXES)


def normalize_link_target(value: str) -> str:
    return slugify(value.replace(".md", "").replace(".markdown", ""))


def collection_from_path(rel: str) -> str:
    first = rel.split("/", 1)[0]
    if first == "projects":
        return "project"
    if first == "areas":
        return "area"
    if first == "tasks":
        return "task"
    if first == "dates":
        return "calendar"
    if first == "_inbox":
        return "inbox"
    if first in {"docs", "templates", "journal", "notes", "sources", "visuals", "codex", "archive"}:
        return first
    return "root"


def infer_area(rel: str) -> str | None:
    parts = rel.split("/")
    if len(parts) >= 2 and parts[0] == "areas":
        return parts[1]
    return None


def infer_project(rel: str) -> str | None:
    parts = rel.split("/")
    if len(parts) >= 2 and parts[0] == "projects":
        return parts[1]
    return None


def infer_kind_and_role(rel: str, filename: str) -> tuple[str | None, str | None]:
    parts = rel.split("/")
    if parts[0] == "tasks":
        if filename == "README.md":
            return "documentation", "task-list"
        return "task", "task"
    if parts[0] == "dates":
        if filename == "README.md":
            return "documentation", "calendar-index"
        return "event", "event"
    if parts[0] == "templates":
        return "template", "template"
    if parts[0] == "docs":
        return "documentation", "documentation"
    if parts[0] == "journal":
        return "journal-note", "journal"
    if parts[0] == "notes":
        return "note", "note"
    if parts[0] == "_inbox":
        return "inbox-note", "inbox"
    if parts[0] == "sources":
        return "source-note", "source"
    if parts[0] == "visuals":
        return "visual-note", "visual"
    if parts[0] == "codex":
        return "codex-note", "codex"
    if parts[0] == "areas":
        if filename in {"README.md", "status.md"}:
            return "area-status", "area-status"
        return "area-note", "area-note"
    if len(parts) >= 2 and parts[0] == "projects":
        project_rel = parts[2:]
        if len(project_rel) == 1 and filename in PROJECT_NOTE_ROLES:
            return PROJECT_NOTE_ROLES[filename]
        subpath = "/".join(parts[2:-1])
        for prefix, value in PROJECT_FOLDER_KINDS.items():
            if subpath == prefix or subpath.startswith(prefix + "/"):
                if filename == "README.md":
                    return "documentation", f"{value[1]}-index"
                return value
        if filename == "README.md":
            return "documentation", "project-section-index"
        return "project-note", "project-note"
    if filename in {"README.md", "START_HERE.md", "AGENTS.md", "OPENCLAW.md", "GEMINI.md", "CLAUDE.md"}:
        return "documentation", "documentation"
    return None, None


@dataclass
class VaultService:
    root: Path = ROOT
    _scan_cache: ClassVar[dict[str, ParsedEntryCache]] = {}
    _scan_cache_lock: ClassVar[RLock] = RLock()

    def __post_init__(self) -> None:
        self.root = self.root.resolve()

    def relpath(self, path: Path) -> str:
        return path.relative_to(self.root).as_posix()

    def resolve_markdown_path(self, rel_path: str) -> Path:
        if not rel_path or "\x00" in rel_path:
            raise VaultError("Invalid path")
        candidate = (self.root / rel_path).resolve()
        try:
            candidate.relative_to(self.root)
        except ValueError as exc:
            raise VaultError("Path must stay inside the vault") from exc
        if candidate.suffix.lower() not in TEXT_EXTENSIONS:
            raise VaultError("Only Markdown files are editable")
        if is_excluded(candidate, self.root):
            raise VaultError("Path is excluded from hosted editing")
        return candidate

    def resolve_task_lifecycle_destination(self, rel_path: str) -> Path:
        destination = self.resolve_markdown_path(rel_path)
        rel = self.relpath(destination)
        parent = Path(rel).parent.as_posix()
        if parent not in TASK_LIFECYCLE_DIRS:
            raise VaultError("Task lifecycle moves must stay in tasks/active, tasks/waiting, or tasks/done")
        return destination

    def scan_entries(self, force: bool = False) -> list[dict[str, Any]]:
        started = time.perf_counter()
        files: list[tuple[str, Path, tuple[int, int]]] = []
        for path in self.root.rglob("*"):
            if path.is_dir():
                continue
            if path.suffix.lower() not in TEXT_EXTENSIONS:
                continue
            if is_excluded(path, self.root):
                continue
            stat = path.stat()
            files.append((self.relpath(path), path, (stat.st_mtime_ns, stat.st_size)))
        signatures = {rel: signature for rel, _path, signature in files}
        cache_key = str(self.root)
        with VaultService._scan_cache_lock:
            cached = VaultService._scan_cache.get(cache_key)
        if not force and cached and cached.signatures == signatures:
            elapsed_ms = round((time.perf_counter() - started) * 1000, 2)
            log_perf("vault.scan_entries", root=cache_key, files=len(files), cache="hit", elapsed_ms=elapsed_ms)
            return entries_response_copy(cached.linked_entries)

        parsed_entries: dict[str, dict[str, Any]] = {}
        changed = 0
        reused = 0
        previous_signatures = cached.signatures if cached else {}
        previous_parsed = cached.parsed_entries if cached else {}
        for rel, path, signature in files:
            if not force and previous_signatures.get(rel) == signature and rel in previous_parsed:
                parsed_entries[rel] = previous_parsed[rel]
                reused += 1
                continue
            changed += 1
            try:
                parsed_entries[rel] = self.parse_file(path)
            except Exception as exc:
                parsed_entries[rel] = {
                    "path": rel,
                    "filename": path.name,
                    "title": path.name,
                    "error": str(exc),
                    "file_kind": "markdown",
                }

        entries = entries_response_copy(list(parsed_entries.values()))
        entries.sort(key=lambda e: (e.get("modified_at") or 0), reverse=True)
        backlink_started = time.perf_counter()
        linked_entries = self.add_backlinks(entries)
        backlink_ms = round((time.perf_counter() - backlink_started) * 1000, 2)
        with VaultService._scan_cache_lock:
            VaultService._scan_cache[cache_key] = ParsedEntryCache(
                signatures=signatures,
                parsed_entries=parsed_entries,
                linked_entries=entries_response_copy(linked_entries),
            )
        elapsed_ms = round((time.perf_counter() - started) * 1000, 2)
        log_perf(
            "vault.scan_entries",
            root=cache_key,
            files=len(files),
            changed=changed,
            reused=reused,
            cache="refresh" if not force else "force",
            backlinks_ms=backlink_ms,
            elapsed_ms=elapsed_ms,
        )
        return entries_response_copy(linked_entries)

    def invalidate_scan_cache(self) -> None:
        cache_key = str(self.root)
        with VaultService._scan_cache_lock:
            if VaultService._scan_cache is not None:
                VaultService._scan_cache.pop(cache_key, None)

    def scan_entries_uncached(self) -> list[dict[str, Any]]:
        entries: list[dict[str, Any]] = []
        for path in self.root.rglob("*"):
            if path.is_dir():
                continue
            if path.suffix.lower() not in TEXT_EXTENSIONS:
                continue
            if is_excluded(path, self.root):
                continue
            try:
                entries.append(self.parse_file(path))
            except Exception as exc:
                entries.append(
                    {
                        "path": self.relpath(path),
                        "filename": path.name,
                        "title": path.name,
                        "error": str(exc),
                        "file_kind": "markdown",
                    }
                )
        entries.sort(key=lambda e: (e.get("modified_at") or 0), reverse=True)
        return self.add_backlinks(entries)

    def parse_file(self, path: Path) -> dict[str, Any]:
        raw = path.read_text(encoding="utf-8", errors="replace")
        frontmatter, body = split_frontmatter(raw)
        stat = path.stat()
        rel = self.relpath(path)
        title = extract_title(frontmatter, body, path)
        explicit_type = scalar(frontmatter.get("type")) or scalar(frontmatter.get("Is A"))
        explicit_kind = scalar(frontmatter.get("kind"))
        inferred_kind, note_role = infer_kind_and_role(rel, path.name)
        inferred_project = infer_project(rel)
        inferred_area = infer_area(rel)
        type_value = explicit_type or explicit_kind or inferred_kind
        kind_value = explicit_kind or explicit_type or inferred_kind
        explicit_project = scalar(frontmatter.get("project"))
        explicit_domain = scalar(frontmatter.get("domain"))
        explicit_area = scalar(frontmatter.get("area"))
        relationships: dict[str, list[str]] = {}
        for key, value in frontmatter.items():
            links = wikilinks_from_value(value)
            if links:
                relationships[str(key)] = links
        properties = {
            str(k): json_safe(v)
            for k, v in frontmatter.items()
            if str(k) not in CORE_FIELDS
            and not str(k).startswith("_")
            and (str(k) in STRUCTURED_PROPERTY_FIELDS or not isinstance(v, (dict, list)))
        }
        system_properties = {str(k): json_safe(v) for k, v in frontmatter.items() if str(k).startswith("_")}
        codex_instructions = extract_codex_instructions(body)
        entry = {
            "path": rel,
            "filename": path.name,
            "title": title,
            "type": type_value,
            "kind": kind_value,
            "explicit_type": explicit_type,
            "explicit_kind": explicit_kind,
            "inferred_kind": inferred_kind,
            "kind_source": "frontmatter" if explicit_kind or explicit_type else "path" if inferred_kind else None,
            "status": scalar(frontmatter.get("status")),
            "project": explicit_project or inferred_project,
            "explicit_project": explicit_project,
            "inferred_project": inferred_project,
            "project_source": "frontmatter" if explicit_project else "path" if inferred_project else None,
            "domain": explicit_domain,
            "area": explicit_area or inferred_area,
            "explicit_area": explicit_area,
            "inferred_area": inferred_area,
            "area_source": "frontmatter" if explicit_area else "path" if inferred_area else None,
            "collection": collection_from_path(rel),
            "note_role": note_role,
            "id": scalar(frontmatter.get("id")),
            "priority": scalar(frontmatter.get("priority")),
            **({"urgent": True} if is_truthy(frontmatter.get("urgent")) else {}),
            "deadline": scalar(frontmatter.get("deadline")),
            "deadline_type": scalar(frontmatter.get("deadline_type")),
            "due": scalar(frontmatter.get("due")) or scalar(frontmatter.get("date")),
            "date": scalar(frontmatter.get("date")),
            "start_date": scalar(frontmatter.get("start_date")),
            "end_date": scalar(frontmatter.get("end_date")),
            "assignee": scalar(frontmatter.get("assignee")) or scalar(frontmatter.get("assigned_to")) or scalar(frontmatter.get("owner")),
            "assigned_to": scalar(frontmatter.get("assigned_to")),
            "owner": scalar(frontmatter.get("owner")),
            "next": scalar(frontmatter.get("next")) or scalar(frontmatter.get("next_action")),
            "icon": scalar(frontmatter.get("icon")),
            "url": scalar(frontmatter.get("url")),
            "aliases": listify(frontmatter.get("aliases")),
            "belongs_to": wikilinks_from_value(frontmatter.get("belongs_to")),
            "related_to": wikilinks_from_value(frontmatter.get("related_to")),
            "has": wikilinks_from_value(frontmatter.get("has")),
            "relationships": relationships,
            "outgoing_links": sorted(set(m.group(1).strip() for m in WIKILINK_RE.finditer(body))),
            "backlinks": [],
            "properties": properties,
            "system_properties": system_properties,
            "private": is_truthy(frontmatter.get("private")),
            "word_count": word_count(body),
            "snippet": snippet(body),
            "modified_at": stat.st_mtime,
            "created_at": stat.st_ctime,
            "file_size": stat.st_size,
            "file_kind": "markdown",
        }
        if codex_instructions:
            entry["codex_instructions"] = codex_instructions
        return entry

    def add_backlinks(self, entries: list[dict[str, Any]]) -> list[dict[str, Any]]:
        index: dict[str, str] = {}
        for entry in entries:
            identifiers = [
                entry.get("path", ""),
                Path(str(entry.get("path", ""))).stem,
                entry.get("title", ""),
                entry.get("id", ""),
            ] + listify(entry.get("aliases"))
            for item in identifiers:
                if item:
                    index[normalize_link_target(str(item))] = str(entry.get("path"))
        backlinks: dict[str, set[str]] = {str(e.get("path")): set() for e in entries}
        for entry in entries:
            source = str(entry.get("path"))
            targets = list(entry.get("outgoing_links") or [])
            for rel_targets in (entry.get("relationships") or {}).values():
                targets.extend(rel_targets)
            for target in targets:
                resolved = index.get(normalize_link_target(str(target)))
                if resolved and resolved != source:
                    backlinks.setdefault(resolved, set()).add(source)
        for entry in entries:
            entry["backlinks"] = sorted(backlinks.get(str(entry.get("path")), set()))
        return entries

    def get_file(self, rel_path: str) -> dict[str, Any]:
        path = self.resolve_markdown_path(rel_path)
        raw = path.read_text(encoding="utf-8", errors="replace")
        frontmatter, body = split_frontmatter(raw)
        stat = path.stat()
        return {
            "path": self.relpath(path),
            "content": raw,
            "frontmatter": json_safe(frontmatter),
            "body": body,
            "modified_at": stat.st_mtime,
            "file_size": stat.st_size,
        }

    def save_file(
        self,
        rel_path: str,
        content: str,
        current_modified_at: float | None = None,
        move_to: str | None = None,
    ) -> dict[str, Any]:
        path = self.resolve_markdown_path(rel_path)
        if current_modified_at is not None and path.exists():
            actual = path.stat().st_mtime
            if abs(actual - current_modified_at) > 0.001:
                raise SaveConflictError("File changed on disk; reload before saving")
        target = path
        if move_to:
            source_rel = self.relpath(path)
            if not source_rel.startswith("tasks/"):
                raise VaultError("Only task Markdown files support lifecycle moves")
            target = self.resolve_task_lifecycle_destination(move_to)
            if target != path:
                target = self.unique_path(target)
        target.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp_name = tempfile.mkstemp(prefix=f".{target.name}.", suffix=".tmp", dir=target.parent)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                handle.write(content)
                if not content.endswith("\n"):
                    handle.write("\n")
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(tmp_name, target)
        finally:
            if os.path.exists(tmp_name):
                os.unlink(tmp_name)
        if target != path and path.exists():
            path.unlink()
        self.invalidate_scan_cache()
        return self.get_file(self.relpath(target))

    def patch_task_metadata(
        self,
        rel_path: str,
        updates: dict[str, Any],
        current_modified_at: float | None = None,
    ) -> dict[str, Any]:
        if not updates:
            raise VaultError("No task metadata updates supplied")
        path = self.resolve_markdown_path(rel_path)
        entry = self.parse_file(path)
        kind = str(entry.get("kind") or entry.get("type") or "").lower()
        if kind != "task" and not str(entry.get("path") or "").startswith("tasks/"):
            raise VaultError("Only task Markdown files support quick metadata edits")

        raw = path.read_text(encoding="utf-8", errors="replace")
        frontmatter, _body = split_frontmatter(raw)
        normalized_updates: dict[str, Any] = {}
        for key, value in updates.items():
            normalized = normalize_task_metadata_update(str(key), value)
            normalized_updates[str(key)] = normalized
        rel = self.relpath(path)
        content = patch_frontmatter_scalars(raw, normalized_updates)
        move_to = None
        status_update = normalized_updates.get("status")
        if isinstance(status_update, str):
            if status_update in TASK_LIFECYCLE_CLOSED_STATUSES and not str(frontmatter.get("completed") or "").strip():
                content = patch_frontmatter_scalars(content, {"completed": date.today().isoformat()})
            move_to = task_lifecycle_destination(rel, status_update)
        return self.save_file(rel, content, current_modified_at, move_to)

    def patch_metadata(
        self,
        rel_path: str,
        updates: dict[str, Any],
        current_modified_at: float | None = None,
    ) -> dict[str, Any]:
        if not updates:
            raise VaultError("No metadata updates supplied")
        path = self.resolve_markdown_path(rel_path)
        entry = self.parse_file(path)
        kind = entry_cockpit_kind(entry)
        raw = path.read_text(encoding="utf-8", errors="replace")
        normalized_updates: dict[str, Any] = {}
        for key, value in updates.items():
            normalized_updates[str(key)] = normalize_metadata_update(kind, str(key), value)
        return self.save_file(self.relpath(path), patch_frontmatter_scalars(raw, normalized_updates), current_modified_at)

    def create_file(self, kind: str, title: str, directory: str | None = None) -> dict[str, Any]:
        kind = slugify(kind or "note")
        title = title.strip() or "Untitled"
        if directory:
            base_dir = (self.root / directory).resolve()
            try:
                base_dir.relative_to(self.root)
            except ValueError as exc:
                raise VaultError("Create directory must stay inside the vault") from exc
            if is_excluded(base_dir, self.root):
                raise VaultError("Create directory is excluded")
            path = self.unique_path(base_dir / f"{slugify(title)}.md")
        elif kind == "project":
            path = self.unique_path(self.root / "projects" / slugify(title) / "README.md")
        elif kind == "task":
            path = self.unique_path(self.root / "tasks" / "active" / f"t-{slugify(title)}.md")
        elif kind == "event":
            path = self.unique_path(self.root / "dates" / f"{time.strftime('%Y-%m-%d')}-{slugify(title)}.md")
        else:
            path = self.unique_path(self.root / "_inbox" / f"{time.strftime('%Y-%m-%d-%H%M')}-{slugify(title)}.md")
        template = self.render_template(kind, title)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(template, encoding="utf-8")
        self.invalidate_scan_cache()
        return self.get_file(self.relpath(path))

    def unique_path(self, path: Path) -> Path:
        if not path.exists():
            return path
        stem = path.stem
        suffix = path.suffix
        for i in range(2, 1000):
            candidate = path.with_name(f"{stem}-{i}{suffix}")
            if not candidate.exists():
                return candidate
        raise VaultError("Could not find a unique path")

    def render_template(self, kind: str, title: str) -> str:
        type_note = self.find_type_note(kind)
        if type_note:
            raw = type_note.read_text(encoding="utf-8", errors="replace")
            frontmatter, _ = split_frontmatter(raw)
            template = scalar(frontmatter.get("template"))
            if template:
                return self.with_title(template, title)
        escaped = title.replace('"', "'")
        if kind == "task":
            return f'---\nkind: task\ntitle: "{escaped}"\nstatus: open\npriority: 3\ndue: \nproject: \n---\n# {title}\n\n## Next action\n\n- \n'
        if kind == "project":
            project_id = slugify(title)
            return f'---\nkind: project\nid: "{project_id}"\ntitle: "{escaped}"\nstatus: active\npriority: 3\nnext_action: ""\n---\n# {title}\n\n## Next\n\n- \n'
        return f'---\nkind: {kind}\ntitle: "{escaped}"\ndate: {time.strftime("%Y-%m-%d")}\nstatus: draft\n---\n# {title}\n\n'

    def find_type_note(self, kind: str) -> Path | None:
        candidates = [self.root / f"{kind}.md", self.root / f"{kind.replace('_', '-')}.md"]
        for path in candidates:
            if path.exists():
                return path
        for path in self.root.glob("*.md"):
            try:
                raw = path.read_text(encoding="utf-8", errors="replace")
            except Exception:
                continue
            frontmatter, _ = split_frontmatter(raw)
            if scalar(frontmatter.get("type")) == "Type" and kind in str(frontmatter.get("template", "")):
                return path
        return None

    def with_title(self, content: str, title: str) -> str:
        if H1_RE.search(content):
            return H1_RE.sub(f"# {title}", content, count=1)
        return content.rstrip() + f"\n\n# {title}\n"

    def git_status(self) -> dict[str, Any]:
        git_dir = self.root / ".git"
        if not git_dir.exists():
            return {"enabled": False, "branch": None, "changed": []}
        try:
            branch = subprocess.check_output(
                ["git", "-C", str(self.root), "branch", "--show-current"],
                text=True,
                stderr=subprocess.DEVNULL,
                timeout=10,
            ).strip()
            raw = subprocess.check_output(
                ["git", "-C", str(self.root), "status", "--short"],
                text=True,
                stderr=subprocess.DEVNULL,
                timeout=10,
            )
        except Exception:
            # Includes subprocess.TimeoutExpired: a hung git (e.g. a held
            # index.lock or slow filesystem) no longer blocks the worker forever.
            return {"enabled": True, "branch": None, "changed": [], "error": "Could not read git status"}
        changed = [{"status": line[:2].strip(), "path": line[3:]} for line in raw.splitlines() if line.strip()]
        return {"enabled": True, "branch": branch or None, "changed": changed}
