from pathlib import Path

import pytest

from scripts.bootstrap_demo import bootstrap


def test_bootstrap_copies_example_without_overwriting(tmp_path: Path) -> None:
    source = tmp_path / "source"
    source.mkdir()
    (source / "START_HERE.md").write_text("# Start\n", encoding="utf-8")
    target = tmp_path / "target"

    assert bootstrap(source, target) == 1
    assert (target / "START_HERE.md").read_text(encoding="utf-8") == "# Start\n"

    with pytest.raises(SystemExit, match="Refusing to overwrite"):
        bootstrap(source, target)
