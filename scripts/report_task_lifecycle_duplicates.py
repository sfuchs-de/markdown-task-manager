#!/usr/bin/env python3
"""Report task IDs that appear in multiple lifecycle folders."""
from __future__ import annotations

import argparse
import json
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

try:
    from markdown_reader import split_frontmatter
except ModuleNotFoundError:
    from scripts.markdown_reader import split_frontmatter


try:
    from scripts.workbench_paths import VAULT_ROOT
except ImportError:  # pragma: no cover
    from workbench_paths import VAULT_ROOT

ROOT = VAULT_ROOT
LIFECYCLE_DIRS = {"active", "waiting", "done", "cancelled", "someday"}


@dataclass(frozen=True)
class DuplicateTaskId:
    task_id: str
    folders: list[str]
    paths: list[str]


def scalar(value: Any) -> str:
    return str(value or "").strip().strip('"').strip("'")


def task_id_for(path: Path, frontmatter: dict[str, Any]) -> str:
    return scalar(frontmatter.get("id")) or path.stem


def lifecycle_folder(path: Path) -> str:
    parts = path.parts
    if len(parts) >= 3 and parts[-3] == "tasks":
        return parts[-2]
    return ""


def duplicate_task_ids(root: Path = ROOT) -> list[DuplicateTaskId]:
    root = root.resolve()
    by_id: dict[str, list[Path]] = {}
    for path in sorted((root / "tasks").glob("*/*.md")):
        if path.name.lower() == "readme.md":
            continue
        folder = path.parent.name
        if folder not in LIFECYCLE_DIRS:
            continue
        frontmatter, _body = split_frontmatter(path.read_text(encoding="utf-8", errors="replace"))
        by_id.setdefault(task_id_for(path, frontmatter), []).append(path)

    duplicates: list[DuplicateTaskId] = []
    for task_id, paths in sorted(by_id.items()):
        folders = sorted({path.parent.name for path in paths})
        if len(folders) <= 1:
            continue
        duplicates.append(
            DuplicateTaskId(
                task_id=task_id,
                folders=folders,
                paths=[path.relative_to(root).as_posix() for path in paths],
            )
        )
    return duplicates


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT, help="Vault root to inspect.")
    parser.add_argument("--json", action="store_true", help="Emit machine-readable JSON.")
    args = parser.parse_args()

    duplicates = duplicate_task_ids(args.root)
    if args.json:
        print(json.dumps([asdict(item) for item in duplicates], indent=2))
        return 0

    if not duplicates:
        print("No duplicate task IDs across lifecycle folders.")
        return 0

    print(f"Duplicate task IDs across lifecycle folders: {len(duplicates)}")
    for item in duplicates:
        print(f"- {item.task_id} [{', '.join(item.folders)}]")
        for path in item.paths:
            print(f"  - {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
