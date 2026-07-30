from __future__ import annotations

import hmac
import os
import time
from pathlib import Path
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .github_sync import GitHubSyncError, GitHubSyncService
from .vault import ROOT as VAULT_ROOT
from .vault import SaveConflictError, VaultError, VaultService


APP_ROOT = Path(__file__).resolve().parents[1]
DIST = APP_ROOT / "web" / "dist"
STARTED_AT = time.time()


class SaveFileRequest(BaseModel):
    path: str
    content: str
    current_modified_at: float | None = None
    move_to: str | None = None


class MetadataPatchRequest(BaseModel):
    path: str
    updates: dict[str, Any]
    current_modified_at: float | None = None


class CreateFileRequest(BaseModel):
    kind: str = "note"
    title: str = Field(min_length=1, max_length=200)
    directory: str | None = None


class GitHubSyncPushRequest(BaseModel):
    commit_message: str = ""
    dry_run: bool = True
    delete_missing: bool = False


class GitHubSyncResetRequest(BaseModel):
    backup: bool = True
    delete_extra: bool = False
    dry_run: bool = True


def configured_origins() -> list[str]:
    defaults = {
        "http://127.0.0.1:5173",
        "http://localhost:5173",
        "http://127.0.0.1:8765",
        "http://localhost:8765",
    }
    extra = {
        value.strip()
        for value in os.environ.get("PM_CORS_ORIGINS", "").split(",")
        if value.strip()
    }
    return sorted(defaults | extra)


def is_local_request(request: Request) -> bool:
    client_host = request.client.host if request.client else ""
    request_host = (request.url.hostname or "").lower()
    local_hosts = {"127.0.0.1", "::1", "localhost", "testclient", "testserver"}
    return client_host in local_hosts and request_host in local_hosts


async def require_auth(
    request: Request,
    authorization: str | None = Header(default=None),
    x_pm_app_token: str | None = Header(default=None),
) -> None:
    if is_local_request(request) and os.environ.get("PM_REQUIRE_LOCAL_AUTH", "").lower() not in {"1", "true", "yes"}:
        return
    expected = os.environ.get("PM_APP_TOKEN", "")
    if not expected:
        raise HTTPException(status_code=503, detail="PM_APP_TOKEN is required for non-local requests")
    supplied = x_pm_app_token
    if authorization and authorization.lower().startswith("bearer "):
        supplied = authorization.split(" ", 1)[1].strip()
    if not supplied or not hmac.compare_digest(supplied, expected):
        raise HTTPException(status_code=401, detail="Invalid or missing app token")


def get_service() -> VaultService:
    return VaultService(VAULT_ROOT)


def get_sync_service(service: VaultService = Depends(get_service)) -> GitHubSyncService:
    return GitHubSyncService(service.root)


app = FastAPI(
    title="Markdown Task Manager",
    version="1.0.0",
    description="A private-by-default Markdown project and task workbench.",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=configured_origins(),
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "PATCH"],
    allow_headers=["Authorization", "Content-Type", "X-PM-App-Token"],
)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data:; font-src 'self'; connect-src 'self'"
    )
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
    return response


@app.get("/api/health")
async def health() -> dict[str, Any]:
    exists = VAULT_ROOT.exists() and VAULT_ROOT.is_dir()
    return {
        "ok": exists,
        "vault_available": exists,
        "auth_configured": bool(os.environ.get("PM_APP_TOKEN")),
        "github_sync_enabled": os.environ.get("PM_GITHUB_SYNC_ENABLED", "").lower() in {"1", "true", "yes"},
        "uptime_seconds": max(0, int(time.time() - STARTED_AT)),
        "version": app.version,
    }


@app.get("/api/vault/entries", dependencies=[Depends(require_auth)])
async def entries(service: VaultService = Depends(get_service)) -> dict[str, Any]:
    return {"entries": service.scan_entries()}


@app.get("/api/vault/file", dependencies=[Depends(require_auth)])
async def file(
    path: str = Query(..., min_length=1),
    service: VaultService = Depends(get_service),
) -> dict[str, Any]:
    try:
        return service.get_file(path)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="File not found") from exc
    except VaultError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.put("/api/vault/file", dependencies=[Depends(require_auth)])
async def save_file(
    payload: SaveFileRequest,
    service: VaultService = Depends(get_service),
) -> dict[str, Any]:
    try:
        return service.save_file(payload.path, payload.content, payload.current_modified_at, payload.move_to)
    except SaveConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except VaultError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.patch("/api/vault/task-metadata", dependencies=[Depends(require_auth)])
async def patch_task_metadata(
    payload: MetadataPatchRequest,
    service: VaultService = Depends(get_service),
) -> dict[str, Any]:
    try:
        return service.patch_task_metadata(payload.path, payload.updates, payload.current_modified_at)
    except SaveConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except VaultError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.patch("/api/vault/metadata", dependencies=[Depends(require_auth)])
async def patch_metadata(
    payload: MetadataPatchRequest,
    service: VaultService = Depends(get_service),
) -> dict[str, Any]:
    try:
        return service.patch_metadata(payload.path, payload.updates, payload.current_modified_at)
    except SaveConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except VaultError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/vault/create", dependencies=[Depends(require_auth)])
async def create_file(
    payload: CreateFileRequest,
    service: VaultService = Depends(get_service),
) -> dict[str, Any]:
    try:
        return service.create_file(payload.kind, payload.title, payload.directory)
    except VaultError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/vault/reload", dependencies=[Depends(require_auth)])
async def reload_vault(service: VaultService = Depends(get_service)) -> dict[str, Any]:
    service.invalidate_scan_cache()
    return {"entries": service.scan_entries(force=True)}


@app.get("/api/git/status", dependencies=[Depends(require_auth)])
async def git_status(service: VaultService = Depends(get_service)) -> dict[str, Any]:
    return service.git_status()


@app.get("/api/github-sync/status", dependencies=[Depends(require_auth)])
async def github_sync_status(sync: GitHubSyncService = Depends(get_sync_service)) -> dict[str, Any]:
    return sync.status()


@app.post("/api/github-sync/push", dependencies=[Depends(require_auth)])
async def github_sync_push(
    payload: GitHubSyncPushRequest,
    sync: GitHubSyncService = Depends(get_sync_service),
) -> dict[str, Any]:
    try:
        return sync.push(
            payload.commit_message,
            dry_run=payload.dry_run,
            delete_missing=payload.delete_missing,
        )
    except GitHubSyncError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/github-sync/reset-from-github", dependencies=[Depends(require_auth)])
async def github_sync_reset(
    payload: GitHubSyncResetRequest,
    service: VaultService = Depends(get_service),
    sync: GitHubSyncService = Depends(get_sync_service),
) -> dict[str, Any]:
    try:
        result = sync.reset_from_github(
            backup=payload.backup,
            delete_extra=payload.delete_extra,
            dry_run=payload.dry_run,
        )
        if not payload.dry_run:
            service.invalidate_scan_cache()
        return result
    except GitHubSyncError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


if DIST.exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def serve_app(full_path: str):
        if full_path == "api" or full_path.startswith("api/"):
            return JSONResponse({"detail": "Not found"}, status_code=404)
        requested = (DIST / full_path).resolve()
        try:
            requested.relative_to(DIST.resolve())
        except ValueError:
            requested = DIST / "index.html"
        if requested.is_file():
            return FileResponse(requested)
        return FileResponse(DIST / "index.html")
