from __future__ import annotations

from pathlib import Path

from scripts.report_task_lifecycle_duplicates import duplicate_task_ids


def write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def task(task_id: str, status: str = "active") -> str:
    return f"""---
id: {task_id}
kind: task
status: {status}
---
# {task_id}
"""


def test_duplicate_report_flags_cross_lifecycle_task_ids(tmp_path: Path) -> None:
    write(tmp_path / "tasks/active/t-shared.md", task("t-shared", "active"))
    write(tmp_path / "tasks/done/t-shared.md", task("t-shared", "done"))
    write(tmp_path / "tasks/active/t-other.md", task("t-other", "active"))

    duplicates = duplicate_task_ids(tmp_path)

    assert len(duplicates) == 1
    assert duplicates[0].task_id == "t-shared"
    assert duplicates[0].folders == ["active", "done"]
    assert duplicates[0].paths == ["tasks/active/t-shared.md", "tasks/done/t-shared.md"]


def test_duplicate_report_ignores_readmes_and_same_lifecycle_names(tmp_path: Path) -> None:
    write(tmp_path / "tasks/active/README.md", "# Active\n")
    write(tmp_path / "tasks/active/t-same.md", task("t-same", "active"))
    write(tmp_path / "tasks/active/t-same-copy.md", task("t-same-copy", "active"))

    assert duplicate_task_ids(tmp_path) == []
