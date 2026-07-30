from pathlib import Path

from scripts.check_links import check, local_target


def test_local_target_ignores_remote_and_anchor_links() -> None:
    assert local_target("https://example.com/page") is None
    assert local_target("#section") is None
    assert local_target("docs/CONFIGURATION.md#modules") == "docs/CONFIGURATION.md"


def test_check_reports_missing_local_links(tmp_path: Path) -> None:
    (tmp_path / "README.md").write_text("[good](docs/ok.md) [bad](docs/missing.md)\n", encoding="utf-8")
    (tmp_path / "docs").mkdir()
    (tmp_path / "docs/ok.md").write_text("# OK\n", encoding="utf-8")

    broken = check(tmp_path)

    assert [(item.source, item.target) for item in broken] == [("README.md", "docs/missing.md")]
