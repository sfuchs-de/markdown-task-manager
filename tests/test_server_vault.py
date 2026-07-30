from __future__ import annotations

import time
from pathlib import Path

import pytest

from server.vault import SaveConflictError, VaultError, VaultService


def write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def test_scan_extracts_frontmatter_title_links_and_backlinks(tmp_path: Path) -> None:
    write(
        tmp_path / "task.md",
        """---
type: Type
template: |
  ---
  kind: task
  ---
  # New Task
---
# Task
""",
    )
    write(
        tmp_path / "tasks/active/t-one.md",
        """---
kind: task
status: open
project: alpha
priority: 1
urgent: false
due: 2026-05-10
related_to:
  - "[[Alpha Project]]"
---
# First Task

See [[Alpha Project]].
""",
    )
    write(
        tmp_path / "projects/alpha/README.md",
        """---
kind: project
id: alpha
title: Alpha Project
status: active
---
# Alpha Project
""",
    )

    entries = VaultService(tmp_path).scan_entries()
    task = next(e for e in entries if e["path"] == "tasks/active/t-one.md")
    project = next(e for e in entries if e["path"] == "projects/alpha/README.md")

    assert task["title"] == "First Task"
    assert task["kind"] == "task"
    assert task["priority"] == "1"
    assert task["relationships"]["related_to"] == ["Alpha Project"]
    assert task["outgoing_links"] == ["Alpha Project"]
    assert project["backlinks"] == ["tasks/active/t-one.md"]


def test_scan_entries_reuses_unchanged_files_and_reparses_changed_files(tmp_path: Path, monkeypatch) -> None:
    write(tmp_path / "notes/a.md", "# A\n")
    write(tmp_path / "notes/b.md", "# B\n")
    service = VaultService(tmp_path)
    original_parse = VaultService.parse_file
    parsed: list[str] = []

    def counting_parse(self: VaultService, path: Path) -> dict:
        parsed.append(self.relpath(path))
        return original_parse(self, path)

    monkeypatch.setattr(VaultService, "parse_file", counting_parse)

    service.scan_entries(force=True)
    assert sorted(parsed) == ["notes/a.md", "notes/b.md"]

    parsed.clear()
    service.scan_entries()
    assert parsed == []

    time.sleep(0.01)
    write(tmp_path / "notes/b.md", "# B changed\n")
    parsed.clear()
    entries = service.scan_entries()

    assert parsed == ["notes/b.md"]
    assert {entry["title"] for entry in entries} == {"A", "B changed"}


def test_scan_entries_returns_copies_of_cached_entries(tmp_path: Path) -> None:
    write(tmp_path / "notes/a.md", "# A\n\nSee [[B]].\n")
    write(tmp_path / "notes/b.md", "# B\n")
    service = VaultService(tmp_path)

    first = service.scan_entries(force=True)
    first_by_path = {entry["path"]: entry for entry in first}
    first_by_path["notes/a.md"]["title"] = "Mutated A"
    first_by_path["notes/a.md"]["outgoing_links"].append("Injected")
    first_by_path["notes/b.md"]["backlinks"].append("Injected")
    first_by_path["notes/a.md"]["properties"]["custom"] = "mutated"

    second = {entry["path"]: entry for entry in service.scan_entries()}

    assert second["notes/a.md"]["title"] == "A"
    assert second["notes/a.md"]["outgoing_links"] == ["B"]
    assert second["notes/b.md"]["backlinks"] == ["notes/a.md"]
    assert "custom" not in second["notes/a.md"]["properties"]


def test_scan_entries_preserves_safe_structured_ledger_properties(tmp_path: Path) -> None:
    write(
        tmp_path / "projects/operations/travel_ledger.md",
        """---
kind: travel-ledger
project: operations
ledger:
  - trip: Westport
    item: Airport ride
    actual: 38.50
    currency: EUR
    actual_usd: 41.08
    reimbursed_amount_usd: 0
    status: submitted
unsafe_nested:
  token: hidden
---
# Travel ledger
""",
    )
    service = VaultService(tmp_path)

    first = service.scan_entries(force=True)
    entry = next(e for e in first if e["path"] == "projects/operations/travel_ledger.md")
    entry["properties"]["ledger"][0]["item"] = "Mutated"

    second = next(
        e for e in service.scan_entries()
        if e["path"] == "projects/operations/travel_ledger.md"
    )

    assert second["properties"]["ledger"][0]["item"] == "Airport ride"
    assert second["properties"]["ledger"][0]["actual_usd"] == 41.08
    assert "unsafe_nested" not in second["properties"]


def test_scan_cache_invalidates_after_writes_moves_and_creates(tmp_path: Path, monkeypatch) -> None:
    write(tmp_path / "notes/a.md", "# A\n")
    write(tmp_path / "tasks/active/t-one.md", "---\nkind: task\nstatus: open\n---\n# One\n")
    service = VaultService(tmp_path)
    original_parse = VaultService.parse_file
    parsed: list[str] = []

    def counting_parse(self: VaultService, path: Path) -> dict:
        parsed.append(self.relpath(path))
        return original_parse(self, path)

    monkeypatch.setattr(VaultService, "parse_file", counting_parse)

    service.scan_entries(force=True)
    parsed.clear()
    service.save_file("notes/a.md", "# A edited\n")
    service.scan_entries()
    assert sorted(parsed) == ["notes/a.md", "tasks/active/t-one.md"]

    parsed.clear()
    service.patch_metadata("notes/a.md", {"project": "alpha"})
    parsed.clear()
    service.scan_entries()
    assert sorted(parsed) == ["notes/a.md", "tasks/active/t-one.md"]

    parsed.clear()
    service.patch_task_metadata("tasks/active/t-one.md", {"status": "done"})
    parsed.clear()
    service.scan_entries()
    assert sorted(parsed) == ["notes/a.md", "tasks/done/t-one.md"]

    parsed.clear()
    service.create_file("note", "New Capture")
    service.scan_entries()
    assert "notes/a.md" in parsed
    assert "tasks/done/t-one.md" in parsed
    assert any(path.startswith("_inbox/") and path.endswith("new-capture.md") for path in parsed)


def test_scan_infers_organization_from_paths_without_editing_frontmatter(tmp_path: Path) -> None:
    write(tmp_path / "projects/alpha/next.md", "# Next\n")
    write(tmp_path / "projects/alpha/modeling/2026-05-06-demand.md", "# Demand model\n")
    write(tmp_path / "areas/health/notes/plan.md", "# Health plan\n")
    write(tmp_path / "docs/runbook.md", "# Runbook\n")

    entries = {e["path"]: e for e in VaultService(tmp_path).scan_entries()}

    assert entries["projects/alpha/next.md"]["kind"] == "project-note"
    assert entries["projects/alpha/next.md"]["note_role"] == "next-actions"
    assert entries["projects/alpha/next.md"]["project"] == "alpha"
    assert entries["projects/alpha/next.md"]["project_source"] == "path"
    assert entries["projects/alpha/modeling/2026-05-06-demand.md"]["kind"] == "model-note"
    assert entries["projects/alpha/modeling/2026-05-06-demand.md"]["note_role"] == "modeling"
    assert entries["areas/health/notes/plan.md"]["collection"] == "area"
    assert entries["areas/health/notes/plan.md"]["area"] == "health"
    assert entries["docs/runbook.md"]["collection"] == "docs"
    assert entries["docs/runbook.md"]["kind"] == "documentation"


def test_excludes_private_generated_and_hidden_paths(tmp_path: Path) -> None:
    write(tmp_path / "notes/open.md", "# Open")
    write(tmp_path / "private/secret.md", "# Secret")
    write(tmp_path / "data/cache.md", "# Cache")
    write(tmp_path / "dashboard/index.md", "# Dashboard")
    write(tmp_path / ".github/workflow.md", "# Hidden")

    paths = {e["path"] for e in VaultService(tmp_path).scan_entries()}

    assert paths == {"notes/open.md"}


def test_rejects_path_traversal_and_non_markdown(tmp_path: Path) -> None:
    service = VaultService(tmp_path)
    with pytest.raises(VaultError):
        service.get_file("../outside.md")
    with pytest.raises(VaultError):
        service.save_file("notes/data.json", "{}")


def test_save_file_detects_modified_at_conflict(tmp_path: Path) -> None:
    path = tmp_path / "notes/test.md"
    write(path, "# Original\n")
    service = VaultService(tmp_path)
    original = service.get_file("notes/test.md")
    time.sleep(0.01)
    path.write_text("# External edit\n", encoding="utf-8")

    with pytest.raises(SaveConflictError):
        service.save_file("notes/test.md", "# My edit\n", original["modified_at"])


def test_save_file_can_move_task_lifecycle_path(tmp_path: Path) -> None:
    write(tmp_path / "tasks/active/t-lifecycle.md", "---\nkind: task\nstatus: open\n---\n# Lifecycle\n")
    service = VaultService(tmp_path)
    original = service.get_file("tasks/active/t-lifecycle.md")

    saved = service.save_file(
        "tasks/active/t-lifecycle.md",
        "---\nkind: task\nstatus: waiting\n---\n# Lifecycle\n\nWaiting on reply.\n",
        original["modified_at"],
        "tasks/waiting/t-lifecycle.md",
    )

    assert saved["path"] == "tasks/waiting/t-lifecycle.md"
    assert not (tmp_path / "tasks/active/t-lifecycle.md").exists()
    assert (tmp_path / "tasks/waiting/t-lifecycle.md").read_text(encoding="utf-8").endswith("\n")


def test_save_file_move_rejects_invalid_lifecycle_destinations(tmp_path: Path) -> None:
    write(tmp_path / "tasks/active/t-lifecycle.md", "---\nkind: task\nstatus: open\n---\n# Lifecycle\n")
    write(tmp_path / "notes/plain.md", "# Plain\n")
    service = VaultService(tmp_path)

    with pytest.raises(VaultError):
        service.save_file("tasks/active/t-lifecycle.md", "# Bad\n", move_to="../outside.md")
    with pytest.raises(VaultError):
        service.save_file("tasks/active/t-lifecycle.md", "# Bad\n", move_to="tasks/done/t-lifecycle.txt")
    with pytest.raises(VaultError):
        service.save_file("tasks/active/t-lifecycle.md", "# Bad\n", move_to="notes/t-lifecycle.md")
    with pytest.raises(VaultError):
        service.save_file("notes/plain.md", "# Bad\n", move_to="tasks/done/plain.md")


def test_save_file_move_detects_conflict_before_move(tmp_path: Path) -> None:
    path = tmp_path / "tasks/active/t-lifecycle.md"
    write(path, "---\nkind: task\nstatus: open\n---\n# Lifecycle\n")
    service = VaultService(tmp_path)
    original = service.get_file("tasks/active/t-lifecycle.md")
    time.sleep(0.01)
    path.write_text("---\nkind: task\nstatus: active\n---\n# External Edit\n", encoding="utf-8")

    with pytest.raises(SaveConflictError):
        service.save_file(
            "tasks/active/t-lifecycle.md",
            "---\nkind: task\nstatus: done\n---\n# Lifecycle\n",
            original["modified_at"],
            "tasks/done/t-lifecycle.md",
        )
    assert path.exists()
    assert not (tmp_path / "tasks/done/t-lifecycle.md").exists()


def test_save_file_move_uses_unique_destination_on_collision(tmp_path: Path) -> None:
    write(tmp_path / "tasks/active/t-collision.md", "---\nkind: task\nstatus: open\n---\n# Source\n")
    write(tmp_path / "tasks/done/t-collision.md", "---\nkind: task\nstatus: done\n---\n# Existing\n")
    service = VaultService(tmp_path)

    saved = service.save_file(
        "tasks/active/t-collision.md",
        "---\nkind: task\nstatus: done\ncompleted: 2026-05-08\n---\n# Source\n",
        move_to="tasks/done/t-collision.md",
    )

    assert saved["path"] == "tasks/done/t-collision-2.md"
    assert (tmp_path / "tasks/done/t-collision.md").read_text(encoding="utf-8").endswith("# Existing\n")
    assert "completed: 2026-05-08" in (tmp_path / "tasks/done/t-collision-2.md").read_text(encoding="utf-8")
    assert not (tmp_path / "tasks/active/t-collision.md").exists()


def test_patch_task_metadata_updates_and_clears_allowed_fields(tmp_path: Path) -> None:
    write(
        tmp_path / "tasks/active/t-edit.md",
        """---
kind: task
status: open
project: alpha
priority: 1
due: 2026-05-10
estimate_minutes: 90
assignee: Owner
---
# Editable Task
""",
    )
    service = VaultService(tmp_path)

    updated = service.patch_task_metadata(
        "tasks/active/t-edit.md",
        {
            "status": "waiting",
            "priority": "",
            "urgent": "true",
            "due": "2026-05-12",
            "project": "beta",
            "estimate_minutes": "",
            "assignee": "Avery",
        },
    )

    assert updated["frontmatter"]["status"] == "waiting"
    assert updated["frontmatter"]["urgent"] is True
    assert updated["path"] == "tasks/waiting/t-edit.md"
    assert updated["frontmatter"]["due"] == "2026-05-12"
    assert updated["frontmatter"]["project"] == "beta"
    assert updated["frontmatter"]["assignee"] == "Avery"
    assert "priority" not in updated["frontmatter"]
    assert "estimate_minutes" not in updated["frontmatter"]
    assert not (tmp_path / "tasks/active/t-edit.md").exists()
    rescanned = {entry["path"]: entry for entry in service.scan_entries()}
    assert rescanned["tasks/waiting/t-edit.md"]["status"] == "waiting"
    assert rescanned["tasks/waiting/t-edit.md"]["urgent"] is True
    assert rescanned["tasks/waiting/t-edit.md"]["priority"] is None
    assert rescanned["tasks/waiting/t-edit.md"]["assignee"] == "Avery"


def test_patch_task_metadata_moves_done_task_and_sets_completed(tmp_path: Path) -> None:
    write(tmp_path / "tasks/waiting/t-finish.md", "---\nkind: task\nstatus: waiting\n---\n# Finish Task\n")
    service = VaultService(tmp_path)

    updated = service.patch_task_metadata("tasks/waiting/t-finish.md", {"status": "done"})

    assert updated["path"] == "tasks/done/t-finish.md"
    assert updated["frontmatter"]["status"] == "done"
    assert updated["frontmatter"]["completed"]
    assert not (tmp_path / "tasks/waiting/t-finish.md").exists()
    text = (tmp_path / "tasks/done/t-finish.md").read_text(encoding="utf-8")
    assert "status: done" in text
    assert "completed:" in text


def test_patch_task_metadata_preserves_existing_completed_date(tmp_path: Path) -> None:
    write(
        tmp_path / "tasks/waiting/t-finished-before.md",
        "---\nkind: task\nstatus: waiting\ncompleted: 2026-05-01\n---\n# Finished Before\n",
    )
    service = VaultService(tmp_path)

    updated = service.patch_task_metadata("tasks/waiting/t-finished-before.md", {"status": "done"})

    assert updated["path"] == "tasks/done/t-finished-before.md"
    assert updated["frontmatter"]["completed"] == "2026-05-01"
    assert "completed: 2026-05-01" in (tmp_path / "tasks/done/t-finished-before.md").read_text(encoding="utf-8")


def test_patch_task_metadata_moves_waiting_task_back_to_active(tmp_path: Path) -> None:
    write(tmp_path / "tasks/waiting/t-reactivate.md", "---\nkind: task\nstatus: waiting\n---\n# Reactivate\n")
    service = VaultService(tmp_path)

    updated = service.patch_task_metadata("tasks/waiting/t-reactivate.md", {"status": "active"})

    assert updated["path"] == "tasks/active/t-reactivate.md"
    assert updated["frontmatter"]["status"] == "active"
    assert not (tmp_path / "tasks/waiting/t-reactivate.md").exists()


def test_patch_task_metadata_rejects_invalid_fields_and_non_tasks(tmp_path: Path) -> None:
    write(tmp_path / "tasks/active/t-edit.md", "---\nkind: task\nstatus: open\n---\n# Editable Task\n")
    write(tmp_path / "notes/plain.md", "# Plain Note\n")
    service = VaultService(tmp_path)

    with pytest.raises(VaultError):
        service.patch_task_metadata("tasks/active/t-edit.md", {"owner": "someone"})
    with pytest.raises(VaultError):
        service.patch_task_metadata("tasks/active/t-edit.md", {"status": ""})
    with pytest.raises(VaultError):
        service.patch_task_metadata("tasks/active/t-edit.md", {"priority": "9"})
    with pytest.raises(VaultError):
        service.patch_task_metadata("tasks/active/t-edit.md", {"due": "tomorrow"})
    with pytest.raises(VaultError):
        service.patch_task_metadata("notes/plain.md", {"status": "open"})


def test_patch_task_metadata_detects_modified_at_conflict(tmp_path: Path) -> None:
    path = tmp_path / "tasks/active/t-edit.md"
    write(path, "---\nkind: task\nstatus: open\n---\n# Editable Task\n")
    service = VaultService(tmp_path)
    original = service.get_file("tasks/active/t-edit.md")
    time.sleep(0.01)
    path.write_text("---\nkind: task\nstatus: active\n---\n# External Edit\n", encoding="utf-8")

    with pytest.raises(SaveConflictError):
        service.patch_task_metadata("tasks/active/t-edit.md", {"status": "waiting"}, original["modified_at"])


def test_create_uses_type_template_and_unique_path(tmp_path: Path) -> None:
    write(
        tmp_path / "task.md",
        """---
type: Type
template: |
  ---
  kind: task
  status: active
  ---
  # New Task
---
# Task
""",
    )

    service = VaultService(tmp_path)
    created = service.create_file("task", "Draft Summer Conference plan")
    created_again = service.create_file("task", "Draft Summer Conference plan")

    assert created["path"] == "tasks/active/t-draft-summer-conference-plan.md"
    assert "# Draft Summer Conference plan" in created["content"]
    assert created_again["path"] == "tasks/active/t-draft-summer-conference-plan-2.md"
