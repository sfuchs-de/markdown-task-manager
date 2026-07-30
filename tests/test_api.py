from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from server.app import app, get_service
from server.vault import VaultService


@pytest.fixture()
def vault(tmp_path: Path) -> Path:
    project = tmp_path / "projects" / "example"
    project.mkdir(parents=True)
    (project / "README.md").write_text(
        "---\n"
        "kind: project\n"
        "id: example\n"
        "title: Example project\n"
        "status: active\n"
        "---\n"
        "# Example project\n",
        encoding="utf-8",
    )
    task = tmp_path / "tasks" / "active"
    task.mkdir(parents=True)
    (task / "t-one.md").write_text(
        "---\n"
        "kind: task\n"
        "id: t-one\n"
        "title: First task\n"
        "status: open\n"
        "project: example\n"
        "---\n"
        "# First task\n",
        encoding="utf-8",
    )
    return tmp_path


@pytest.fixture()
def client(vault: Path):
    service = VaultService(vault)
    app.dependency_overrides[get_service] = lambda: service
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


def test_lists_and_reads_markdown(client: TestClient) -> None:
    response = client.get("/api/vault/entries")
    assert response.status_code == 200
    assert {entry["id"] for entry in response.json()["entries"]} == {"example", "t-one"}

    file_response = client.get("/api/vault/file", params={"path": "tasks/active/t-one.md"})
    assert file_response.status_code == 200
    assert "# First task" in file_response.json()["content"]


def test_save_is_conflict_aware_and_atomic(client: TestClient) -> None:
    current = client.get("/api/vault/file", params={"path": "tasks/active/t-one.md"}).json()
    saved = client.put(
        "/api/vault/file",
        json={
            "path": current["path"],
            "content": current["content"] + "\nNew detail.\n",
            "current_modified_at": current["modified_at"],
        },
    )
    assert saved.status_code == 200
    assert "New detail." in saved.json()["content"]

    stale = client.put(
        "/api/vault/file",
        json={
            "path": current["path"],
            "content": "stale",
            "current_modified_at": current["modified_at"],
        },
    )
    assert stale.status_code == 409


def test_path_traversal_and_non_markdown_are_rejected(client: TestClient) -> None:
    traversal = client.get("/api/vault/file", params={"path": "../outside.md"})
    assert traversal.status_code == 400
    assert "inside the vault" in traversal.json()["detail"]

    other = client.get("/api/vault/file", params={"path": "secret.env"})
    assert other.status_code == 400
    assert "Only Markdown" in other.json()["detail"]


def test_create_and_patch_task(client: TestClient) -> None:
    created = client.post("/api/vault/create", json={"kind": "task", "title": "Synthetic task"})
    assert created.status_code == 200
    payload = created.json()
    assert payload["path"].startswith("tasks/active/")

    patched = client.patch(
        "/api/vault/task-metadata",
        json={
            "path": payload["path"],
            "updates": {"status": "waiting", "priority": 1},
            "current_modified_at": payload["modified_at"],
        },
    )
    assert patched.status_code == 200
    assert patched.json()["path"].startswith("tasks/waiting/")
    assert "status: waiting" in patched.json()["content"]


def test_local_auth_can_be_required(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("PM_REQUIRE_LOCAL_AUTH", "true")
    monkeypatch.setenv("PM_APP_TOKEN", "fictional-test-token")

    denied = client.get("/api/vault/entries")
    assert denied.status_code == 401

    allowed = client.get(
        "/api/vault/entries",
        headers={"Authorization": "Bearer fictional-test-token"},
    )
    assert allowed.status_code == 200
