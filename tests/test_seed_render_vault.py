from __future__ import annotations

from pathlib import Path

import pytest

from scripts.seed_render_vault import BACKUP_RETENTION, backup_vault, calculate_drift, copy_missing, force_sync_paths, main, prune_backups, reset_from_seed, vault_manifest_path, write_manifest


def write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def test_dry_run_drift_reports_missing_changed_and_extra_without_writing(tmp_path: Path) -> None:
    source = tmp_path / "source"
    target = tmp_path / "target"
    write(source / "tasks/active/missing.md", "# Missing\n")
    write(source / "tasks/active/changed.md", "# Source\n")
    write(target / "tasks/active/changed.md", "# Target\n")
    write(target / "tasks/active/extra.md", "# Extra\n")

    drift = calculate_drift(source, target, include_paths=True)

    assert drift["counts"]["missing"] == 1
    assert drift["counts"]["changed"] == 1
    assert drift["counts"]["extra"] == 1
    assert drift["paths"]["missing"] == ["tasks/active/missing.md"]
    assert not vault_manifest_path(target).exists()


def test_copy_missing_does_not_overwrite_existing_files(tmp_path: Path) -> None:
    source = tmp_path / "source"
    target = tmp_path / "target"
    write(source / "tasks/active/new.md", "# New\n")
    write(source / "tasks/active/existing.md", "# Source\n")
    write(target / "tasks/active/existing.md", "# Hosted Edit\n")

    result = copy_missing(source, target)

    assert result == {"copied": 1, "skipped": 1}
    assert (target / "tasks/active/new.md").read_text(encoding="utf-8") == "# New\n"
    assert (target / "tasks/active/existing.md").read_text(encoding="utf-8") == "# Hosted Edit\n"


def test_force_sync_paths_overwrites_named_task_and_removes_stale_lifecycle_duplicate(tmp_path: Path) -> None:
    source = tmp_path / "source"
    target = tmp_path / "target"
    done_task = """---
kind: task
id: t-example
status: done
---
# Done
"""
    stale_task = """---
kind: task
id: t-example
status: open
---
# Stale
"""
    write(source / "tasks/done/t-example.md", done_task)
    write(target / "tasks/active/t-example.md", stale_task)
    write(target / "tasks/someday/t-example.md", stale_task)
    write(target / "tasks/cancelled/t-example.md", stale_task)
    write(target / "tasks/active/unrelated.md", "# Hosted edit\n")

    result = force_sync_paths(source, target, ["tasks/done/t-example.md"])

    assert result == {"force_synced": 1, "force_removed_stale": 3, "force_missing": 0, "force_skipped": 0}
    assert (target / "tasks/done/t-example.md").read_text(encoding="utf-8") == done_task
    assert not (target / "tasks/active/t-example.md").exists()
    assert not (target / "tasks/someday/t-example.md").exists()
    assert not (target / "tasks/cancelled/t-example.md").exists()
    assert (target / "tasks/active/unrelated.md").read_text(encoding="utf-8") == "# Hosted edit\n"


def test_force_sync_paths_removes_completed_task_copies(tmp_path: Path) -> None:
    source = tmp_path / "source"
    target = tmp_path / "target"
    annual_form_done = """---
kind: task
id: t-annual-form
status: done
---
# Complete annual example form
"""
    travel_approval_done = """---
kind: task
id: t-travel-approval
status: done
---
# Record example travel approval
"""
    stale_active = """---
kind: task
status: open
urgent: true
---
# Stale focus copy
"""
    write(source / "tasks/done/t-annual-form.md", annual_form_done)
    write(source / "tasks/done/t-travel-approval.md", travel_approval_done)
    write(target / "tasks/active/t-annual-form.md", stale_active.replace("status: open", "id: t-annual-form\nstatus: open"))
    write(target / "tasks/active/t-travel-approval.md", stale_active.replace("status: open", "id: t-travel-approval\nstatus: open"))

    result = force_sync_paths(
        source,
        target,
        ["tasks/done/t-annual-form.md", "tasks/done/t-travel-approval.md"],
    )

    assert result == {"force_synced": 2, "force_removed_stale": 2, "force_missing": 0, "force_skipped": 0}
    assert (target / "tasks/done/t-annual-form.md").read_text(encoding="utf-8") == annual_form_done
    assert (target / "tasks/done/t-travel-approval.md").read_text(encoding="utf-8") == travel_approval_done
    assert not (target / "tasks/active/t-annual-form.md").exists()
    assert not (target / "tasks/active/t-travel-approval.md").exists()


def test_reset_from_seed_requires_backup_and_restores_repo_managed_files(tmp_path: Path) -> None:
    source = tmp_path / "source"
    target = tmp_path / "target"
    write(source / "tasks/active/changed.md", "# Source\n")
    write(target / "tasks/active/changed.md", "# Hosted Edit\n")
    write(target / "tasks/active/extra.md", "# Extra\n")

    with pytest.raises(SystemExit):
        reset_from_seed(source, target, backup=False)

    result = reset_from_seed(source, target, backup=True)

    assert result["restored"] == 1
    assert (target / "tasks/active/changed.md").read_text(encoding="utf-8") == "# Source\n"
    assert not (target / "tasks/active/extra.md").exists()
    assert (result["backup_path"] / "tasks/active/changed.md").exists()
    assert (result["backup_path"] / "tasks/active/extra.md").exists()


def test_env_seed_mode_reset_realigns_vault_with_backup(tmp_path: Path, monkeypatch) -> None:
    source = tmp_path / "source"
    target = tmp_path / "target"
    write(source / "tasks/active/keep.md", "# Source\n")
    write(target / "tasks/active/keep.md", "# Hosted stale edit\n")
    write(target / "tasks/active/ghost.md", "# Hosted-only ghost\n")

    monkeypatch.setenv("PM_VAULT_SEED_SOURCE", str(source))
    monkeypatch.setenv("PM_VAULT_ROOT", str(target))
    monkeypatch.setenv("PM_VAULT_SEED_MODE", "reset-from-seed")
    monkeypatch.setattr("sys.argv", ["seed_render_vault.py"])

    # reset-from-seed auto-enables backup even without --backup, so this must not raise.
    assert main() == 0

    # Vault realigned to the deployed source, ghost removed, manifest records the mode.
    assert (target / "tasks/active/keep.md").read_text(encoding="utf-8") == "# Source\n"
    assert not (target / "tasks/active/ghost.md").exists()
    manifest = vault_manifest_path(target).read_text(encoding="utf-8")
    assert '"mode": "reset-from-seed"' in manifest
    backups = list((target / ".backups").glob("vault-*/tasks/active/ghost.md"))
    assert backups, "prior vault should be backed up before reset"


def test_backup_vault_prunes_old_snapshots_and_skips_excluded(tmp_path: Path) -> None:
    target = tmp_path / "target"
    # Pre-existing snapshots well over the retention limit (old timestamps so the
    # freshly written one always sorts newest and is kept).
    for i in range(BACKUP_RETENTION + 4):
        write(target / ".backups" / f"vault-2000010{i}T000000Z" / "tasks/active/old.md", "# old\n")
    # Canonical content plus things that must never be archived (these are what
    # previously bloated the disk: the git working tree, generated dashboards/data).
    write(target / "tasks/active/keep.md", "# keep\n")
    write(target / ".git" / "objects" / "blob", "x" * 10_000)
    write(target / "dashboard" / "today.html", "<html></html>")
    write(target / "data" / "tasks.json", "[]")

    backup_root = backup_vault(target)

    snapshots = sorted(p for p in (target / ".backups").iterdir() if p.name.startswith("vault-"))
    assert len(snapshots) == BACKUP_RETENTION  # pruned to retention, including the new snapshot
    assert backup_root == snapshots[-1]
    # The new snapshot archives canonical vault content...
    assert (backup_root / "tasks/active/keep.md").read_text(encoding="utf-8") == "# keep\n"
    # ...but excludes the git tree, dashboards, and generated data.
    assert not (backup_root / ".git").exists()
    assert not (backup_root / "dashboard").exists()
    assert not (backup_root / "data").exists()


def test_prune_backups_keeps_newest(tmp_path: Path) -> None:
    target = tmp_path / "target"
    for i in range(6):
        write(target / ".backups" / f"vault-2000010{i}T000000Z" / "marker", "x")
    removed = prune_backups(target, keep=2)
    remaining = sorted(p.name for p in (target / ".backups").iterdir())
    assert remaining == ["vault-20000104T000000Z", "vault-20000105T000000Z"]
    assert len(removed) == 4


def test_write_manifest_records_seed_state(tmp_path: Path) -> None:
    target = tmp_path / "target"
    source = tmp_path / "source"
    write_manifest(target, source=source, mode="copy-missing", counts={"copied": 1})

    manifest = vault_manifest_path(target).read_text(encoding="utf-8")
    assert '"mode": "copy-missing"' in manifest
    assert '"copied": 1' in manifest
