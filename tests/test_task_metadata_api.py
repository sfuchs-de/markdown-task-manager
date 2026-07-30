from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

import server.app as server_app
from server.app import app, get_service
from server.vault import VaultService


def write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def client_for(root: Path, monkeypatch) -> TestClient:
    app.dependency_overrides[get_service] = lambda: VaultService(root)
    monkeypatch.setenv("PM_APP_TOKEN", "test-token")
    return TestClient(app)


def teardown_client() -> None:
    app.dependency_overrides.clear()


def test_health_endpoint_does_not_scan_vault(monkeypatch) -> None:
    def fail_scan(*_args, **_kwargs) -> list[dict]:
        raise AssertionError("health should not scan the vault")

    monkeypatch.setattr(VaultService, "scan_entries", fail_scan)
    client = TestClient(app)

    response = client.get("/api/health")

    assert response.status_code == 200
    body = response.json()
    assert "vault_root_exists" in body
    assert "entry_count" not in body
    assert "task_count" not in body


def test_diagnostics_endpoint_reports_vault_hash_and_cache(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(server_app, "LAST_MARKDOWN_SAVE_AT", None)
    write(tmp_path / "tasks/active/t-api.md", "---\nkind: task\nstatus: open\n---\n# API Task\n")
    write(tmp_path / "projects/demo/README.md", "---\nkind: project\nid: demo\ntitle: Demo\n---\n# Demo\n")
    write(
        tmp_path / ".vault_seed_manifest.json",
        '{"generated_at":"2026-06-16T12:00:00+00:00","mode":"copy-missing","seed_source":"/app","vault_root":"/app/vault","app_commit":"feedface","counts":{"copied":1}}\n',
    )
    monkeypatch.setenv("PM_GITHUB_SYNC_ENABLED", "false")
    client = client_for(tmp_path, monkeypatch)
    try:
        response = client.get("/api/diagnostics", headers={"Authorization": "Bearer test-token"})
    finally:
        teardown_client()

    assert response.status_code == 200
    body = response.json()
    assert body["vault_hash"]["algorithm"] == "sha256"
    assert body["vault_hash"]["file_count"] >= 1
    assert len(body["vault_hash"]["value"]) == 64
    assert body["entry_counts"]["entries"] >= 2
    assert body["entry_counts"]["tasks"] == 1
    assert body["entry_counts"]["projects"] == 1
    assert body["last_vault_scan_at"]
    assert body["last_markdown_save_at"] is None
    assert body["seed"]["exists"] is True
    assert body["seed"]["mode"] == "copy-missing"
    assert body["seed"]["app_commit"] == "feedface"
    assert "generated_cache" in body
    cache_files = {item["path"] for item in body["generated_cache"]["files"]}
    assert {"data/tasks.json", "data/projects.json", "dashboard/index.html", "dashboard/status.html"} <= cache_files
    assert body["hosted_service"]["configured"] is False
    assert "github_sync" in body


def test_diagnostics_endpoint_reports_hosted_service_check(tmp_path: Path, monkeypatch) -> None:
    write(tmp_path / "tasks/active/t-api.md", "---\nkind: task\nstatus: open\n---\n# API Task\n")
    monkeypatch.setenv("PM_GITHUB_SYNC_ENABLED", "false")
    monkeypatch.setenv("PM_PUBLIC_DASHBOARD_URL", "https://example.test/dashboard/index.html")
    monkeypatch.setattr(server_app, "LAST_HOSTED_SERVICE_SUCCESS_AT", None)

    class FakeResponse:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def getcode(self) -> int:
            return 200

    def fake_urlopen(request, timeout):
        assert request.full_url == "https://example.test/dashboard/index.html"
        assert timeout == 2
        return FakeResponse()

    monkeypatch.setattr(server_app.urllib.request, "urlopen", fake_urlopen)
    client = client_for(tmp_path, monkeypatch)
    try:
        response = client.get("/api/diagnostics", headers={"Authorization": "Bearer test-token"})
    finally:
        teardown_client()

    assert response.status_code == 200
    hosted = response.json()["hosted_service"]
    assert hosted["configured"] is True
    assert hosted["url"] == "https://example.test/dashboard/index.html"
    assert hosted["status_code"] == 200
    assert hosted["ok"] is True
    assert hosted["last_success_at"]


def test_save_file_endpoint_can_move_task_lifecycle_path(tmp_path: Path, monkeypatch) -> None:
    write(tmp_path / "tasks/active/t-api-move.md", "---\nkind: task\nstatus: open\n---\n# Move Me\n")
    client = client_for(tmp_path, monkeypatch)
    try:
        response = client.put(
            "/api/vault/file",
            headers={"Authorization": "Bearer test-token"},
            json={
                "path": "tasks/active/t-api-move.md",
                "content": "---\nkind: task\nstatus: done\ncompleted: 2026-05-08\n---\n# Move Me\n",
                "move_to": "tasks/done/t-api-move.md",
            },
        )
    finally:
        teardown_client()

    assert response.status_code == 200
    assert response.json()["path"] == "tasks/done/t-api-move.md"
    assert not (tmp_path / "tasks/active/t-api-move.md").exists()
    assert "completed: 2026-05-08" in (tmp_path / "tasks/done/t-api-move.md").read_text(encoding="utf-8")


def test_patch_task_metadata_endpoint_uses_auth_and_atomic_save(tmp_path: Path, monkeypatch) -> None:
    write(
        tmp_path / "tasks/active/t-api.md",
        """---
kind: task
status: open
priority: 1
---
# API Task
""",
    )
    client = client_for(tmp_path, monkeypatch)
    try:
        response = client.patch(
            "/api/vault/task-metadata",
            headers={"Authorization": "Bearer test-token"},
            json={
                "path": "tasks/active/t-api.md",
                "updates": {"status": "done", "priority": "", "deadline_type": "hard", "assignee": "Nikhil"},
            },
        )
    finally:
        teardown_client()

    assert response.status_code == 200
    body = response.json()
    assert body["path"] == "tasks/done/t-api.md"
    assert body["frontmatter"]["status"] == "done"
    assert body["frontmatter"]["deadline_type"] == "hard"
    assert body["frontmatter"]["assignee"] == "Nikhil"
    assert body["frontmatter"]["completed"]
    assert "priority" not in body["frontmatter"]
    assert not (tmp_path / "tasks/active/t-api.md").exists()
    assert "status: done" in (tmp_path / "tasks/done/t-api.md").read_text(encoding="utf-8")


def test_patch_task_metadata_endpoint_rejects_non_task(tmp_path: Path, monkeypatch) -> None:
    write(tmp_path / "notes/plain.md", "# Plain Note\n")
    client = client_for(tmp_path, monkeypatch)
    try:
        response = client.patch(
            "/api/vault/task-metadata",
            headers={"Authorization": "Bearer test-token"},
            json={"path": "notes/plain.md", "updates": {"status": "done"}},
        )
    finally:
        teardown_client()

    assert response.status_code == 400
    assert "Only task" in response.json()["detail"]


def test_patch_metadata_endpoint_allows_task_cockpit_fields(tmp_path: Path, monkeypatch) -> None:
    write(
        tmp_path / "tasks/active/t-cockpit.md",
        """---
kind: task
status: open
---
# Cockpit Task
""",
    )
    client = client_for(tmp_path, monkeypatch)
    try:
        response = client.patch(
            "/api/vault/metadata",
            headers={"Authorization": "Bearer test-token"},
            json={
                "path": "tasks/active/t-cockpit.md",
                "updates": {
                    "next": "Do the next concrete action",
                    "block_day": "2026-05-08",
                    "block_week": "2026-05",
                    "estimate_minutes": "45",
                    "deadline_type": "soft",
                    "assignee": "Avery",
                    "related_to": "[[Project X]]",
                },
            },
        )
    finally:
        teardown_client()

    assert response.status_code == 200
    body = response.json()["frontmatter"]
    assert body["next"] == "Do the next concrete action"
    assert body["block_day"] == "2026-05-08"
    assert body["block_week"] == "2026-05-"
    assert body["estimate_minutes"] == 45
    assert body["deadline_type"] == "soft"
    assert body["assignee"] == "Avery"
    assert body["related_to"] == "[[Project X]]"


def test_patch_metadata_endpoint_allows_project_cockpit_fields(tmp_path: Path, monkeypatch) -> None:
    write(
        tmp_path / "projects/sample/README.md",
        """---
kind: project
title: Sample
status: active
---
# Sample
""",
    )
    client = client_for(tmp_path, monkeypatch)
    try:
        response = client.patch(
            "/api/vault/metadata",
            headers={"Authorization": "Bearer test-token"},
            json={
                "path": "projects/sample/README.md",
                "updates": {
                    "deadline": "2026-06-03",
                    "deadline_type": "hard",
                    "next_action": "Review table",
                    "dashboard": "true",
                },
            },
        )
    finally:
        teardown_client()

    assert response.status_code == 200
    body = response.json()["frontmatter"]
    assert body["deadline"] == "2026-06-03"
    assert body["deadline_type"] == "hard"
    assert body["next_action"] == "Review table"
    assert body["dashboard"] is True


def test_patch_metadata_endpoint_rejects_wrong_kind_field(tmp_path: Path, monkeypatch) -> None:
    write(tmp_path / "notes/plain.md", "---\nkind: note\n---\n# Plain Note\n")
    client = client_for(tmp_path, monkeypatch)
    try:
        response = client.patch(
            "/api/vault/metadata",
            headers={"Authorization": "Bearer test-token"},
            json={"path": "notes/plain.md", "updates": {"deadline": "2026-06-03"}},
        )
    finally:
        teardown_client()

    assert response.status_code == 400
    assert "field is not editable" in response.json()["detail"]


def test_reload_endpoint_forces_vault_cache_refresh(tmp_path: Path, monkeypatch) -> None:
    write(tmp_path / "notes/a.md", "# A\n")
    original_parse = VaultService.parse_file
    parsed: list[str] = []

    def counting_parse(self: VaultService, path: Path) -> dict:
        parsed.append(self.relpath(path))
        return original_parse(self, path)

    monkeypatch.setattr(VaultService, "parse_file", counting_parse)
    client = client_for(tmp_path, monkeypatch)
    try:
        first = client.get("/api/vault/entries", headers={"Authorization": "Bearer test-token"})
        parsed.clear()
        second = client.get("/api/vault/entries", headers={"Authorization": "Bearer test-token"})
        assert second.status_code == 200
        assert parsed == []
        reload_response = client.post("/api/vault/reload", headers={"Authorization": "Bearer test-token"})
    finally:
        teardown_client()

    assert first.status_code == 200
    assert reload_response.status_code == 200
    assert parsed == ["notes/a.md"]
