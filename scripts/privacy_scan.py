#!/usr/bin/env python3
"""Fail when a public-source file appears to contain credentials or private residue."""
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
    "",
    ".css",
    ".html",
    ".js",
    ".json",
    ".jsx",
    ".md",
    ".mjs",
    ".py",
    ".toml",
    ".ts",
    ".tsx",
    ".txt",
    ".yaml",
    ".yml",
}
SKIP_PARTS = {".git", ".venv", "node_modules", "dist", "vault", "__pycache__", ".pytest_cache"}
SKIP_FILES = {"package-lock.json"}

PATTERNS = {
    "private_key": re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    "github_token": re.compile(r"\b(?:github_pat_|gh[pousr]_)[A-Za-z0-9_]{20,}\b"),
    "api_key": re.compile(r"\bsk-[A-Za-z0-9_-]{20,}\b"),
    "aws_access_key": re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    "credential_url": re.compile(
        r"https?://[^\s)>'\"]+[?&][^\s)>'\"]*(?:token|secret|signature|session|api_key|access_key)=",
        re.IGNORECASE,
    ),
    "absolute_user_path": re.compile(r"(?:/Users/|C:\\Users\\)[A-Za-z0-9._ -]+"),
    "personal_email": re.compile(r"\b[A-Z0-9._%+-]+@(?:gmail|outlook|yahoo|icloud)\.[A-Z]{2,}\b", re.IGNORECASE),
}

# Hashes let this repository guard against known private names and identifiers
# without publishing those strings in the scanner itself.
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


def files(root: Path, tracked_only: bool) -> Iterable[Path]:
    if tracked_only:
        result = subprocess.run(
            ["git", "ls-files"],
            cwd=root,
            check=True,
            text=True,
            capture_output=True,
        )
        candidates = [root / item for item in result.stdout.splitlines()]
    else:
        candidates = root.rglob("*")
    for path in candidates:
        if not path.is_file() or path.name in SKIP_FILES:
            continue
        relative = path.relative_to(root)
        if any(part in SKIP_PARTS for part in relative.parts):
            continue
        if path.suffix.lower() not in TEXT_SUFFIXES:
            continue
        yield path


def scan(root: Path = ROOT, tracked_only: bool = True) -> list[Hit]:
    root = root.resolve()
    hits: list[Hit] = []
    for path in files(root, tracked_only):
        if path.resolve() == Path(__file__).resolve():
            continue
        text = path.read_text(encoding="utf-8", errors="replace")
        for line_number, line in enumerate(text.splitlines(), 1):
            for rule, pattern in PATTERNS.items():
                if pattern.search(line):
                    hits.append(Hit(path.relative_to(root).as_posix(), line_number, rule))
            tokens = re.findall(r"[A-Za-z0-9_.-]+", line)
            pairs = tokens + [f"{left} {right}" for left, right in zip(tokens, tokens[1:])]
            if any(token_hash(token) in FORBIDDEN_TOKEN_HASHES for token in pairs):
                hits.append(Hit(path.relative_to(root).as_posix(), line_number, "private_residue"))
    return hits


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--all-files", action="store_true")
    args = parser.parse_args()
    hits = scan(args.root, tracked_only=not args.all_files)
    if hits:
        print("Privacy scan failed:")
        for hit in hits:
            print(f"- {hit.path}:{hit.line} [{hit.rule}]")
        return 1
    print("Privacy scan passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
