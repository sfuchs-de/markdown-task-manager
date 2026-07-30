#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List

try:
    import yaml  # type: ignore
except Exception as exc:
    raise SystemExit("PyYAML is required. Install with: python3 -m pip install pyyaml") from exc

try:
    from scripts.workbench_paths import DATA_ROOT, VAULT_ROOT
except ImportError:  # pragma: no cover
    from workbench_paths import DATA_ROOT, VAULT_ROOT

ROOT = VAULT_ROOT
DATA = DATA_ROOT
CORE_NAMES = {"README.md", "progress.md", "next.md", "scratch.md", "linked_sources.md", "decision_log.md", "questions.md"}
EVENT_KINDS = {"event", "calendar", "conference", "seminar", "workshop", "travel"}


def json_safe(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(k): json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [json_safe(v) for v in value]
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return value


def read_fm(path: Path) -> Dict[str, Any] | None:
    text = path.read_text(encoding="utf-8", errors="replace")
    if not text.startswith("---"):
        return None
    lines = text.splitlines(keepends=True)
    if not lines or lines[0].strip() != "---":
        return None
    for i in range(1, len(lines)):
        if lines[i].strip() == "---":
            try:
                data = yaml.safe_load("".join(lines[1:i])) or {}
            except Exception:
                data = {}
            if isinstance(data, dict):
                return {str(k): json_safe(v) for k, v in data.items()}
            return {}
    return None


def rel(path: Path) -> str:
    return path.relative_to(ROOT).as_posix()


def truthy(v: Any) -> bool:
    return bool(v) and str(v).lower() not in {"false", "0", "no", "none"}


def projects() -> List[Dict[str, Any]]:
    out = []
    for path in list((ROOT / "projects").glob("*/README.md")) + list((ROOT / "areas").glob("*/README.md")):
        fm = read_fm(path)
        if not fm or fm.get("kind") != "project" or str(fm.get("dashboard", "true")).lower() == "false":
            continue
        out.append({
            "id": fm.get("id") or path.parent.name,
            "name": fm.get("title") or path.parent.name,
            "area": fm.get("area", ""),
            "domain": fm.get("domain", ""),
            "status": fm.get("status", "active"),
            "priority": fm.get("priority", 9),
            "energy": fm.get("energy", ""),
            "lead": fm.get("lead", ""),
            "deadline": fm.get("deadline", ""),
            "deadline_type": fm.get("deadline_type", ""),
            "last_touched": fm.get("last_touched", ""),
            "next_action": fm.get("next_action", ""),
            "private": truthy(fm.get("private")),
            "public_export_level": fm.get("public_export_level") or fm.get("export_level") or "",
            "path": rel(path),
            "sources": fm.get("sources", []) if isinstance(fm.get("sources", []), list) else [],
        })
    return sorted(out, key=lambda p: (p.get("priority", 9), p.get("deadline") or "9999-12-31", p.get("name", "")))


def tasks() -> List[Dict[str, Any]]:
    out = []
    for path in (ROOT / "tasks").glob("**/*.md"):
        if path.name == "README.md":
            continue
        fm = read_fm(path)
        kind = str((fm or {}).get("kind") or "").lower()
        if not fm or not (kind == "task" or kind.endswith("-task")):
            continue
        out.append({
            "id": fm.get("id") or path.stem,
            "project": fm.get("project", ""),
            "domain": fm.get("domain", ""),
            "area": fm.get("area", ""),
            "title": fm.get("title") or path.stem,
            "status": fm.get("status", "open"),
            "priority": fm.get("priority", 9),
            "due": fm.get("due", ""),
            "deadline_type": fm.get("deadline_type", ""),
            "assignee": fm.get("assignee", fm.get("assigned_to", fm.get("owner", ""))),
            "next": fm.get("next", ""),
            "estimate_minutes": fm.get("estimate_minutes", fm.get("duration_minutes", 60)),
            "energy": fm.get("energy", ""),
            "time_block": fm.get("time_block", ""),
            "block_day": fm.get("block_day", ""),
            "block_week": fm.get("block_week", ""),
            "private": truthy(fm.get("private")),
            "path": rel(path),
        })
    return sorted(out, key=lambda t: (t.get("status") == "done", t.get("priority", 9), t.get("due") or "9999-12-31", t.get("title", "")))


def events() -> List[Dict[str, Any]]:
    out = []
    for path in (ROOT / "dates").glob("*.md"):
        if path.name == "README.md":
            continue
        fm = read_fm(path)
        kind = str((fm or {}).get("kind") or (fm or {}).get("type") or "").lower()
        if not fm or kind not in EVENT_KINDS:
            continue
        out.append({
            "date": fm.get("date", ""),
            "title": fm.get("title") or path.stem,
            "project": fm.get("project", ""),
            "domain": fm.get("domain", ""),
            "area": fm.get("area", ""),
            "type": fm.get("type") or kind,
            "kind": kind,
            "end_date": fm.get("end_date", ""),
            "module": fm.get("module", ""),
            "trip_key": fm.get("trip_key", ""),
            "private": truthy(fm.get("private")),
            "path": rel(path),
        })
    return sorted(out, key=lambda e: (e.get("date") or "9999-12-31", e.get("title", "")))


def notes() -> List[Dict[str, Any]]:
    out = []
    for base in [ROOT / "projects", ROOT / "areas", ROOT / "journal", ROOT / "notes", ROOT / "_inbox"]:
        if not base.exists():
            continue
        for path in base.glob("**/*.md"):
            if path.name in CORE_NAMES or "archive" in path.parts:
                continue
            fm = read_fm(path) or {}
            kind = str(fm.get("kind") or "").lower()
            if not kind or kind == "project" or kind == "task" or kind.endswith("-task") or kind in EVENT_KINDS:
                continue
            try:
                rel_parts = path.relative_to(base).parts
                inferred_project = rel_parts[0] if len(rel_parts) > 1 and base.name in {"projects", "areas"} else ""
            except Exception:
                inferred_project = ""
            out.append({
                "id": fm.get("id") or path.stem,
                "kind": kind,
                "project": fm.get("project") or inferred_project,
                "domain": fm.get("domain", ""),
                "area": fm.get("area", ""),
                "module": fm.get("module", ""),
                "assignee": fm.get("assignee", fm.get("assigned_to", fm.get("owner", ""))),
                "title": fm.get("title") or path.stem,
                "date": fm.get("date") or fm.get("week") or "",
                "status": fm.get("status") or "",
                "private": truthy(fm.get("private")),
                "path": rel(path),
            })
    return sorted(out, key=lambda n: (n.get("date") or "0000", n.get("project", ""), n.get("title", "")), reverse=True)


def main() -> None:
    DATA.mkdir(parents=True, exist_ok=True)
    ps, ts, es, ns = projects(), tasks(), events(), notes()
    (DATA / "projects.json").write_text(json.dumps(ps, indent=2, ensure_ascii=False), encoding="utf-8")
    (DATA / "tasks.json").write_text(json.dumps(ts, indent=2, ensure_ascii=False), encoding="utf-8")
    (DATA / "events.json").write_text(json.dumps(es, indent=2, ensure_ascii=False), encoding="utf-8")
    (DATA / "notes.json").write_text(json.dumps(ns, indent=2, ensure_ascii=False), encoding="utf-8")
    # Tolaria-style full-vault Markdown cache.
    import markdown_reader
    markdown_reader.write_cache(include_private=True)
    print(f"Synced {len(ps)} projects, {len(ts)} tasks, {len(es)} dates/events, {len(ns)} notes from Markdown.")
    print("Updated Tolaria-style cache: data/vault_entries.json and data/relationships.json.")


if __name__ == "__main__":
    main()
