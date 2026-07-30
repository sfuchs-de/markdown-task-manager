from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def run(*args: str, env: dict[str, str] | None = None) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, *args],
        cwd=ROOT,
        env={**os.environ, **(env or {})},
        check=True,
        text=True,
        capture_output=True,
    )


def tree_digest(root: Path) -> str:
    digest = hashlib.sha256()
    for path in sorted(root.rglob("*")):
        if path.is_file():
            digest.update(path.relative_to(root).as_posix().encode("utf-8"))
            digest.update(path.read_bytes())
    return digest.hexdigest()


def test_initialized_synthetic_vault_exercises_all_data_families(tmp_path: Path) -> None:
    vault = tmp_path / "vault"
    output = vault / ".generated"
    env = {
        "PM_VAULT_ROOT": str(vault),
        "PM_OUTPUT_ROOT": str(output),
        "PM_RENDER_TIMESTAMP": "2026-07-30T12:00:00Z",
    }

    run("scripts/pm.py", "init", "--vault", str(vault), "--today", "2026-07-30")
    combined = "\n".join(
        path.read_text(encoding="utf-8")
        for path in vault.rglob("*")
        if path.is_file() and path.suffix in {".md", ".json", ".yml", ".yaml"}
    )
    assert "{{TODAY" not in combined

    doctor = run("scripts/pm.py", "doctor", env=env)
    assert "Doctor found no blocking" in doctor.stdout
    run("scripts/validate_vault_schema.py", "--root", str(vault))
    run("scripts/sync_markdown.py", env=env)

    data = output / "data"
    assert len(json.loads((data / "projects.json").read_text(encoding="utf-8"))) == 1
    assert len(json.loads((data / "tasks.json").read_text(encoding="utf-8"))) == 7
    assert len(json.loads((data / "events.json").read_text(encoding="utf-8"))) == 2
    assert len(json.loads((data / "notes.json").read_text(encoding="utf-8"))) == 11

    run("scripts/render_static.py", env=env)
    first = tree_digest(output / "dashboard")
    run("scripts/render_static.py", env=env)
    assert tree_digest(output / "dashboard") == first


def test_init_refuses_to_overwrite_nonempty_directory(tmp_path: Path) -> None:
    vault = tmp_path / "vault"
    vault.mkdir()
    (vault / "keep.md").write_text("# Keep\n", encoding="utf-8")

    result = subprocess.run(
        [sys.executable, "scripts/pm.py", "init", "--vault", str(vault)],
        cwd=ROOT,
        text=True,
        capture_output=True,
    )

    assert result.returncode != 0
    assert "Refusing to overwrite" in result.stderr
    assert (vault / "keep.md").read_text(encoding="utf-8") == "# Keep\n"
