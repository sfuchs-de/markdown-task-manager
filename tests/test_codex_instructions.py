from pathlib import Path

from scripts.markdown_reader import extract_codex_instructions as extract_static_instructions
from server.vault import VaultService, extract_codex_instructions as extract_live_instructions


BODY = """# Task

## Codex instructions

- [ ] queued | 2026-05-26 | Review the sources and update the task.
- [!] blocked | 2026-05-27 | Needs source record evidence.
- [x] processed | 2026-05-28 | Added the draft.
- [-] cancelled | Obsolete after consolidation.

## Log

- Done.
"""


def test_extract_codex_instructions_from_task_body() -> None:
    static = extract_static_instructions(BODY)
    live = extract_live_instructions(BODY)

    assert static == live
    assert [item["status"] for item in static] == ["queued", "blocked", "processed", "cancelled"]
    assert static[0]["date"] == "2026-05-26"
    assert static[0]["text"] == "Review the sources and update the task."
    assert static[-1]["date"] is None
    assert static[-1]["text"] == "Obsolete after consolidation."


def test_vault_scan_exposes_codex_instructions(tmp_path: Path) -> None:
    task = tmp_path / "tasks" / "active" / "t-demo.md"
    task.parent.mkdir(parents=True)
    task.write_text(
        "---\nkind: task\nstatus: open\ntitle: Demo\n---\n" + BODY,
        encoding="utf-8",
    )

    entries = VaultService(tmp_path).scan_entries()
    assert entries[0]["codex_instructions"][0]["status"] == "queued"
    assert entries[0]["codex_instructions"][1]["text"] == "Needs source record evidence."
