#!/usr/bin/env python3
"""Validate canonical Markdown frontmatter fields.

The vault intentionally stays Markdown-first, but a small set of fields drives
core app behavior. This script checks those fields before generated caches or
hosted deployments can drift.
"""
from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict, dataclass
from datetime import date
from pathlib import Path
from typing import Any, Iterable

try:
    from markdown_reader import split_frontmatter
except ModuleNotFoundError:  # Imported as scripts.validate_vault_schema in tests.
    from scripts.markdown_reader import split_frontmatter


try:
    from scripts.workbench_paths import VAULT_ROOT
except ImportError:  # pragma: no cover
    from workbench_paths import VAULT_ROOT

ROOT = VAULT_ROOT

TASK_STATUSES = {
    "open",
    "active",
    "waiting",
    "blocked",
    "done",
    "complete",
    "completed",
    "cancelled",
    "canceled",
    "dropped",
    "archive",
    "archived",
    "someday",
    "later",
    "parked",
    "paused",
}
DEPRECATED_TASK_STATUSES = {
    "complete": "done",
    "completed": "done",
    "canceled": "cancelled",
    "archive": "archived",
}
DONE_STATUSES = {"done", "complete", "completed"}
CANCELLED_STATUSES = {"cancelled", "canceled", "dropped", "archive", "archived"}
CLOSED_STATUSES = DONE_STATUSES | CANCELLED_STATUSES
DEADLINE_TYPES = {"hard", "soft"}
PRIORITIES = {1, 2, 3, 4, 5}
BOOLEAN_STRINGS = {"true", "false", "yes", "no", "0", "1"}
TASK_OWNERSHIP_FIELDS = {"assignee", "assigned_to", "owner"}
DEPRECATED_TASK_OWNERSHIP_FIELDS = {
    "assigned": "assignee",
    "responsible": "assignee",
    "lead": "assignee",
}

TRAVEL_LEDGER_FIELDS = {
    "id",
    "trip_key",
    "trip_title",
    "item",
    "category",
    "estimate",
    "estimate_usd",
    "actual",
    "actual_usd",
    "currency",
    "status",
    "reimbursable",
    "source",
    "receipt_pointer",
    "private_pointer",
    "reimbursed_amount",
    "reimbursed_amount_usd",
    "reimbursed_date",
    "covered_by",
    "counts_against_research_account",
    "notes",
}
TRAVEL_LEDGER_REQUIRED_FIELDS = {"id", "trip_key", "item", "category", "status"}
TRAVEL_LEDGER_STATUSES = {
    "approval_needed",
    "approved",
    "ready_to_book",
    "booked",
    "booked_price_not_stored",
    "planned",
    "estimate",
    "submitted",
    "reimbursement_pending",
    "reimbursed",
    "complete",
    "needs_submission_check",
    "not_reimbursable",
    "cancelled",
    "canceled",
}


@dataclass(frozen=True)
class SchemaIssue:
    path: str
    field: str
    message: str


def relpath(path: Path, root: Path) -> str:
    try:
        return path.relative_to(root).as_posix()
    except ValueError:
        return path.as_posix()


def normalize_status(value: Any) -> str:
    return str(value or "").strip().lower()


def scalar_text(value: Any) -> str:
    return str(value).strip()


def parse_priority(value: Any) -> int | None:
    if value is None or value == "":
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def is_boolean_like(value: Any) -> bool:
    if isinstance(value, bool):
        return True
    if isinstance(value, str):
        return value.strip().lower() in BOOLEAN_STRINGS
    return False


def is_number(value: Any) -> bool:
    if isinstance(value, bool):
        return False
    if isinstance(value, (int, float)):
        return True
    if isinstance(value, str):
        try:
            float(value)
            return True
        except ValueError:
            return False
    return False


def is_iso_date(value: Any) -> bool:
    if hasattr(value, "isoformat"):
        return True
    if value is None or value == "":
        return True
    try:
        date.fromisoformat(str(value))
        return True
    except ValueError:
        return False


def add_issue(issues: list[SchemaIssue], path: Path, root: Path, field: str, message: str) -> None:
    issues.append(SchemaIssue(relpath(path, root), field, message))


def validate_task(path: Path, frontmatter: dict[str, Any], root: Path) -> list[SchemaIssue]:
    issues: list[SchemaIssue] = []
    status = normalize_status(frontmatter.get("status"))
    if not status:
        add_issue(issues, path, root, "status", "task status is required")
    elif status not in TASK_STATUSES:
        add_issue(issues, path, root, "status", f"unsupported task status {status!r}")
    elif status in DEPRECATED_TASK_STATUSES:
        add_issue(issues, path, root, "status", f"deprecated task status {status!r}; use {DEPRECATED_TASK_STATUSES[status]!r}")

    task_id = scalar_text(frontmatter.get("id") or "")
    if not task_id:
        add_issue(issues, path, root, "id", "task id is required")
    elif task_id != path.stem:
        add_issue(issues, path, root, "id", f"task id {task_id!r} must match filename stem {path.stem!r}")

    priority = parse_priority(frontmatter.get("priority"))
    if frontmatter.get("priority") not in (None, "") and priority not in PRIORITIES:
        add_issue(issues, path, root, "priority", "priority must be an integer from 1 to 5")

    deadline_type = normalize_status(frontmatter.get("deadline_type"))
    if deadline_type and deadline_type not in DEADLINE_TYPES:
        add_issue(issues, path, root, "deadline_type", "deadline_type must be hard or soft")
    if status not in CLOSED_STATUSES and any(frontmatter.get(field) for field in ("due", "date", "start_date")) and not deadline_type:
        add_issue(issues, path, root, "deadline_type", "open dated tasks must explicitly set deadline_type to hard or soft")

    for field in ("due", "date", "start_date", "end_date", "completed", "last_touched"):
        if field in frontmatter and not is_iso_date(frontmatter.get(field)):
            add_issue(issues, path, root, field, "date fields must use YYYY-MM-DD")

    if "urgent" in frontmatter and not is_boolean_like(frontmatter.get("urgent")):
        add_issue(issues, path, root, "urgent", "urgent must be boolean-like")

    for field, replacement in DEPRECATED_TASK_OWNERSHIP_FIELDS.items():
        if field in frontmatter:
            add_issue(issues, path, root, field, f"deprecated task ownership field; use {replacement!r}")

    ownership_values = [field for field in TASK_OWNERSHIP_FIELDS if frontmatter.get(field)]
    if len(ownership_values) > 1:
        add_issue(issues, path, root, "assignee", f"use only one task ownership field, found: {', '.join(sorted(ownership_values))}")
    for field in TASK_OWNERSHIP_FIELDS:
        value = frontmatter.get(field)
        if isinstance(value, (dict, list)):
            add_issue(issues, path, root, field, "task ownership fields must be scalar text")

    if path.parts[-2] == "done" and status not in DONE_STATUSES:
        add_issue(issues, path, root, "status", "tasks/done files must have a done/completed status")
    if path.parts[-2] == "cancelled" and status not in CANCELLED_STATUSES:
        add_issue(issues, path, root, "status", "tasks/cancelled files must have a cancelled/archive status")
    if path.parts[-2] in {"active", "waiting"} and status in CLOSED_STATUSES:
        add_issue(issues, path, root, "status", "closed tasks must not remain in active/waiting directories")

    return issues


def validate_unique_task_ids(task_frontmatter: Iterable[tuple[Path, dict[str, Any]]], root: Path) -> list[SchemaIssue]:
    issues: list[SchemaIssue] = []
    seen: dict[str, Path] = {}
    for path, frontmatter in task_frontmatter:
        task_id = scalar_text(frontmatter.get("id") or "")
        if not task_id:
            continue
        if task_id in seen:
            add_issue(issues, path, root, "id", f"duplicate task id also used by {relpath(seen[task_id], root)}")
        else:
            seen[task_id] = path
    return issues


def validate_travel_ledger(path: Path, frontmatter: dict[str, Any], root: Path) -> list[SchemaIssue]:
    issues: list[SchemaIssue] = []
    ledger = frontmatter.get("ledger")
    if ledger is None:
        return issues
    if not isinstance(ledger, list):
        add_issue(issues, path, root, "ledger", "travel ledger must be a list of row objects")
        return issues

    seen_ids: set[str] = set()
    for index, row in enumerate(ledger):
        prefix = f"ledger[{index}]"
        if not isinstance(row, dict):
            add_issue(issues, path, root, prefix, "ledger rows must be objects")
            continue
        unknown = sorted(set(str(key) for key in row) - TRAVEL_LEDGER_FIELDS)
        if unknown:
            add_issue(issues, path, root, prefix, f"unknown ledger field(s): {', '.join(unknown)}")
        missing = sorted(field for field in TRAVEL_LEDGER_REQUIRED_FIELDS if not row.get(field))
        if missing:
            add_issue(issues, path, root, prefix, f"missing required ledger field(s): {', '.join(missing)}")

        row_id = scalar_text(row.get("id") or "")
        if row_id:
            if row_id in seen_ids:
                add_issue(issues, path, root, f"{prefix}.id", f"duplicate ledger id {row_id!r}")
            seen_ids.add(row_id)

        status = normalize_status(row.get("status"))
        if status and status not in TRAVEL_LEDGER_STATUSES:
            add_issue(issues, path, root, f"{prefix}.status", f"unsupported ledger status {status!r}")

        if row.get("currency") and len(str(row.get("currency")).strip()) != 3:
            add_issue(issues, path, root, f"{prefix}.currency", "currency must be a 3-letter code")

        for amount_field in ("estimate", "estimate_usd", "actual", "actual_usd", "reimbursed_amount", "reimbursed_amount_usd"):
            if amount_field in row and row.get(amount_field) not in (None, "") and not is_number(row.get(amount_field)):
                add_issue(issues, path, root, f"{prefix}.{amount_field}", "amount fields must be numeric")

        if "reimbursable" in row and not is_boolean_like(row.get("reimbursable")):
            add_issue(issues, path, root, f"{prefix}.reimbursable", "reimbursable must be boolean-like")

        if "reimbursed_date" in row and not is_iso_date(row.get("reimbursed_date")):
            add_issue(issues, path, root, f"{prefix}.reimbursed_date", "reimbursed_date must use YYYY-MM-DD")

    return issues


def validate_root(root: Path = ROOT) -> list[SchemaIssue]:
    root = root.resolve()
    issues: list[SchemaIssue] = []
    task_frontmatter: list[tuple[Path, dict[str, Any]]] = []

    for path in sorted((root / "tasks").glob("*/*.md")):
        if path.name.lower() == "readme.md":
            continue
        frontmatter, _ = split_frontmatter(path.read_text(encoding="utf-8", errors="replace"))
        if frontmatter.get("kind") != "task":
            continue
        task_frontmatter.append((path, frontmatter))
        issues.extend(validate_task(path, frontmatter, root))

    issues.extend(validate_unique_task_ids(task_frontmatter, root))

    for path in sorted(root.rglob("*.md")):
        if any(part in {".git", ".venv", "node_modules", "dashboard", "data"} for part in path.relative_to(root).parts):
            continue
        frontmatter, _ = split_frontmatter(path.read_text(encoding="utf-8", errors="replace"))
        if frontmatter.get("kind") == "travel-ledger" or path.name == "travel_ledger.md":
            issues.extend(validate_travel_ledger(path, frontmatter, root))

    return issues


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT, help="Vault root to validate.")
    parser.add_argument("--json", action="store_true", help="Emit machine-readable JSON.")
    args = parser.parse_args()

    issues = validate_root(args.root)
    if args.json:
        print(json.dumps([asdict(issue) for issue in issues], indent=2))
    elif issues:
        print("Vault schema validation failed:")
        for issue in issues:
            print(f"- {issue.path} :: {issue.field}: {issue.message}")
    else:
        print("Vault schema validation passed.")
    return 1 if issues else 0


if __name__ == "__main__":
    raise SystemExit(main())
