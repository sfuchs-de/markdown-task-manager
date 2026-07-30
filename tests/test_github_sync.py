from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from server.app import app, get_service
from server.github_sync import GitHubSyncConfig, GitHubSyncService, sync_files
from server.vault import VaultService


def write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def git_available() -> bool:
    return shutil.which("git") is not None


def git(*args: str, cwd: Path) -> str:
    result = subprocess.run(["git", *args], cwd=cwd, text=True, capture_output=True)
    assert result.returncode == 0, result.stderr
    return result.stdout.strip()


def init_remote_with_main(tmp_path: Path) -> Path:
    remote = tmp_path / "remote.git"
    seed = tmp_path / "seed"
    remote.mkdir()
    seed.mkdir()
    git("init", "--bare", cwd=remote)
    git("init", "-b", "main", cwd=seed)
    git("config", "user.name", "Test User", cwd=seed)
    git("config", "user.email", "test@example.com", cwd=seed)
    write(seed / "tasks/active/base.md", "# Base\n")
    write(seed / "projects/alpha/README.md", "# Alpha\n")
    git("add", "-A", cwd=seed)
    git("commit", "-m", "Seed", cwd=seed)
    git("remote", "add", "origin", str(remote), cwd=seed)
    git("push", "origin", "main", cwd=seed)
    return remote


@pytest.mark.skipif(not git_available(), reason="git executable is required")
def test_github_sync_push_uses_temp_clone_and_excludes_private(tmp_path: Path) -> None:
    remote = init_remote_with_main(tmp_path)
    vault = tmp_path / "vault"
    write(vault / "tasks/active/base.md", "# Base edited on hosted vault\n")
    write(vault / "tasks/active/new.md", "# New hosted task\n")
    write(vault / "projects/alpha/README.md", "# Alpha\n")
    write(vault / "private/secret.md", "# Do not sync\n")

    config = GitHubSyncConfig(
        enabled=True,
        repo="",
        branch="main",
        token="",
        author_name="Research Workbench Automation",
        author_email="render@example.invalid",
        remote_url_override=str(remote),
        sparse_dirs=("projects", "tasks"),
    )
    result = GitHubSyncService(vault, config).push("Sync hosted vault")

    assert result["ok"] is True
    assert result["pushed"] is True
    paths = {item["path"] for item in result["changed"]}
    assert "tasks/active/base.md" in paths
    assert "tasks/active/new.md" in paths

    check = tmp_path / "check"
    git("clone", "-b", "main", str(remote), str(check), cwd=tmp_path)
    assert (check / "tasks/active/base.md").read_text(encoding="utf-8") == "# Base edited on hosted vault\n"
    assert (check / "tasks/active/new.md").exists()
    assert not (check / "private/secret.md").exists()


def _reset_config(remote: Path) -> GitHubSyncConfig:
    return GitHubSyncConfig(
        enabled=True,
        repo="",
        branch="main",
        token="",
        author_name="Research Workbench Automation",
        author_email="render@example.invalid",
        remote_url_override=str(remote),
        sparse_dirs=("projects", "tasks"),
    )


@pytest.mark.skipif(not git_available(), reason="git executable is required")
def test_reset_from_github_dry_run_reports_diff_without_writing(tmp_path: Path) -> None:
    remote = init_remote_with_main(tmp_path)  # remote has tasks/active/base.md, projects/alpha/README.md
    vault = tmp_path / "vault"
    write(vault / "tasks/active/base.md", "# Locally edited\n")  # differs from remote
    write(vault / "tasks/active/extra.md", "# Vault only\n")     # not on remote

    result = GitHubSyncService(vault, _reset_config(remote)).reset_from_github(dry_run=True)

    assert result["dry_run"] is True
    assert "tasks/active/base.md" in result["changed"]
    assert "tasks/active/extra.md" in result["extra"]
    assert "projects/alpha/README.md" in result["missing"]
    assert result["copied"] == 0 and result["deleted"] == 0
    # Nothing on disk was touched.
    assert (vault / "tasks/active/base.md").read_text(encoding="utf-8") == "# Locally edited\n"
    assert (vault / "tasks/active/extra.md").exists()
    assert not (vault / ".backups").exists()


@pytest.mark.skipif(not git_available(), reason="git executable is required")
def test_reset_from_github_overwrites_with_backup_and_never_touches_private(tmp_path: Path) -> None:
    remote = init_remote_with_main(tmp_path)
    vault = tmp_path / "vault"
    write(vault / "tasks/active/base.md", "# Locally edited\n")
    write(vault / "tasks/active/extra.md", "# Vault only\n")
    write(vault / "private/secret.md", "# Never sync or delete\n")

    result = GitHubSyncService(vault, _reset_config(remote)).reset_from_github(
        backup=True, delete_extra=True, dry_run=False
    )

    assert result["dry_run"] is False
    # Remote content overwrote the local edit.
    assert (vault / "tasks/active/base.md").read_text(encoding="utf-8") == "# Base\n"
    # Vault-only file removed because delete_extra=True.
    assert not (vault / "tasks/active/extra.md").exists()
    # private/ is excluded from sync_files AND backup_vault: it must survive untouched.
    assert (vault / "private/secret.md").read_text(encoding="utf-8") == "# Never sync or delete\n"
    # A backup snapshot was taken and captured the pre-reset content.
    backup_dir = vault / result["backup"]
    assert backup_dir.is_dir()
    assert (backup_dir / "tasks/active/base.md").read_text(encoding="utf-8") == "# Locally edited\n"
    assert not (backup_dir / "private").exists()  # backup also skips private/


def test_sync_files_excludes_private_and_large_local_paths(tmp_path: Path) -> None:
    write(tmp_path / "tasks/active/a.md", "# A\n")
    write(tmp_path / "dashboard/index.html", "<h1>Dashboard</h1>\n")
    write(tmp_path / "config/render_vault_force_sync.json", "{}\n")
    write(tmp_path / "private/secret.md", "# Secret\n")
    write(tmp_path / "projects/alpha/private/receipt.md", "# Receipt\n")
    write(tmp_path / "local_data/raw.md", "# Raw\n")

    files = sync_files(tmp_path)

    assert "tasks/active/a.md" in files
    assert "config/render_vault_force_sync.json" not in files
    assert "dashboard/index.html" not in files
    assert "private/secret.md" not in files
    assert "projects/alpha/private/receipt.md" not in files
    assert "local_data/raw.md" not in files


@pytest.mark.skipif(not git_available(), reason="git executable is required")
def test_github_sync_status_includes_sanitized_actions(tmp_path: Path, monkeypatch) -> None:
    remote = init_remote_with_main(tmp_path)
    vault = tmp_path / "vault"
    write(vault / "tasks/active/base.md", "# Base\n")

    def fake_github_api(self: GitHubSyncService, path: str, query: dict[str, str]) -> dict:
        assert path == "/repos/example-org/private-vault/actions/runs"
        assert query["branch"] == "main"
        return {
            "workflow_runs": [
                {
                    "id": 42,
                    "name": "Vault QA",
                    "workflow_name": "Vault QA",
                    "status": "completed",
                    "conclusion": "success",
                    "event": "push",
                    "head_branch": "main",
                    "head_sha": "abcdef1234567890",
                    "created_at": "2026-06-06T12:00:00Z",
                    "updated_at": "2026-06-06T12:04:00Z",
                    "html_url": "https://github.com/example-org/private-vault/actions/runs/42",
                },
                {
                    "id": 43,
                    "name": "Unsafe link",
                    "html_url": "https://example.com/leak",
                },
            ]
        }

    monkeypatch.setattr(GitHubSyncService, "github_api_json", fake_github_api)
    config = GitHubSyncConfig(
        enabled=True,
        repo="example-org/private-vault",
        branch="main",
        token="super-secret-token",
        author_name="Research Workbench Automation",
        author_email="render@example.invalid",
        remote_url_override=str(remote),
        sparse_dirs=("projects", "tasks"),
    )

    status = GitHubSyncService(vault, config).status()

    assert status["actions"]["configured"] is True
    assert status["actions"]["latest"]["workflow_name"] == "Vault QA"
    assert status["actions"]["latest"]["conclusion"] == "success"
    assert status["actions"]["latest"]["html_url"].endswith("/actions/runs/42")
    assert status["actions"]["runs"][1]["html_url"] == ""
    assert "super-secret-token" not in str(status)


def client_for(root: Path, monkeypatch) -> TestClient:
    app.dependency_overrides[get_service] = lambda: VaultService(root)
    monkeypatch.setenv("PM_APP_TOKEN", "test-token")
    monkeypatch.setenv("PM_REQUIRE_LOCAL_AUTH", "true")
    return TestClient(app)


def teardown_client() -> None:
    app.dependency_overrides.clear()


def test_github_sync_status_is_authenticated_and_redacted(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("PM_GITHUB_SYNC_ENABLED", "true")
    monkeypatch.setenv("PM_GITHUB_REPO", "example-org/private-vault")
    monkeypatch.delenv("PM_GITHUB_TOKEN", raising=False)
    client = client_for(tmp_path, monkeypatch)
    try:
        unauthorized = client.get("/api/github-sync/status")
        response = client.get("/api/github-sync/status", headers={"Authorization": "Bearer test-token"})
    finally:
        teardown_client()

    assert unauthorized.status_code == 401
    assert response.status_code == 200
    body = response.json()
    assert body["enabled"] is True
    assert body["repo"] == "example-org/private-vault"
    assert body["token_configured"] is False
    assert "super-secret" not in str(body)


def test_github_sync_mutating_endpoints_require_auth(tmp_path: Path, monkeypatch) -> None:
    # push and reset-from-github can overwrite/delete the vault, so the auth gate
    # must fire before the handler ever runs.
    monkeypatch.setenv("PM_GITHUB_SYNC_ENABLED", "true")
    monkeypatch.setenv("PM_GITHUB_REPO", "example-org/private-vault")
    client = client_for(tmp_path, monkeypatch)
    try:
        push = client.post("/api/github-sync/push", json={})
        reset = client.post("/api/github-sync/reset-from-github", json={})
        ok = client.post(
            "/api/github-sync/reset-from-github",
            json={"dry_run": True},
            headers={"Authorization": "Bearer wrong-token"},
        )
    finally:
        teardown_client()

    assert push.status_code == 401
    assert reset.status_code == 401
    assert ok.status_code == 401  # a wrong token is rejected too
