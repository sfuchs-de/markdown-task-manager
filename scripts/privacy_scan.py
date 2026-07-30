#!/usr/bin/env python3
"""Scan the public tree (and optionally Git history) for private residue."""
from __future__ import annotations

import argparse
import hashlib
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


ROOT = Path(__file__).resolve().parents[1]
TEXT_SUFFIXES = {
    "", ".css", ".html", ".js", ".json", ".jsx", ".md", ".mjs", ".py",
    ".toml", ".ts", ".tsx", ".txt", ".yaml", ".yml",
}
BINARY_DOCUMENT_SUFFIXES = {
    ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".dta",
    ".parquet", ".feather", ".rds", ".sqlite", ".sqlite3", ".db",
}
SKIP_PARTS = {
    ".git", ".venv", "node_modules", "dist", "vault", "__pycache__",
    ".pytest_cache", ".generated", "test-results", "playwright-report",
    "private", "imports", "local_data", "large_data", "attachments",
}
SKIP_FILES = {"package-lock.json", "uv.lock"}
DISALLOWED_ROOTS = {
    "projects", "tasks", "dates", "areas", "journal", "private", "attachments",
    "dashboard", "data", ".generated",
}
ALLOWED_EMAIL_DOMAINS = {"example.com", "example.invalid"}
AUTHOR_PATHS = {"LICENSE", "pyproject.toml"}

PATTERNS = {
    "private_key": re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    "github_token": re.compile(r"\b(?:github_pat_|gh[pousr]_)[A-Za-z0-9_]{20,}\b"),
    "api_key": re.compile(r"\bsk-[A-Za-z0-9_-]{20,}\b"),
    "aws_access_key": re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    "tokenized_url": re.compile(
        r"https?://[^\s)>'\"]+[?&][^\s)>'\"]*(?:token|secret|signature|session|api_key|access_key)=",
        re.IGNORECASE,
    ),
    "gmail_url": re.compile(
        r"https?://(?:mail\.google\.com|www\.overleaf\.com/project|dropbox\.com/(?:home|scl))/[^\s)>'\"]*",
        re.IGNORECASE,
    ),
    "absolute_user_path": re.compile(r"(?:/Users/[^/\s]+|/home/[^/\s]+|C:\\Users\\[^\\\s]+)"),
}
EMAIL_PATTERN = re.compile(r"\b[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})\b", re.IGNORECASE)

# Private names, organizations, project titles, identifiers, and path fragments
# are represented only by hashes so the denylist cannot disclose them.
FORBIDDEN_TOKEN_HASHES = {
    "0a5d17d3b19f82f8340d3977609aa9e86b4ad8b9bd71bd9eced9271f1d5b2e4a",
    "0d58b31998267f61455706238ccec58e492e1c65a14c9722b9c4ea883be035c5",
    "d445d66fd83e74fd55bca56b664dcb240900204fe37fde7a93fa4ce9a49b063c",
    "d63af4853c5d22633c7ddefc9d89a68d4b49e9228fdbfadadc9aa2953906c7ba",
    "a2114e464a6b56701ee1ac601abd50b761c30c1a17a5313395089feaf9304812",
    "56b82f67c093b5559e55c56792ca43c46df3869e2fad1600c2a6537307bc066a",
    "c5ec8d2328e2bdf4329dc97aae2a14ae88ee1888413e27e447251563969fac26",
}


@dataclass(frozen=True)
class Hit:
    path: str
    line: int
    rule: str


def token_hash(value: str) -> str:
    return hashlib.sha256(value.casefold().encode("utf-8")).hexdigest()


def path_hits(path: str) -> list[Hit]:
    relative = Path(path)
    hits: list[Hit] = []
    if relative.parts and relative.parts[0] in DISALLOWED_ROOTS:
        hits.append(Hit(path, 0, "disallowed_public_root"))
    if relative.suffix.lower() in BINARY_DOCUMENT_SUFFIXES:
        hits.append(Hit(path, 0, "binary_document"))
    return hits


def text_hits(path: str, text: str) -> list[Hit]:
    if path == "scripts/privacy_scan.py":
        return []
    hits: list[Hit] = []
    for line_number, line in enumerate(text.splitlines(), 1):
        for rule, pattern in PATTERNS.items():
            if pattern.search(line):
                hits.append(Hit(path, line_number, rule))
        for match in EMAIL_PATTERN.finditer(line):
            if match.group(1).lower() not in ALLOWED_EMAIL_DOMAINS:
                hits.append(Hit(path, line_number, "real_email_domain"))
        tokens = re.findall(r"[A-Za-z0-9_.-]+", line)
        candidates = tokens + [f"{left} {right}" for left, right in zip(tokens, tokens[1:])]
        if path in AUTHOR_PATHS:
            candidates = [value for value in candidates if value.casefold() not in {"simon", "fuchs", "simon fuchs"}]
        if any(token_hash(value) in FORBIDDEN_TOKEN_HASHES for value in candidates):
            hits.append(Hit(path, line_number, "private_denylist"))
    return hits


def files(root: Path, tracked_only: bool) -> Iterable[Path]:
    if tracked_only:
        result = subprocess.run(
            ["git", "ls-files"],
            cwd=root,
            check=True,
            text=True,
            capture_output=True,
        )
        candidates: Iterable[Path] = (root / item for item in result.stdout.splitlines())
    else:
        candidates = root.rglob("*")
    for path in candidates:
        if not path.is_file() or path.name in SKIP_FILES:
            continue
        relative = path.relative_to(root)
        if any(part in SKIP_PARTS for part in relative.parts):
            continue
        yield path


def scan(root: Path = ROOT, tracked_only: bool = True) -> list[Hit]:
    root = root.resolve()
    hits: list[Hit] = []
    for path in files(root, tracked_only):
        relative = path.relative_to(root).as_posix()
        hits.extend(path_hits(relative))
        if path.suffix.lower() not in TEXT_SUFFIXES:
            continue
        hits.extend(text_hits(relative, path.read_text(encoding="utf-8", errors="replace")))
    return sorted(set(hits), key=lambda hit: (hit.path, hit.line, hit.rule))


def scan_root(root: Path = ROOT, tracked_only: bool = True) -> list[Hit]:
    """Compatibility alias used by older callers and tests."""
    return scan(root, tracked_only)


def scan_history(root: Path = ROOT) -> list[Hit]:
    root = root.resolve()
    try:
        commits = subprocess.run(
            ["git", "rev-list", "--all"],
            cwd=root,
            check=True,
            text=True,
            capture_output=True,
        ).stdout.splitlines()
    except (OSError, subprocess.CalledProcessError):
        return []

    hits: list[Hit] = []
    seen_blobs: set[str] = set()
    for commit in commits:
        tree = subprocess.run(
            ["git", "ls-tree", "-r", commit],
            cwd=root,
            check=True,
            text=True,
            capture_output=True,
        ).stdout.splitlines()
        for row in tree:
            metadata, path = row.split("\t", 1)
            blob = metadata.split()[2]
            hits.extend(path_hits(path))
            suffix = Path(path).suffix.lower()
            if blob in seen_blobs or suffix not in TEXT_SUFFIXES or Path(path).name in SKIP_FILES:
                continue
            seen_blobs.add(blob)
            content = subprocess.run(
                ["git", "cat-file", "-p", blob],
                cwd=root,
                check=True,
                capture_output=True,
            ).stdout.decode("utf-8", errors="replace")
            hits.extend(text_hits(path, content))
    return sorted(set(hits), key=lambda hit: (hit.path, hit.line, hit.rule))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--all-files", action="store_true")
    parser.add_argument("--history", action="store_true")
    args = parser.parse_args()
    hits = scan(args.root, tracked_only=not args.all_files)
    if args.history:
        hits = sorted(set(hits + scan_history(args.root)), key=lambda hit: (hit.path, hit.line, hit.rule))
    if hits:
        print("Privacy scan failed:")
        for hit in hits:
            print(f"- {hit.path}:{hit.line} [{hit.rule}]")
        return 1
    print("Privacy scan passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
