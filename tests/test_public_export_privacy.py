from __future__ import annotations

from pathlib import Path

from scripts.render_static import visible


def test_public_display_excludes_private_entries() -> None:
    entries = [
        {"title": "Shareable result", "private": False},
        {"title": "Internal note", "private": True},
    ]

    assert visible(entries, include_private=False) == [entries[0]]
    assert visible(entries, include_private=True) == entries


def test_generated_outputs_are_ignored() -> None:
    root = Path(__file__).resolve().parents[1]
    gitignore = (root / ".gitignore").read_text(encoding="utf-8")

    assert ".generated/" in gitignore
    assert "vault/" in gitignore
