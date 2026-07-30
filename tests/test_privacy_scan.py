from pathlib import Path

from scripts.privacy_scan import scan


def test_privacy_scan_flags_credentials_and_machine_paths(tmp_path: Path) -> None:
    (tmp_path / "unsafe.md").write_text(
        "key: ghp_" + "a" * 30 + "\n"
        "path: /" + "Users/example/private.txt\n",
        encoding="utf-8",
    )
    rules = {hit.rule for hit in scan(tmp_path, tracked_only=False)}
    assert {"github_token", "absolute_user_path"} <= rules


def test_privacy_scan_accepts_fictional_content(tmp_path: Path) -> None:
    (tmp_path / "safe.md").write_text(
        "# Example\n\nAssigned to Example Collaborator.\n",
        encoding="utf-8",
    )
    assert scan(tmp_path, tracked_only=False) == []
