from __future__ import annotations

import hashlib
import os
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def render(vault: Path, output: Path) -> None:
    env = {
        **os.environ,
        "PM_VAULT_ROOT": str(vault),
        "PM_OUTPUT_ROOT": str(output),
        "PM_RENDER_TIMESTAMP": "2026-01-15T12:00:00Z",
    }
    subprocess.run(
        [sys.executable, "scripts/sync_markdown.py"],
        cwd=ROOT,
        env=env,
        check=True,
        capture_output=True,
        text=True,
    )
    subprocess.run(
        [sys.executable, "scripts/render_static.py"],
        cwd=ROOT,
        env=env,
        check=True,
        capture_output=True,
        text=True,
    )


def fixture_vault(root: Path) -> None:
    write(
        root / "projects/harbor-model/README.md",
        """---
kind: project
id: harbor-model
title: Harbor Model
domain: research
status: active
---
# Harbor Model
""",
    )
    write(
        root / "tasks/active/estimate.md",
        """---
kind: task
id: t-estimate
title: Estimate baseline
project: harbor-model
domain: research
status: open
due: 2026-01-20
---
# Estimate baseline
""",
    )
    write(
        root / "notes/private-memo.md",
        """---
kind: note
title: Confidential planning memo
project: harbor-model
domain: research
private: true
---
# Confidential planning memo
""",
    )


def digest_tree(root: Path) -> str:
    digest = hashlib.sha256()
    for path in sorted(root.rglob("*")):
        if path.is_file():
            digest.update(path.relative_to(root).as_posix().encode())
            digest.update(path.read_bytes())
    return digest.hexdigest()


def test_static_views_render_to_configured_generated_root(tmp_path: Path) -> None:
    vault = tmp_path / "vault"
    output = tmp_path / "output"
    fixture_vault(vault)

    render(vault, output)

    dashboard = output / "dashboard"
    for name in ("index.html", "today.html", "calendar.html", "boards.html", "status.html", "graph.html", "public.html"):
        assert (dashboard / name).is_file()
    assert (dashboard / "projects/harbor-model.html").is_file()
    assert (dashboard / "collaborators/index.html").is_file()
    assert not (ROOT / "dashboard").exists()


def test_public_display_filters_private_entries_and_warns_that_filter_is_not_encryption(tmp_path: Path) -> None:
    vault = tmp_path / "vault"
    output = tmp_path / "output"
    fixture_vault(vault)

    render(vault, output)
    html = (output / "dashboard/public.html").read_text(encoding="utf-8")

    assert "Harbor Model" in html
    assert "Estimate baseline" in html
    assert "Confidential planning memo" not in html
    assert "display filter, not encryption" in html


def test_static_render_is_deterministic_for_pinned_inputs(tmp_path: Path) -> None:
    vault = tmp_path / "vault"
    output = tmp_path / "output"
    fixture_vault(vault)

    render(vault, output)
    first = digest_tree(output)
    render(vault, output)

    assert digest_tree(output) == first
