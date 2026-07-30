from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_public_tree_has_no_user_vault_or_binary_documents() -> None:
    forbidden_roots = {"projects", "tasks", "dates", "journal", "areas", "private", "dashboard", "data"}
    assert not (forbidden_roots & {path.name for path in ROOT.iterdir() if path.is_dir()})

    forbidden_suffixes = {".pdf", ".docx", ".xlsx", ".sqlite", ".db", ".dta", ".parquet"}
    leaked = [
        path.relative_to(ROOT).as_posix()
        for path in ROOT.rglob("*")
        if path.is_file()
        and not any(part in {".git", ".venv", "node_modules", "dist"} for part in path.relative_to(ROOT).parts)
        and path.suffix.lower() in forbidden_suffixes
    ]
    assert leaked == []


def test_example_vault_contains_only_fictional_identity_labels() -> None:
    text = "\n".join(
        path.read_text(encoding="utf-8")
        for path in (ROOT / "example-vault").rglob("*.md")
    )
    assert "Avery Example" in text
    assert "Fictional Research Studio" not in text
    assert "All amounts and coverage rules are invented." in text
