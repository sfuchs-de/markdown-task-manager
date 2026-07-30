from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from threading import RLock
from typing import Any, Iterator


SYNC_ROOT_FILES = {
    "AGENTS.md",
    "CLAUDE.md",
    "GEMINI.md",
    "OPENCLAW.md",
    "README.md",
    "START_HERE.md",
}

SYNC_ROOT_EXTENSIONS = {".md", ".markdown", ".ics"}

SYNC_DIRS = {
    "_inbox",
    "archive",
    "areas",
    "config",
    "dates",
    "docs",
    "journal",
    "notes",
    "projects",
    "settings",
    "sources",
    "tasks",
    "templates",
    "visuals",
}

SYNC_EXCLUDED_PARTS = {
    ".backups",
    ".git",
    ".github",
    ".venv",
    ".pytest_cache",
    "__pycache__",
    "node_modules",
    "dist",
    "private",
    "imports",
    "local_data",
    "large_data",
    ".secrets",
}

SYNC_EXCLUDED_SUFFIXES = {".sqlite", ".db", ".dta", ".parquet", ".feather", ".rds", ".pyc"}
SYNC_LOCK = RLock()


class GitHubSyncError(ValueError):
    pass


@dataclass(frozen=True)
class GitHubSyncConfig:
    enabled: bool
    repo: str
    branch: str
    token: str
    author_name: str
    author_email: str
    remote_url_override: str
    sparse_dirs: tuple[str, ...]

    @classmethod
    def from_env(cls) -> "GitHubSyncConfig":
        repo = os.environ.get("PM_GITHUB_REPO", "").strip()
        sparse_dirs = parse_sparse_dirs(os.environ.get("PM_GITHUB_SYNC_DIRS", ""))
        return cls(
            enabled=truthy(os.environ.get("PM_GITHUB_SYNC_ENABLED", "")),
            repo=repo,
            branch=os.environ.get("PM_GITHUB_BRANCH", "main").strip() or "main",
            token=os.environ.get("PM_GITHUB_TOKEN", "").strip(),
            author_name=os.environ.get("PM_GITHUB_AUTHOR_NAME", "Render Task Manager").strip() or "Render Task Manager",
            author_email=os.environ.get("PM_GITHUB_AUTHOR_EMAIL", "render-task-manager@example.invalid").strip()
            or "render-task-manager@example.invalid",
            remote_url_override=os.environ.get("PM_GITHUB_REMOTE_URL", "").strip(),
            sparse_dirs=sparse_dirs,
        )

    @property
    def configured(self) -> bool:
        return self.enabled and bool(self.remote_url or self.repo)

    @property
    def token_configured(self) -> bool:
        return bool(self.token)

    @property
    def remote_url(self) -> str:
        if self.remote_url_override:
            return self.remote_url_override
        if not self.repo:
            return ""
        return f"https://github.com/{self.repo}.git"

    @property
    def auth_required(self) -> bool:
        return self.remote_url.startswith("https://github.com/")

    def public_dict(self) -> dict[str, Any]:
        return {
            "enabled": self.enabled,
            "configured": self.configured,
            "repo": self.repo,
            "branch": self.branch,
            "token_configured": self.token_configured,
            "author_name": self.author_name,
            "author_email": self.author_email,
            "remote": remote_label(self.remote_url),
            "sparse_dirs": list(self.sparse_dirs),
        }


def truthy(value: str) -> bool:
    return value.strip().lower() in {"1", "true", "yes", "on"}


def parse_sparse_dirs(raw: str) -> tuple[str, ...]:
    if not raw.strip():
        return tuple(sorted(SYNC_DIRS))
    parts = [part.strip().strip("/") for part in raw.replace("\n", ",").split(",")]
    valid = []
    for part in parts:
        if not part:
            continue
        rel = Path(part)
        if rel.is_absolute() or ".." in rel.parts:
            raise GitHubSyncError(f"Invalid sparse checkout path: {part}")
        valid.append(rel.as_posix())
    return tuple(sorted(dict.fromkeys(valid)))


def remote_label(remote_url: str) -> str:
    if not remote_url:
        return ""
    if remote_url.startswith("https://github.com/"):
        return remote_url.removeprefix("https://github.com/").removesuffix(".git")
    path = Path(remote_url)
    if path.exists():
        return path.name
    token = os.environ.get("PM_GITHUB_TOKEN", "")
    return remote_url.replace(token, "[redacted]") if token else remote_url


def sync_included(rel: Path) -> bool:
    parts = rel.parts
    if not parts or any(part in SYNC_EXCLUDED_PARTS for part in parts):
        return False
    if rel.suffix.lower() in SYNC_EXCLUDED_SUFFIXES:
        return False
    if len(parts) == 1:
        return rel.name in SYNC_ROOT_FILES or rel.suffix.lower() in SYNC_ROOT_EXTENSIONS
    return parts[0] in SYNC_DIRS


def sync_files(root: Path) -> dict[str, Path]:
    files: dict[str, Path] = {}
    if not root.exists():
        return files
    for path in root.rglob("*"):
        if path.is_dir():
            continue
        rel = path.relative_to(root)
        if sync_included(rel):
            files[rel.as_posix()] = path
    return files


def copy_sync_files(source: Path, target: Path, files: dict[str, Path]) -> int:
    copied = 0
    for rel, source_path in files.items():
        destination = target / rel
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source_path, destination)
        copied += 1
    return copied


def delete_sync_files(root: Path, rel_paths: set[str]) -> int:
    deleted = 0
    for rel in sorted(rel_paths, reverse=True):
        path = root / rel
        if not path.exists() or not path.is_file():
            continue
        path.unlink()
        deleted += 1
    return deleted


def backup_vault(root: Path) -> str:
    backup_root = root / ".backups"
    backup_root.mkdir(parents=True, exist_ok=True)
    destination = backup_root / f"github-sync-{time.strftime('%Y%m%d-%H%M%S')}"
    ignore = shutil.ignore_patterns(".git", ".backups", "private", "imports", "local_data", "large_data", "__pycache__")
    shutil.copytree(root, destination, ignore=ignore)
    return destination.relative_to(root).as_posix()


@contextmanager
def git_auth_env(config: GitHubSyncConfig) -> Iterator[dict[str, str]]:
    env = os.environ.copy()
    env["GIT_TERMINAL_PROMPT"] = "0"
    if not config.auth_required:
        yield env
        return
    if not config.token:
        raise GitHubSyncError("PM_GITHUB_TOKEN is required for GitHub HTTPS sync")
    with tempfile.TemporaryDirectory(prefix="pm-git-askpass-") as tmp:
        askpass = Path(tmp) / "askpass.sh"
        askpass.write_text(
            "#!/bin/sh\n"
            "case \"$1\" in\n"
            "  *Username*) printf '%s\\n' 'x-access-token' ;;\n"
            "  *Password*) printf '%s\\n' \"$PM_GITHUB_SYNC_TOKEN\" ;;\n"
            "  *) printf '\\n' ;;\n"
            "esac\n",
            encoding="utf-8",
        )
        askpass.chmod(0o700)
        env["GIT_ASKPASS"] = str(askpass)
        env["PM_GITHUB_SYNC_TOKEN"] = config.token
        yield env


def sanitize_output(text: str, config: GitHubSyncConfig) -> str:
    sanitized = text or ""
    if config.token:
        sanitized = sanitized.replace(config.token, "[redacted]")
    if config.remote_url:
        sanitized = sanitized.replace(config.remote_url, remote_label(config.remote_url))
    return sanitized.strip()


class GitHubSyncService:
    def __init__(self, root: Path, config: GitHubSyncConfig | None = None) -> None:
        self.root = root.resolve()
        self.config = config or GitHubSyncConfig.from_env()

    def status(self) -> dict[str, Any]:
        payload = self.config.public_dict()
        remote_head = ""
        payload.update(
            {
                "git_available": self.git_available(),
                "vault_file_count": len(sync_files(self.root)),
                "remote_head": remote_head,
                "actions": {},
                "errors": [],
            }
        )
        if self.config.enabled and self.config.configured and payload["git_available"]:
            try:
                remote_head = self.remote_head()
                payload["remote_head"] = remote_head
            except GitHubSyncError as exc:
                payload["errors"] = [str(exc)]
        payload["actions"] = self.actions_status(remote_head)
        return payload

    def git_available(self) -> bool:
        try:
            result = subprocess.run(["git", "--version"], text=True, capture_output=True, timeout=10)
        except OSError:
            return False
        return result.returncode == 0

    def remote_head(self) -> str:
        self.require_config()
        with git_auth_env(self.config) as env:
            result = self.run_git(
                ["ls-remote", "--heads", self.config.remote_url, self.config.branch],
                cwd=None,
                env=env,
                timeout=30,
            )
        fields = result.stdout.strip().split()
        return fields[0] if fields else ""

    def actions_status(self, remote_head: str = "") -> dict[str, Any]:
        status: dict[str, Any] = {
            "enabled": self.config.enabled,
            "configured": bool(self.config.enabled and self.config.repo and self.config.token_configured),
            "token_configured": self.config.token_configured,
            "repo": self.config.repo,
            "branch": self.config.branch,
            "latest": None,
            "runs": [],
            "errors": [],
        }
        if not self.config.enabled or not self.config.repo:
            return status
        if not self.config.token_configured:
            status["errors"] = ["PM_GITHUB_TOKEN is required to read GitHub Actions status."]
            return status
        try:
            payload = self.github_api_json(
                f"/repos/{self.config.repo}/actions/runs",
                {"branch": self.config.branch, "per_page": "5"},
            )
        except GitHubSyncError as exc:
            status["errors"] = [str(exc)]
            return status
        runs = [public_actions_run(run, self.config.repo) for run in payload.get("workflow_runs", []) if isinstance(run, dict)]
        if remote_head:
            head_runs = [run for run in runs if run.get("head_sha") == remote_head]
            if head_runs:
                runs = head_runs + [run for run in runs if run.get("head_sha") != remote_head]
        status["runs"] = runs[:5]
        status["latest"] = runs[0] if runs else None
        return status

    def github_api_json(self, path: str, query: dict[str, str]) -> dict[str, Any]:
        if not self.config.token:
            raise GitHubSyncError("PM_GITHUB_TOKEN is required for GitHub API status checks")
        url = f"https://api.github.com{path}?{urllib.parse.urlencode(query)}"
        request = urllib.request.Request(
            url,
            headers={
                "Accept": "application/vnd.github+json",
                "Authorization": f"Bearer {self.config.token}",
                "User-Agent": "task-manager-github-sync",
                "X-GitHub-Api-Version": "2022-11-28",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=12) as response:
                body = response.read().decode("utf-8", errors="replace")
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise GitHubSyncError(sanitize_output(detail or exc.reason or "GitHub API request failed", self.config)) from exc
        except urllib.error.URLError as exc:
            raise GitHubSyncError(sanitize_output(str(exc.reason), self.config)) from exc
        except OSError as exc:
            raise GitHubSyncError(sanitize_output(str(exc), self.config)) from exc
        try:
            data = json.loads(body)
        except json.JSONDecodeError as exc:
            raise GitHubSyncError("GitHub API returned invalid JSON") from exc
        return data if isinstance(data, dict) else {}

    def push(self, commit_message: str, dry_run: bool = False, delete_missing: bool = False) -> dict[str, Any]:
        self.require_config()
        message = commit_message.strip() or f"Sync hosted vault {time.strftime('%Y-%m-%d %H:%M:%S %Z')}"
        with SYNC_LOCK:
            with tempfile.TemporaryDirectory(prefix="pm-github-sync-") as tmp, git_auth_env(self.config) as env:
                clone = Path(tmp) / "repo"
                self.clone_sparse(clone, env)
                vault_files = sync_files(self.root)
                clone_files = sync_files(clone)
                copied = copy_sync_files(self.root, clone, vault_files)
                missing_from_vault = sorted(set(clone_files) - set(vault_files))
                deleted = delete_sync_files(clone, set(missing_from_vault)) if delete_missing else 0
                status = self.git_status(clone)
                changed = parse_git_status(status)
                if dry_run or not changed:
                    return {
                        "ok": True,
                        "dry_run": dry_run,
                        "changed": changed,
                        "copied": copied,
                        "deleted": deleted,
                        "missing_from_vault": missing_from_vault,
                        "committed": False,
                        "pushed": False,
                    }
                self.run_git(["config", "user.name", self.config.author_name], cwd=clone, env=env)
                self.run_git(["config", "user.email", self.config.author_email], cwd=clone, env=env)
                self.run_git(["add", "-A"], cwd=clone, env=env)
                self.run_git(["commit", "-m", message], cwd=clone, env=env)
                self.run_git(["push", "origin", self.config.branch], cwd=clone, env=env, timeout=120)
                head = self.run_git(["rev-parse", "HEAD"], cwd=clone, env=env).stdout.strip()
                return {
                    "ok": True,
                    "dry_run": False,
                    "changed": changed,
                    "copied": copied,
                    "deleted": deleted,
                    "missing_from_vault": missing_from_vault,
                    "committed": True,
                    "pushed": True,
                    "head": head,
                }

    def reset_from_github(self, backup: bool = True, delete_extra: bool = False, dry_run: bool = False) -> dict[str, Any]:
        self.require_config()
        with SYNC_LOCK:
            with tempfile.TemporaryDirectory(prefix="pm-github-reset-") as tmp, git_auth_env(self.config) as env:
                clone = Path(tmp) / "repo"
                self.clone_sparse(clone, env)
                remote_files = sync_files(clone)
                vault_files = sync_files(self.root)
                missing = sorted(set(remote_files) - set(vault_files))

                def _differs(rel: str) -> bool:
                    try:
                        return remote_files[rel].read_bytes() != vault_files[rel].read_bytes()
                    except OSError:
                        # The file vanished or became unreadable between the scan
                        # and this read (e.g. a concurrent vault save/move). Treat
                        # it as changed rather than letting an unhandled OSError
                        # surface as a 500.
                        return True

                changed = sorted(
                    rel for rel in set(remote_files) & set(vault_files)
                    if _differs(rel)
                )
                extra = sorted(set(vault_files) - set(remote_files))
                if dry_run:
                    return {
                        "ok": True,
                        "dry_run": True,
                        "missing": missing,
                        "changed": changed,
                        "extra": extra,
                        "copied": 0,
                        "deleted": 0,
                    }
                backup_path = backup_vault(self.root) if backup else ""
                copied = copy_sync_files(clone, self.root, remote_files)
                deleted = delete_sync_files(self.root, set(extra)) if delete_extra else 0
                return {
                    "ok": True,
                    "dry_run": False,
                    "missing": missing,
                    "changed": changed,
                    "extra": extra,
                    "copied": copied,
                    "deleted": deleted,
                    "backup": backup_path,
                }

    def clone_sparse(self, destination: Path, env: dict[str, str]) -> None:
        destination.mkdir(parents=True, exist_ok=True)
        self.run_git(["init", "-b", self.config.branch], cwd=destination, env=env)
        self.run_git(["remote", "add", "origin", self.config.remote_url], cwd=destination, env=env)
        self.run_git(["sparse-checkout", "init", "--cone"], cwd=destination, env=env)
        self.run_git(["sparse-checkout", "set", *self.config.sparse_dirs], cwd=destination, env=env)
        self.run_git(["fetch", "--depth", "1", "origin", self.config.branch], cwd=destination, env=env, timeout=120)
        self.run_git(["checkout", "-B", self.config.branch, "FETCH_HEAD"], cwd=destination, env=env)

    def git_status(self, cwd: Path) -> str:
        return self.run_git(["status", "--short"], cwd=cwd, env=os.environ.copy()).stdout

    def require_config(self) -> None:
        if not self.config.enabled:
            raise GitHubSyncError("GitHub sync is disabled; set PM_GITHUB_SYNC_ENABLED=true")
        if not self.config.remote_url:
            raise GitHubSyncError("Set PM_GITHUB_REPO or PM_GITHUB_REMOTE_URL before using GitHub sync")
        if self.config.auth_required and not self.config.token:
            raise GitHubSyncError("Set PM_GITHUB_TOKEN before using GitHub sync")

    def run_git(
        self,
        args: list[str],
        *,
        cwd: Path | None,
        env: dict[str, str],
        timeout: int = 60,
    ) -> subprocess.CompletedProcess[str]:
        try:
            result = subprocess.run(
                ["git", *args],
                cwd=str(cwd) if cwd else None,
                env=env,
                text=True,
                capture_output=True,
                timeout=timeout,
            )
        except OSError as exc:
            raise GitHubSyncError("git executable is not available") from exc
        except subprocess.TimeoutExpired as exc:
            raise GitHubSyncError(f"git {' '.join(args[:2])} timed out") from exc
        if result.returncode != 0:
            detail = sanitize_output(result.stderr or result.stdout, self.config)
            raise GitHubSyncError(detail or f"git {' '.join(args[:2])} failed")
        result.stdout = sanitize_output(result.stdout, self.config)
        result.stderr = sanitize_output(result.stderr, self.config)
        return result


def parse_git_status(raw: str) -> list[dict[str, str]]:
    changes: list[dict[str, str]] = []
    for line in raw.splitlines():
        if not line.strip():
            continue
        if len(line) >= 3 and line[2] == " ":
            status = line[:2].strip()
            path = line[3:].strip()
        else:
            fields = line.strip().split(maxsplit=1)
            status = fields[0] if fields else "?"
            path = fields[1] if len(fields) > 1 else ""
        changes.append({"status": status, "path": path})
    return changes


def public_actions_run(run: dict[str, Any], repo: str) -> dict[str, Any]:
    html_url = str(run.get("html_url") or "")
    safe_prefix = f"https://github.com/{repo}/actions/runs/"
    return {
        "id": run.get("id"),
        "name": str(run.get("name") or run.get("display_title") or ""),
        "workflow_name": str(run.get("workflow_name") or ""),
        "status": str(run.get("status") or ""),
        "conclusion": str(run.get("conclusion") or ""),
        "event": str(run.get("event") or ""),
        "head_branch": str(run.get("head_branch") or ""),
        "head_sha": str(run.get("head_sha") or ""),
        "created_at": str(run.get("created_at") or ""),
        "updated_at": str(run.get("updated_at") or ""),
        "html_url": html_url if html_url.startswith(safe_prefix) else "",
    }
