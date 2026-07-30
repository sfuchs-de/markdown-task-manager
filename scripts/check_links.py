#!/usr/bin/env python3
"""Check local Markdown links without making network requests."""
from __future__ import annotations

import argparse
import re
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import unquote, urlsplit


ROOT = Path(__file__).resolve().parents[1]
MARKDOWN_LINK = re.compile(r"!?\[[^\]]*]\(([^)]+)\)")
SKIP_PARTS = {
    ".git",
    ".venv",
    "node_modules",
    "dist",
    "vault",
    ".generated",
    "test-results",
    "playwright-report",
}


@dataclass(frozen=True)
class BrokenLink:
    source: str
    line: int
    target: str


def local_target(raw: str) -> str | None:
    value = raw.strip().split(maxsplit=1)[0].strip("<>")
    parsed = urlsplit(value)
    if parsed.scheme or parsed.netloc or value.startswith(("#", "mailto:", "tel:")):
        return None
    return unquote(parsed.path)


def markdown_files(root: Path) -> list[Path]:
    return sorted(
        path
        for path in root.rglob("*.md")
        if path.is_file() and not any(part in SKIP_PARTS for part in path.relative_to(root).parts)
    )


def check(root: Path = ROOT) -> list[BrokenLink]:
    root = root.resolve()
    broken: list[BrokenLink] = []
    for source in markdown_files(root):
        for line_number, line in enumerate(source.read_text(encoding="utf-8", errors="replace").splitlines(), 1):
            for match in MARKDOWN_LINK.finditer(line):
                target = local_target(match.group(1))
                if not target:
                    continue
                destination = (source.parent / target).resolve()
                try:
                    destination.relative_to(root)
                except ValueError:
                    broken.append(BrokenLink(source.relative_to(root).as_posix(), line_number, target))
                    continue
                if not destination.exists():
                    broken.append(BrokenLink(source.relative_to(root).as_posix(), line_number, target))
    return broken


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT)
    args = parser.parse_args()
    broken = check(args.root)
    if broken:
        print("Local link check failed:")
        for item in broken:
            print(f"- {item.source}:{item.line} -> {item.target}")
        return 1
    print("Local Markdown links passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
