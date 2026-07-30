#!/usr/bin/env python3
"""Smoke-test the container's auth, writable vault, and restart behavior."""
from __future__ import annotations

import argparse
import json
import subprocess
import time
import urllib.error
import urllib.request
import uuid
from dataclasses import dataclass


TOKEN = "synthetic-smoke-token"
TASK_PATH = "tasks/active/t-draft-method-note.md"


@dataclass(frozen=True)
class Response:
    status: int
    body: str


def docker(*args: str, capture: bool = False) -> str:
    result = subprocess.run(
        ["docker", *args],
        check=True,
        text=True,
        capture_output=capture,
    )
    return result.stdout.strip() if capture else ""


def request(url: str, path: str, *, token: str = "", method: str = "GET", payload: dict | None = None) -> Response:
    headers = {"Accept": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    data = None
    if payload is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(f"{url}{path}", data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=3) as response:
            return Response(response.status, response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        return Response(exc.code, exc.read().decode("utf-8"))


def wait_for_health(url: str) -> None:
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        try:
            if request(url, "/api/health").status == 200:
                return
        except (OSError, urllib.error.URLError):
            pass
        time.sleep(0.25)
    raise RuntimeError("container did not become healthy within 30 seconds")


def start_container(image: str, name: str, volume: str) -> str:
    docker(
        "run",
        "--detach",
        "--name",
        name,
        "--read-only",
        "--tmpfs",
        "/tmp",
        "--security-opt",
        "no-new-privileges:true",
        "--publish",
        "127.0.0.1::8765",
        "--env",
        f"PM_APP_TOKEN={TOKEN}",
        "--env",
        "PM_REQUIRE_LOCAL_AUTH=true",
        "--env",
        "PM_GITHUB_SYNC_ENABLED=false",
        "--volume",
        f"{volume}:/vault",
        image,
    )
    mapping = docker("port", name, "8765/tcp", capture=True)
    host, port = mapping.rsplit(":", 1)
    if host != "127.0.0.1":
        raise AssertionError(f"container published on unexpected host {host!r}")
    return f"http://127.0.0.1:{port}"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image", default="research-workbench:test")
    args = parser.parse_args()
    suffix = uuid.uuid4().hex[:10]
    volume = f"research-workbench-smoke-{suffix}"
    first = f"research-workbench-smoke-a-{suffix}"
    second = f"research-workbench-smoke-b-{suffix}"
    active: set[str] = set()
    try:
        image_user = docker("image", "inspect", args.image, "--format", "{{.Config.User}}", capture=True)
        if image_user not in {"app", "10001", "10001:10001"}:
            raise AssertionError(f"runtime image must declare a non-root user, found {image_user!r}")

        docker("volume", "create", volume)
        docker(
            "run",
            "--rm",
            "--user",
            "0",
            "--volume",
            f"{volume}:/vault",
            args.image,
            "sh",
            "-c",
            "cp -R /app/example-vault/. /vault/ && chown -R 10001:10001 /vault",
        )

        url = start_container(args.image, first, volume)
        active.add(first)
        wait_for_health(url)
        if request(url, "/api/vault/entries").status != 401:
            raise AssertionError("protected API accepted an unauthenticated request")
        entries = request(url, "/api/vault/entries", token=TOKEN)
        if entries.status != 200 or "Harbor Flows" not in entries.body:
            raise AssertionError("authenticated synthetic-vault request failed")
        sync_status = request(url, "/api/github-sync/status", token=TOKEN)
        if sync_status.status != 200 or json.loads(sync_status.body).get("enabled") is not False:
            raise AssertionError("GitHub synchronization must be disabled by default")
        patch = request(
            url,
            "/api/vault/task-metadata",
            token=TOKEN,
            method="PATCH",
            payload={"path": TASK_PATH, "updates": {"priority": "2"}},
        )
        if patch.status != 200:
            raise AssertionError(f"runtime could not write the mounted vault: {patch.status} {patch.body}")

        docker("rm", "--force", first)
        active.remove(first)
        url = start_container(args.image, second, volume)
        active.add(second)
        wait_for_health(url)
        saved = request(url, f"/api/vault/file?path={TASK_PATH}", token=TOKEN)
        if saved.status != 200 or "priority: '2'" not in saved.body and "priority: 2" not in saved.body:
            raise AssertionError("vault edit did not persist across a container restart")

        print("Docker smoke test passed.")
        return 0
    finally:
        for name in active:
            subprocess.run(["docker", "rm", "--force", name], check=False, capture_output=True)
        subprocess.run(["docker", "volume", "rm", "--force", volume], check=False, capture_output=True)


if __name__ == "__main__":
    raise SystemExit(main())
