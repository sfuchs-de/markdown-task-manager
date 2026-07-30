#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import yaml


VAULT_DIRS = {
    "_inbox",
    "archive",
    "areas",
    "codex",
    "dates",
    "docs",
    "journal",
    "notes",
    "projects",
    "sources",
    "tasks",
    "templates",
    "visuals",
}

ROOT_FILES = {
    "AGENTS.md",
    "CLAUDE.md",
    "GEMINI.md",
    "LICENSE",
    "OPENCLAW.md",
    "README.md",
    "START_HERE.md",
}

ROOT_EXTENSIONS = {".md", ".markdown", ".ics"}

EXCLUDED_PARTS = {
    ".backups",
    ".git",
    ".github",
    ".venv",
    ".pytest_cache",
    "__pycache__",
    "node_modules",
    "dist",
    "dashboard",
    "data",
    "private",
    "imports",
    "local_data",
    "large_data",
    "vault",
}

EXCLUDED_SUFFIXES = {".sqlite", ".db", ".dta", ".parquet", ".feather", ".rds", ".pyc"}
MANIFEST_NAME = ".vault_seed_manifest.json"
# reset-from-seed snapshots the hosted vault before each deploy; keep only the
# newest few so the fixed persistent disk cannot fill up over many deploys.
BACKUP_RETENTION = 5
FORCE_SYNC_CONFIG = Path("config/render_vault_force_sync.json")
TASK_LIFECYCLE_DIRS = ("active", "waiting", "someday", "done", "cancelled")


def repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def configured_path(name: str, default: Path | None = None) -> Path | None:
    raw = os.environ.get(name)
    if not raw:
        return default
    return Path(raw).expanduser().resolve()


def should_seed(source: Path, target: Path) -> bool:
    try:
        target.relative_to(source)
    except ValueError:
        return True
    return target != source


def included(rel: Path) -> bool:
    parts = rel.parts
    if not parts or any(part in EXCLUDED_PARTS for part in parts):
        return False
    if rel.name == MANIFEST_NAME:
        return False
    if rel.suffix.lower() in EXCLUDED_SUFFIXES:
        return False
    if len(parts) == 1:
        return rel.name in ROOT_FILES or rel.suffix.lower() in ROOT_EXTENSIONS
    return parts[0] in VAULT_DIRS


def vault_manifest_path(target: Path) -> Path:
    return target / MANIFEST_NAME


def app_commit() -> str | None:
    return os.environ.get("RENDER_GIT_COMMIT") or os.environ.get("GIT_COMMIT") or os.environ.get("SOURCE_VERSION")


def file_hash(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def included_files(root: Path) -> dict[str, Path]:
    files: dict[str, Path] = {}
    if not root.exists():
        return files
    for path in root.rglob("*"):
        if path.is_dir():
            continue
        rel = path.relative_to(root)
        if included(rel):
            files[rel.as_posix()] = path
    return files


def parse_force_sync_paths(raw: str) -> list[str]:
    raw = raw.strip()
    if not raw:
        return []
    try:
        value = json.loads(raw)
    except json.JSONDecodeError:
        value = [part.strip() for part in raw.replace("\n", ",").split(",")]
    if isinstance(value, dict):
        value = value.get("paths", [])
    if not isinstance(value, list):
        raise ValueError("PM_VAULT_FORCE_SYNC_PATHS must be a JSON list, JSON object with paths, or comma-separated paths")
    paths: list[str] = []
    for item in value:
        text = str(item).strip().strip("/")
        if not text:
            continue
        rel = Path(text)
        if rel.is_absolute() or ".." in rel.parts:
            raise ValueError(f"Invalid force-sync path: {item}")
        paths.append(rel.as_posix())
    return sorted(dict.fromkeys(paths))


def force_sync_paths_from_config(source: Path) -> list[str]:
    raw = os.environ.get("PM_VAULT_FORCE_SYNC_PATHS")
    if raw:
        return parse_force_sync_paths(raw)
    config_path = source / FORCE_SYNC_CONFIG
    if not config_path.exists():
        return []
    payload = json.loads(config_path.read_text(encoding="utf-8"))
    return parse_force_sync_paths(json.dumps(payload))


def markdown_frontmatter(path: Path) -> dict[str, Any]:
    try:
        raw = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return {}
    if not raw.startswith("---"):
        return {}
    parts = raw.split("---", 2)
    if len(parts) < 3:
        return {}
    parsed = yaml.safe_load(parts[1]) or {}
    return parsed if isinstance(parsed, dict) else {}


def task_id(path: Path) -> str | None:
    metadata = markdown_frontmatter(path)
    value = metadata.get("id")
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def stale_task_lifecycle_paths(target: Path, rel: str, task_identifier: str) -> list[Path]:
    destination = target / rel
    stale: list[Path] = []
    for lifecycle in TASK_LIFECYCLE_DIRS:
        folder = target / "tasks" / lifecycle
        if not folder.exists():
            continue
        for path in folder.glob("*.md"):
            if path == destination:
                continue
            if task_id(path) == task_identifier:
                stale.append(path)
    return stale


def force_sync_paths(source: Path, target: Path, rel_paths: list[str]) -> dict[str, int]:
    copied = 0
    removed_stale = 0
    missing = 0
    skipped = 0
    for rel in rel_paths:
        source_path = source / rel
        if not source_path.exists() or not source_path.is_file() or not included(Path(rel)):
            missing += 1
            continue
        destination = target / rel
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source_path, destination)
        copied += 1
        parts = Path(rel).parts
        if len(parts) == 3 and parts[0] == "tasks" and parts[1] in TASK_LIFECYCLE_DIRS:
            identifier = task_id(source_path)
            if identifier:
                for stale_path in stale_task_lifecycle_paths(target, rel, identifier):
                    stale_path.unlink()
                    removed_stale += 1
            else:
                skipped += 1
    return {
        "force_synced": copied,
        "force_removed_stale": removed_stale,
        "force_missing": missing,
        "force_skipped": skipped,
    }


def calculate_drift(source: Path, target: Path, *, include_paths: bool = False) -> dict[str, Any]:
    source_files = included_files(source)
    target_files = included_files(target)
    missing = sorted(set(source_files) - set(target_files))
    extra = sorted(set(target_files) - set(source_files))
    common = sorted(set(source_files) & set(target_files))
    changed = [
        rel
        for rel in common
        if source_files[rel].stat().st_size != target_files[rel].stat().st_size
        or file_hash(source_files[rel]) != file_hash(target_files[rel])
    ]
    same = [rel for rel in common if rel not in set(changed)]
    payload: dict[str, Any] = {
        "counts": {
            "source_files": len(source_files),
            "target_files": len(target_files),
            "missing": len(missing),
            "changed": len(changed),
            "extra": len(extra),
            "same": len(same),
            "skipped_existing": len(common),
            "skipped": len(common),
        }
    }
    if include_paths:
        payload["paths"] = {
            "missing": missing,
            "changed": sorted(changed),
            "extra": extra,
            "same": same,
        }
    return payload


def write_manifest(target: Path, *, source: Path, mode: str, counts: dict[str, Any], backup_path: Path | None = None) -> None:
    manifest = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "mode": mode,
        "seed_source": str(source),
        "vault_root": str(target),
        "app_commit": app_commit(),
        "counts": counts,
        "backup_path": str(backup_path) if backup_path else None,
    }
    target.mkdir(parents=True, exist_ok=True)
    vault_manifest_path(target).write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def copy_missing(source: Path, target: Path) -> dict[str, int]:
    copied = 0
    skipped = 0
    target.mkdir(parents=True, exist_ok=True)
    for rel, path in included_files(source).items():
        destination = target / rel
        if destination.exists():
            skipped += 1
            continue
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, destination)
        copied += 1
    return {"copied": copied, "skipped": skipped}


def prune_backups(target: Path, keep: int) -> list[Path]:
    """Delete the oldest vault snapshots under .backups, retaining the newest ``keep``.

    Snapshot dir names are timestamped (``vault-YYYYMMDDTHHMMSSZ``), so a lexical
    sort is chronological. Pruning runs *before* a new snapshot is written so a
    near-full persistent disk frees space and the deploy self-heals instead of
    failing partway through the copy.
    """
    backups_root = target / ".backups"
    if keep < 0 or not backups_root.exists():
        return []
    snapshots = sorted(
        path for path in backups_root.iterdir()
        if path.is_dir() and path.name.startswith("vault-")
    )
    removed: list[Path] = []
    while len(snapshots) > keep:
        oldest = snapshots.pop(0)
        shutil.rmtree(oldest, ignore_errors=True)
        removed.append(oldest)
    return removed


def backup_vault(target: Path) -> Path:
    # Retain only the newest BACKUP_RETENTION snapshots. Prune first (leaving room
    # for the one about to be written) so the fixed persistent disk cannot fill up
    # over many deploys and fail the reset-from-seed step.
    prune_backups(target, keep=max(0, BACKUP_RETENTION - 1))
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup_root = target / ".backups" / f"vault-{timestamp}"
    backup_root.parent.mkdir(parents=True, exist_ok=True)
    for path in (target.iterdir() if target.exists() else []):
        # Only archive canonical vault content. Skipping EXCLUDED_PARTS (.backups,
        # .git and the GitHub-sync working tree, caches, build output, generated
        # data, etc.) keeps each snapshot small; previously these inflated every
        # backup and were the main driver of disk growth.
        if path.name in EXCLUDED_PARTS:
            continue
        destination = backup_root / path.name
        if path.is_dir():
            shutil.copytree(path, destination)
        else:
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, destination)
    return backup_root


def reset_from_seed(source: Path, target: Path, *, backup: bool) -> dict[str, Any]:
    if not backup:
        raise SystemExit("reset-from-seed requires --backup so hosted vault contents are archived first.")
    backup_path = backup_vault(target)
    for rel in included_files(target):
        path = target / rel
        if path.exists():
            path.unlink()
    for rel, path in included_files(source).items():
        destination = target / rel
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, destination)
    return {"restored": len(included_files(source)), "backup_path": backup_path}


def seed_vault(source: Path, target: Path) -> tuple[int, int]:
    result = copy_missing(source, target)
    return result["copied"], result["skipped"]


def main() -> int:
    parser = argparse.ArgumentParser(description="Seed or compare a Render persistent Markdown vault.")
    # The deploy startup runs this with no args, so PM_VAULT_SEED_MODE lets the
    # hosted service pick the mode without changing the Docker command. Set it to
    # "reset-from-seed" to make every deploy realign the persistent vault with the
    # deployed commit (== GitHub main at build time), backing up first.
    env_mode = os.environ.get("PM_VAULT_SEED_MODE", "copy-missing").strip() or "copy-missing"
    if env_mode not in {"dry-run", "copy-missing", "reset-from-seed"}:
        env_mode = "copy-missing"
    parser.add_argument("--mode", choices=["dry-run", "copy-missing", "reset-from-seed"], default=env_mode)
    parser.add_argument("--backup", action="store_true", help="Required for reset-from-seed.")
    parser.add_argument("--include-paths", action="store_true", help="Print drift paths as well as counts.")
    args = parser.parse_args()
    # reset-from-seed is destructive, so always snapshot first when it runs.
    backup = args.backup or args.mode == "reset-from-seed"

    source = configured_path("PM_VAULT_SEED_SOURCE", repo_root())
    target = configured_path("PM_VAULT_ROOT")
    if target is None:
        print("PM_VAULT_ROOT is not set; skipping vault seed.")
        return 0
    if source is None or not source.exists():
        raise SystemExit(f"Seed source does not exist: {source}")
    if not should_seed(source, target):
        print("PM_VAULT_ROOT points at the source tree; skipping vault seed.")
        return 0

    if args.mode == "dry-run":
        drift = calculate_drift(source, target, include_paths=args.include_paths)
        print(json.dumps(drift, indent=2, sort_keys=True))
        return 0

    if args.mode == "copy-missing":
        result = copy_missing(source, target)
        force_result = force_sync_paths(source, target, force_sync_paths_from_config(source))
        drift = calculate_drift(source, target, include_paths=False)
        write_manifest(target, source=source, mode=args.mode, counts={**result, **force_result, **drift["counts"]})
        print(
            f"Seeded Render vault at {target}: copied {result['copied']}, skipped {result['skipped']}, "
            f"force-synced {force_result['force_synced']}."
        )
        return 0

    result = reset_from_seed(source, target, backup=backup)
    drift = calculate_drift(source, target, include_paths=False)
    write_manifest(
        target,
        source=source,
        mode=args.mode,
        counts={**{key: value for key, value in result.items() if key != "backup_path"}, **drift["counts"]},
        backup_path=result["backup_path"],
    )
    print(f"Reset Render vault at {target}: restored {result['restored']} file(s).")
    print(f"Backup: {result['backup_path']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
