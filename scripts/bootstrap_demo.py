#!/usr/bin/env python3
"""Create a local vault from the repository's fictional example data."""
from __future__ import annotations

import argparse
import shutil
from datetime import date, timedelta
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def bootstrap(source: Path, target: Path, today: date | None = None) -> int:
    source = source.resolve()
    target = target.resolve()
    if not source.is_dir():
        raise SystemExit(f"Example vault is missing: {source}")
    existing = [path for path in target.rglob("*") if path.is_file() and path.name != ".gitkeep"] if target.exists() else []
    if existing:
        raise SystemExit(f"Refusing to overwrite non-empty vault: {target}")
    target.mkdir(parents=True, exist_ok=True)
    for path in source.rglob("*"):
        relative = path.relative_to(source)
        destination = target / relative
        if path.is_dir():
            destination.mkdir(parents=True, exist_ok=True)
        else:
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, destination)
    today_value = today or date.today()
    replacements = {
        "{{TODAY}}": today_value.isoformat(),
        "{{TODAY_PLUS_7}}": (today_value + timedelta(days=7)).isoformat(),
        "{{TODAY_PLUS_14}}": (today_value + timedelta(days=14)).isoformat(),
        "{{TODAY_PLUS_30}}": (today_value + timedelta(days=30)).isoformat(),
    }
    for path in target.rglob("*"):
        if not path.is_file() or path.suffix.lower() not in {".md", ".json", ".yml", ".yaml"}:
            continue
        text = path.read_text(encoding="utf-8")
        for marker, value in replacements.items():
            text = text.replace(marker, value)
        path.write_text(text, encoding="utf-8")
    return sum(1 for path in target.rglob("*") if path.is_file())


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=ROOT / "example-vault")
    parser.add_argument("--target", type=Path, default=ROOT / "vault")
    parser.add_argument("--today", type=date.fromisoformat, help=argparse.SUPPRESS)
    args = parser.parse_args()
    count = bootstrap(args.source, args.target, args.today)
    print(f"Created {args.target.resolve()} with {count} example files.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
