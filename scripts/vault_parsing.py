#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Shared Markdown-vault parsing primitives.

Single source of truth for the frontmatter/body helpers that both the CLI
reader (``scripts/markdown_reader.py``) and the hosted API parser
(``server/vault.py``) used to maintain as separate, slowly-diverging copies.

Each consumer still layers its own richer ``parse_*`` on top of these leaf
helpers; only the shared primitives live here.
"""
from __future__ import annotations

import re
from pathlib import Path
from typing import Any

try:
    import yaml  # type: ignore
except Exception as exc:  # pragma: no cover
    raise SystemExit("PyYAML is required. Install with: python3 -m pip install pyyaml") from exc

ROOT = Path(__file__).resolve().parents[1] / "vault"

# NOTE: CORE_FIELDS is deliberately NOT shared. The two consumers diverge for a
# real reason: server/vault.py promotes assignee/assigned_to/domain to top-level
# entry fields, while markdown_reader.py surfaces them via `properties`. Unifying
# the set would drop assignee from the reader's cache (it has no top-level slot
# for it), which RA rendering depends on. Each consumer keeps its own CORE_FIELDS.
STRUCTURED_PROPERTY_FIELDS = {"ledger"}

WIKILINK_RE = re.compile(r"\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]")
H1_RE = re.compile(r"^#\s+(.+?)\s*$", re.MULTILINE)
CODEX_INSTRUCTIONS_HEADING_RE = re.compile(r"^##\s+Codex instructions\s*$", re.IGNORECASE | re.MULTILINE)
CODEX_INSTRUCTION_ITEM_RE = re.compile(
    r"^-\s*\[(?P<box>[ xX!\-])\]\s*"
    r"(?:(?P<status>queued|blocked|processed|cancelled)\s*\|\s*)?"
    r"(?:(?P<date>\d{4}-\d{2}-\d{2})\s*\|\s*)?"
    r"(?P<text>.+?)\s*$",
    re.IGNORECASE,
)


def relpath(path: Path) -> str:
    try:
        return path.relative_to(ROOT).as_posix()
    except Exception:
        return path.as_posix()


def json_safe(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(k): json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [json_safe(v) for v in value]
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return value


def split_frontmatter(text: str) -> tuple[dict[str, Any], str]:
    """Return (frontmatter, body). Frontmatter is YAML between leading --- fences."""
    if text.startswith("---\n") or text.startswith("---\r\n"):
        lines = text.splitlines(keepends=True)
        for i in range(1, len(lines)):
            if lines[i].strip() == "---":
                fm_text = "".join(lines[1:i])
                body = "".join(lines[i + 1:])
                try:
                    parsed = yaml.safe_load(fm_text) or {}
                    if not isinstance(parsed, dict):
                        parsed = {}
                except Exception:
                    parsed = {}
                return parsed, body
    return {}, text


def listify(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        return [str(v) for v in value if v is not None]
    if isinstance(value, tuple):
        return [str(v) for v in value if v is not None]
    if isinstance(value, str):
        if value.strip() == "":
            return []
        return [value]
    return [str(value)]


def scalar(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, (list, dict)):
        return None
    return str(value)


def extract_title(frontmatter: dict[str, Any], body: str, path: Path) -> str:
    h1 = H1_RE.search(body)
    if h1:
        return h1.group(1).strip()
    title = scalar(frontmatter.get("title"))
    if title:
        return title
    return path.stem.replace("-", " ").replace("_", " ").title()


def word_count(body: str) -> int:
    clean = re.sub(r"`[^`]*`", " ", body)
    clean = re.sub(r"\[[^\]]+\]\([^\)]+\)", " ", clean)
    return len(re.findall(r"\b\w+\b", clean))


def snippet(body: str, limit: int = 220) -> str:
    body = re.sub(r"^#.*$", "", body, flags=re.MULTILINE)
    body = re.sub(r"\s+", " ", body).strip()
    return body[:limit] + ("…" if len(body) > limit else "")


def extract_codex_instructions(body: str) -> list[dict[str, Any]]:
    """Extract structured task-local Codex instructions from a Markdown section."""
    match = CODEX_INSTRUCTIONS_HEADING_RE.search(body)
    if not match:
        return []
    section_start = match.end()
    rest = body[section_start:]
    next_section = re.search(r"^##\s+", rest, flags=re.MULTILINE)
    section = rest[: next_section.start()] if next_section else rest
    line_offset = body[:section_start].count("\n")
    marker_status = {
        " ": "queued",
        "": "queued",
        "x": "processed",
        "!": "blocked",
        "-": "cancelled",
    }
    instructions: list[dict[str, Any]] = []
    for index, line in enumerate(section.splitlines(), start=1):
        item = CODEX_INSTRUCTION_ITEM_RE.match(line.strip())
        if not item:
            continue
        explicit_status = (item.group("status") or "").lower()
        marker = (item.group("box") or " ").lower()
        status = explicit_status or marker_status.get(marker, "queued")
        text = item.group("text").strip()
        if not text:
            continue
        instructions.append({
            "status": status,
            "date": item.group("date"),
            "text": text,
            "line": line_offset + index,
        })
    return instructions


def wikilinks_from_value(value: Any) -> list[str]:
    text = "\n".join(listify(value)) if isinstance(value, list) else str(value)
    return [m.group(1).strip() for m in WIKILINK_RE.finditer(text)]
