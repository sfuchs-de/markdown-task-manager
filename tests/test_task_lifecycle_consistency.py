from __future__ import annotations

from collections import defaultdict
from pathlib import Path

from scripts.markdown_reader import split_frontmatter


ROOT = Path(__file__).resolve().parents[1]
CLOSED_STATUSES = {"done", "complete", "completed", "cancelled", "canceled", "dropped", "archived", "archive"}
DONE_STATUSES = {"done", "complete", "completed", "archived", "archive"}
CANCELLED_STATUSES = {"cancelled", "canceled", "dropped"}


def task_frontmatter() -> list[tuple[Path, dict]]:
    records: list[tuple[Path, dict]] = []
    for path in sorted((ROOT / "tasks").glob("**/*.md")):
        frontmatter, _body = split_frontmatter(path.read_text(encoding="utf-8", errors="replace"))
        if str(frontmatter.get("kind") or "").lower() == "task":
            records.append((path.relative_to(ROOT), frontmatter))
    return records


def test_task_ids_are_unique_across_lifecycle_directories() -> None:
    by_id: dict[str, list[str]] = defaultdict(list)
    for path, frontmatter in task_frontmatter():
        task_id = str(frontmatter.get("id") or "").strip()
        if task_id:
            by_id[task_id].append(str(path))

    duplicates = {task_id: paths for task_id, paths in by_id.items() if len(paths) > 1}
    assert duplicates == {}


def test_task_status_matches_lifecycle_directory() -> None:
    problems: list[str] = []
    for path, frontmatter in task_frontmatter():
        status = str(frontmatter.get("status") or "").strip().lower()
        path_text = str(path)
        if path_text.startswith("tasks/done/") and status not in DONE_STATUSES:
            problems.append(f"{path_text} has status {status!r}")
        if path_text.startswith("tasks/cancelled/") and status not in CANCELLED_STATUSES:
            problems.append(f"{path_text} has status {status!r}")
        if path_text.startswith(("tasks/active/", "tasks/waiting/")) and status in CLOSED_STATUSES:
            problems.append(f"{path_text} is closed but still in active/waiting")

    assert problems == []
