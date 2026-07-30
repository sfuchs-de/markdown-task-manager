from __future__ import annotations

from pathlib import Path

from scripts.privacy_scan import scan_root


def write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def test_privacy_scan_flags_gmail_urls_and_tokenized_links(tmp_path: Path) -> None:
    gmail_url = "https://mail." + "google.com/mail/#all/19abc"
    tokenized_url = "https://example.com/cart?" + "token=secret"
    write(
        tmp_path / "docs/source.md",
        f"Open in source record: {gmail_url}\n"
        f"Booking cart: {tokenized_url}\n",
    )

    hits = scan_root(tmp_path, tracked_only=False)
    rules = {hit.rule for hit in hits}

    assert {"gmail_url", "tokenized_url"} <= rules


def test_privacy_scan_allows_documented_env_var_names(tmp_path: Path) -> None:
    write(tmp_path / "docs/render.md", "Set PM_GITHUB_TOKEN in Render, but do not commit its value.\n")

    assert scan_root(tmp_path, tracked_only=False) == []


def test_privacy_scan_skips_private_folders(tmp_path: Path) -> None:
    gmail_url = "https://mail." + "google.com/mail/#all/19abc"
    write(tmp_path / "projects/operations/private/receipt.md", f"{gmail_url}\n")

    assert scan_root(tmp_path, tracked_only=False) == []


def test_privacy_scan_flags_absolute_user_paths_and_real_email_domains(tmp_path: Path) -> None:
    absolute_path = "/" + "Users/example/private"
    write(tmp_path / "docs/leak.md", "Owner: person@" + f"real-domain.test\nPath: {absolute_path}\n")

    rules = {hit.rule for hit in scan_root(tmp_path, tracked_only=False)}

    assert {"absolute_user_path", "real_email_domain"} <= rules


def test_privacy_scan_flags_binary_documents_and_disallowed_roots(tmp_path: Path) -> None:
    write(tmp_path / "projects/private-project/README.md", "# Not public\n")
    write(tmp_path / "docs/manuscript.pdf", "not really a PDF")

    rules = {hit.rule for hit in scan_root(tmp_path, tracked_only=False)}

    assert {"disallowed_public_root", "binary_document"} <= rules
