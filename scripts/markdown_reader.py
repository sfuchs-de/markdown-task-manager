#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Markdown vault reader for Research Workbench.

This is deliberately plain and local: Markdown + YAML frontmatter in, JSON cache out.
It mirrors the useful Tolaria conventions without depending on Tolaria itself.
"""
from __future__ import annotations

import json
import re
import sys
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Any, Dict, Iterable, List, Tuple

try:
    import yaml  # type: ignore
except Exception as exc:  # pragma: no cover
    raise SystemExit("PyYAML is required. Install with: python3 -m pip install pyyaml") from exc

try:
    from scripts.workbench_paths import DATA_ROOT, VAULT_ROOT
except ImportError:  # pragma: no cover
    from workbench_paths import DATA_ROOT, VAULT_ROOT

ROOT = VAULT_ROOT

# Shared frontmatter/body primitives. Imported as a package (server/tests) or by
# bare name when pm.py runs this file with scripts/ on sys.path.
try:
    from scripts.vault_parsing import (
        CODEX_INSTRUCTION_ITEM_RE,
        CODEX_INSTRUCTIONS_HEADING_RE,
        H1_RE,
        STRUCTURED_PROPERTY_FIELDS,
        WIKILINK_RE,
        extract_codex_instructions,
        extract_title,
        json_safe,
        listify,
        relpath,
        scalar,
        snippet,
        split_frontmatter,
        wikilinks_from_value,
        word_count,
    )
except ImportError:  # pragma: no cover - bare-script invocation path
    from vault_parsing import (  # type: ignore
        CODEX_INSTRUCTION_ITEM_RE,
        CODEX_INSTRUCTIONS_HEADING_RE,
        H1_RE,
        STRUCTURED_PROPERTY_FIELDS,
        WIKILINK_RE,
        extract_codex_instructions,
        extract_title,
        json_safe,
        listify,
        relpath,
        scalar,
        snippet,
        split_frontmatter,
        wikilinks_from_value,
        word_count,
    )

# Reader-specific: assignee/domain are NOT core here, so they surface via
# `properties` (RA rendering reads them there). See scripts/vault_parsing.py.
CORE_FIELDS = {
    "title", "type", "kind", "status", "icon", "url", "date", "start_date", "end_date",
    "goal", "result", "workspace", "Workspace", "belongs_to", "related_to", "has",
    "aliases", "project", "id", "priority", "due", "next", "area", "dashboard",
    "private", "source", "energy", "deadline", "deadline_type", "last_touched", "lead", "owner",
    "urgent",
}

LOCAL_ONLY_SENSITIVE_DIRS = {
    # These files are readable by the local hosted app, but must not be copied
    # into generated tracked JSON/dashboard artifacts.
    "booking_details_sensitive",
}


def parse_markdown_file(path: Path) -> Dict[str, Any]:
    raw = path.read_text(encoding="utf-8", errors="replace")
    fm, body = split_frontmatter(raw)
    links = sorted(set(m.group(1).strip() for m in WIKILINK_RE.finditer(body)))
    relationships: Dict[str, List[str]] = {}
    for key, value in fm.items():
        rels = wikilinks_from_value(value)
        if rels:
            relationships[str(key)] = rels
    type_value = scalar(fm.get("type")) or scalar(fm.get("Is A")) or scalar(fm.get("kind"))
    properties = {
        str(k): json_safe(v) for k, v in fm.items()
        if str(k) not in CORE_FIELDS
        and not str(k).startswith("_")
        and (str(k) in STRUCTURED_PROPERTY_FIELDS or not isinstance(v, (dict, list)))
    }
    system_properties = {str(k): json_safe(v) for k, v in fm.items() if str(k).startswith("_")}
    stat = path.stat()
    codex_instructions = extract_codex_instructions(body)
    entry = {
        "path": relpath(path),
        "filename": path.name,
        "title": extract_title(fm, body, path),
        "type": type_value,
        "kind": scalar(fm.get("kind")) or type_value,
        "status": scalar(fm.get("status")),
        "project": scalar(fm.get("project")),
        "id": scalar(fm.get("id")),
        "priority": scalar(fm.get("priority")),
        **({"urgent": True} if bool(fm.get("urgent", False)) else {}),
        "deadline_type": scalar(fm.get("deadline_type")),
        "due": scalar(fm.get("due")) or scalar(fm.get("date")),
        "date": scalar(fm.get("date")),
        "start_date": scalar(fm.get("start_date")),
        "end_date": scalar(fm.get("end_date")),
        "next": scalar(fm.get("next")) or scalar(fm.get("next_action")),
        "icon": scalar(fm.get("icon")),
        "url": scalar(fm.get("url")),
        "aliases": listify(fm.get("aliases")),
        "belongs_to": wikilinks_from_value(fm.get("belongs_to")),
        "related_to": wikilinks_from_value(fm.get("related_to")),
        "has": wikilinks_from_value(fm.get("has")),
        "relationships": relationships,
        "outgoing_links": links,
        "properties": properties,
        "system_properties": system_properties,
        "private": bool(fm.get("private", False)) or "private" in relpath(path).lower(),
        "word_count": word_count(body),
        "snippet": snippet(body),
        "modified_at": stat.st_mtime,
        "created_at": stat.st_ctime,
        "file_kind": "markdown",
    }
    if codex_instructions:
        entry["codex_instructions"] = codex_instructions
    return entry


def should_skip(path: Path, include_private: bool = False) -> bool:
    rel = relpath(path)
    parts = set(path.parts)
    rel_parts = path.relative_to(ROOT).parts
    generated_or_dependency_dirs = {
        ".git",
        ".github",
        ".venv",
        "__pycache__",
        ".pytest_cache",
        "node_modules",
        "dist",
        "data",
        "dashboard",
        "test-results",
        "playwright-report",
    }
    if any(part in generated_or_dependency_dirs for part in rel_parts):
        return True
    if any(part in LOCAL_ONLY_SENSITIVE_DIRS for part in rel_parts):
        return True
    if rel.startswith("web/fixtures/") or rel.startswith("web/.tmp/"):
        return True
    if any(p.startswith(".") for p in path.relative_to(ROOT).parts if p != path.name):
        return True
    if "archive" in parts and not include_private:
        # archive is scanned by default for notes? Keep it out of dashboard-level reading.
        return True
    if not include_private and ("private" in parts or "/private/" in rel.lower()):
        return True
    if path.name.startswith("."):
        return True
    if path.suffix.lower() not in {".md", ".markdown"}:
        return True
    return False


def scan_vault(include_private: bool = False) -> List[Dict[str, Any]]:
    entries: List[Dict[str, Any]] = []
    for path in ROOT.rglob("*.md"):
        if should_skip(path, include_private=include_private):
            continue
        try:
            entry = parse_markdown_file(path)
            if entry.get("kind") == "archived-task-copy" or entry.get("type") == "archived-task-copy":
                continue
            if entry.get("properties", {}).get("archived_from_task"):
                continue
            entries.append(entry)
        except Exception as exc:
            entries.append({"path": relpath(path), "title": path.name, "error": str(exc)})
    # Sort by path (stable across machines) rather than filesystem mtime, so the
    # cache and the relationships graph derived from it are reproducible in CI.
    entries.sort(key=lambda e: e.get("path") or "")
    return entries


def slug_from_title(title: str) -> str:
    slug = re.sub(r"[^A-Za-z0-9]+", "-", title.strip().lower()).strip("-")
    return slug or "untitled"


def node_key(entry: Dict[str, Any]) -> str:
    return (entry.get("id") or entry.get("path") or entry.get("title") or "").strip()


def build_relationships(entries: List[Dict[str, Any]]) -> Dict[str, Any]:
    nodes = []
    edges = []
    title_index: Dict[str, str] = {}
    for e in entries:
        key = node_key(e)
        title = e.get("title") or key
        title_index[slug_from_title(title)] = key
        title_index[title.lower()] = key
        if e.get("id"):
            title_index[str(e["id"]).lower()] = key
        nodes.append({
            "id": key,
            "title": title,
            "path": e.get("path"),
            "type": e.get("type") or e.get("kind"),
            "project": e.get("project"),
            "status": e.get("status"),
            "private": e.get("private", False),
        })
    def resolve(target: str) -> str:
        t = target.strip().lower()
        return title_index.get(t) or title_index.get(slug_from_title(target)) or target
    for e in entries:
        src = node_key(e)
        if e.get("project"):
            edges.append({"source": src, "target": resolve(str(e.get("project"))), "label": "project"})
        if e.get("type") or e.get("kind"):
            edges.append({"source": src, "target": str(e.get("type") or e.get("kind")), "label": "type"})
        for rel, targets in (e.get("relationships") or {}).items():
            for target in targets:
                edges.append({"source": src, "target": resolve(target), "label": rel})
        for target in e.get("outgoing_links") or []:
            edges.append({"source": src, "target": resolve(target), "label": "mentions"})
    # De-duplicate while preserving order.
    seen = set()
    deduped = []
    for e in edges:
        key = (e.get("source"), e.get("target"), e.get("label"))
        if key not in seen:
            seen.add(key)
            deduped.append(e)
    # Deterministic order so relationships.json (and the dashboard graph built
    # from it) is reproducible regardless of filesystem iteration order.
    nodes.sort(key=lambda n: n.get("id") or "")
    deduped.sort(key=lambda x: (x.get("source") or "", x.get("target") or "", x.get("label") or ""))
    return {"nodes": nodes, "edges": deduped}


def write_cache(include_private: bool = False) -> None:
    data_dir = DATA_ROOT
    data_dir.mkdir(exist_ok=True)
    entries = scan_vault(include_private=include_private)
    relationships = build_relationships(entries)
    (data_dir / "vault_entries.json").write_text(json.dumps(entries, indent=2), encoding="utf-8")
    (data_dir / "relationships.json").write_text(json.dumps(relationships, indent=2), encoding="utf-8")


def markdown_preview(path: str | Path, limit: int = 420) -> str:
    p = Path(path)
    if not p.is_absolute():
        p = ROOT / p
    raw = p.read_text(encoding="utf-8", errors="replace")
    _, body = split_frontmatter(raw)
    body = body.strip()
    body = re.sub(r"\n{3,}", "\n\n", body)
    return body[:limit] + ("…" if len(body) > limit else "")


def main() -> None:
    include_private = "--include-private" in sys.argv
    entries = scan_vault(include_private=include_private)
    write_cache(include_private=include_private)
    print(f"Scanned {len(entries)} markdown entries")
    print("Wrote data/vault_entries.json and data/relationships.json")


if __name__ == "__main__":
    main()
