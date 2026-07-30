from __future__ import annotations

import json
from pathlib import Path

from fastapi.testclient import TestClient

from server.app import app, get_service
from server.vault import VaultService


def configure_snapshot(root: Path, relative_path: str = "config/scholar_stats.json") -> Path:
    settings = root / "settings"
    settings.mkdir(parents=True, exist_ok=True)
    (settings / "workbench.yml").write_text(
        f"profile:\n  scholar_statistics_source: {relative_path}\n",
        encoding="utf-8",
    )
    return root / relative_path


def client_for(root: Path, monkeypatch) -> TestClient:
    app.dependency_overrides[get_service] = lambda: VaultService(root)
    monkeypatch.setenv("PM_APP_TOKEN", "test-token")
    monkeypatch.setenv("PM_REQUIRE_LOCAL_AUTH", "true")
    return TestClient(app)


def teardown_client() -> None:
    app.dependency_overrides.clear()


def test_scholar_endpoint_requires_auth(tmp_path: Path, monkeypatch) -> None:
    client = client_for(tmp_path, monkeypatch)
    try:
        unauthorized = client.get("/api/scholar")
    finally:
        teardown_client()
    assert unauthorized.status_code == 401


def test_scholar_endpoint_returns_unavailable_when_snapshot_missing(tmp_path: Path, monkeypatch) -> None:
    client = client_for(tmp_path, monkeypatch)
    try:
        response = client.get("/api/scholar", headers={"Authorization": "Bearer test-token"})
    finally:
        teardown_client()
    assert response.status_code == 200
    assert response.json() == {"available": False}


def test_scholar_endpoint_serves_stored_snapshot(tmp_path: Path, monkeypatch) -> None:
    snapshot = {
        "name": "Example Researcher",
        "metrics": {"citations": {"all": 124, "recent": 120}, "h_index": {"all": 4, "recent": 4}},
        "top_publications": [{"title": "Urban welfare: Tourism in Harbor City", "year": 2021, "citations": 61}],
    }
    snapshot_path = configure_snapshot(tmp_path)
    snapshot_path.parent.mkdir(parents=True, exist_ok=True)
    snapshot_path.write_text(json.dumps(snapshot), encoding="utf-8")

    client = client_for(tmp_path, monkeypatch)
    try:
        response = client.get("/api/scholar", headers={"Authorization": "Bearer test-token"})
    finally:
        teardown_client()

    assert response.status_code == 200
    body = response.json()
    assert body["available"] is True
    assert body["metrics"]["citations"]["all"] == 124
    assert body["top_publications"][0]["citations"] == 61


def test_scholar_endpoint_handles_corrupt_snapshot(tmp_path: Path, monkeypatch) -> None:
    snapshot_path = configure_snapshot(tmp_path)
    snapshot_path.parent.mkdir(parents=True, exist_ok=True)
    snapshot_path.write_text("{not valid json", encoding="utf-8")

    client = client_for(tmp_path, monkeypatch)
    try:
        response = client.get("/api/scholar", headers={"Authorization": "Bearer test-token"})
    finally:
        teardown_client()

    assert response.status_code == 200
    assert response.json() == {"available": False}


def test_scholar_endpoint_rejects_source_outside_vault(tmp_path: Path, monkeypatch) -> None:
    configure_snapshot(tmp_path, "../outside.json")
    (tmp_path.parent / "outside.json").write_text("{}", encoding="utf-8")

    client = client_for(tmp_path, monkeypatch)
    try:
        response = client.get("/api/scholar", headers={"Authorization": "Bearer test-token"})
    finally:
        teardown_client()

    assert response.status_code == 200
    assert response.json() == {"available": False}
