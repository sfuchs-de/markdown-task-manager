#!/usr/bin/env python3
"""Import a Strava archive into private raw storage plus a safe Markdown summary."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import shutil
import zipfile
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

import yaml

try:
    from scripts.workbench_paths import VAULT_ROOT
except ImportError:  # pragma: no cover
    from workbench_paths import VAULT_ROOT

ROOT = VAULT_ROOT
DEFAULT_IMPORT_ROOT = ROOT / "areas" / "wellness" / "imports" / "strava"
DEFAULT_NOTE_DIR = ROOT / "areas" / "wellness" / "notes"


@dataclass(frozen=True)
class Activity:
    activity_id: str
    started_at: datetime
    activity_type: str
    distance_km: float
    moving_hours: float
    elevation_gain_m: float
    calories: float
    relative_effort: float


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path, help="Path to a Strava export zip")
    parser.add_argument("--import-date", default=date.today().isoformat(), help="Import date for folder and note names")
    parser.add_argument("--import-root", type=Path, default=DEFAULT_IMPORT_ROOT, help="Ignored private import root")
    parser.add_argument("--note-dir", type=Path, default=DEFAULT_NOTE_DIR, help="Tracked private summary note directory")
    parser.add_argument("--project", default="", help="Optional project id to attach to the aggregate note")
    parser.add_argument("--copy-archive", action="store_true", help="Copy the full zip into the private import folder")
    return parser.parse_args()


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", value).strip("-").lower()
    return slug or "strava-export"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
      for chunk in iter(lambda: handle.read(1024 * 1024), b""):
          digest.update(chunk)
    return digest.hexdigest()


def dedupe_headers(headers: list[str]) -> list[str]:
    counts: Counter[str] = Counter()
    result: list[str] = []
    for header in headers:
        counts[header] += 1
        result.append(header if counts[header] == 1 else f"{header}__{counts[header]}")
    return result


def number(value: Any) -> float:
    try:
        return float(str(value or "0").replace(",", ""))
    except ValueError:
        return 0.0


def parse_activity_date(value: str) -> datetime:
    return datetime.strptime(value, "%b %d, %Y, %I:%M:%S %p")


def read_activities(archive: Path) -> tuple[list[Activity], str]:
    with zipfile.ZipFile(archive) as zf:
        raw = zf.read("activities.csv").decode("utf-8-sig")
    rows = list(csv.reader(raw.splitlines()))
    headers = dedupe_headers(rows[0])
    activities: list[Activity] = []
    for row in rows[1:]:
        if len(row) < len(headers):
            row += [""] * (len(headers) - len(row))
        record = dict(zip(headers, row))
        try:
            started_at = parse_activity_date(record.get("Activity Date", ""))
        except ValueError:
            continue
        distance_m = number(record.get("Distance__2"))
        activities.append(
            Activity(
                activity_id=str(record.get("Activity ID") or ""),
                started_at=started_at,
                activity_type=str(record.get("Activity Type") or "Other"),
                distance_km=distance_m / 1000,
                moving_hours=number(record.get("Moving Time")) / 3600,
                elevation_gain_m=number(record.get("Elevation Gain")),
                calories=number(record.get("Calories")),
                relative_effort=number(record.get("Relative Effort")),
            )
        )
    return activities, raw


def empty_bucket() -> dict[str, float | int]:
    return {
        "activities": 0,
        "distance_km": 0.0,
        "moving_hours": 0.0,
        "elevation_gain_m": 0.0,
        "calories": 0.0,
        "relative_effort": 0.0,
    }


def add_activity(bucket: dict[str, float | int], activity: Activity) -> None:
    bucket["activities"] = int(bucket["activities"]) + 1
    bucket["distance_km"] = float(bucket["distance_km"]) + activity.distance_km
    bucket["moving_hours"] = float(bucket["moving_hours"]) + activity.moving_hours
    bucket["elevation_gain_m"] = float(bucket["elevation_gain_m"]) + activity.elevation_gain_m
    bucket["calories"] = float(bucket["calories"]) + activity.calories
    bucket["relative_effort"] = float(bucket["relative_effort"]) + activity.relative_effort


def rounded(bucket: dict[str, float | int]) -> dict[str, float | int]:
    return {
        "activities": int(bucket["activities"]),
        "distance_km": round(float(bucket["distance_km"]), 1),
        "moving_hours": round(float(bucket["moving_hours"]), 1),
        "elevation_gain_m": round(float(bucket["elevation_gain_m"])),
        "calories": round(float(bucket["calories"])),
        "relative_effort": round(float(bucket["relative_effort"])),
    }


def month_add(start: date, offset: int) -> date:
    month_index = start.year * 12 + start.month - 1 + offset
    return date(month_index // 12, month_index % 12 + 1, 1)


def build_summary(activities: list[Activity], import_date: str, source_pointer: str) -> dict[str, Any]:
    if not activities:
        raise ValueError("No activities found in activities.csv")

    sorted_activities = sorted(activities, key=lambda item: item.started_at)
    period_start = sorted_activities[0].started_at.date()
    period_end = sorted_activities[-1].started_at.date()
    total = empty_bucket()
    for activity in sorted_activities:
        add_activity(total, activity)

    by_type: dict[str, dict[str, float | int]] = defaultdict(empty_bucket)
    by_month: dict[str, dict[str, float | int]] = defaultdict(empty_bucket)
    by_week: dict[str, dict[str, float | int]] = defaultdict(empty_bucket)
    for activity in sorted_activities:
        add_activity(by_type[activity.activity_type], activity)
        add_activity(by_month[activity.started_at.strftime("%Y-%m")], activity)
        week_start = activity.started_at.date() - timedelta(days=activity.started_at.weekday())
        add_activity(by_week[week_start.isoformat()], activity)

    last_month = date(period_end.year, period_end.month, 1)
    recent_months = [month_add(last_month, -offset).strftime("%Y-%m") for offset in range(17, -1, -1)]
    end_week = period_end - timedelta(days=period_end.weekday())
    recent_week_starts = [(end_week - timedelta(days=7 * offset)).isoformat() for offset in range(11, -1, -1)]
    recent_cutoff = period_end - timedelta(days=89)
    recent_90d = empty_bucket()
    for activity in sorted_activities:
        if activity.started_at.date() >= recent_cutoff:
            add_activity(recent_90d, activity)

    return {
        "source": "Strava export",
        "import_date": import_date,
        "source_private_path": source_pointer,
        "period_start": period_start.isoformat(),
        "period_end": period_end.isoformat(),
        "totals": rounded(total),
        "recent_90d": rounded(recent_90d),
        "activity_types": [
            {"type": activity_type, **rounded(bucket)}
            for activity_type, bucket in sorted(by_type.items(), key=lambda item: (-int(item[1]["activities"]), item[0]))
        ],
        "recent_months": [
            {"month": month, **rounded(by_month.get(month, empty_bucket()))}
            for month in recent_months
        ],
        "recent_weeks": [
            {"week_start": week, **rounded(by_week.get(week, empty_bucket()))}
            for week in recent_week_starts
        ],
    }


def build_note(summary: dict[str, Any], project: str = "") -> str:
    frontmatter = {
        "kind": "strava-summary",
        "domain": "personal",
        "area": "wellness",
        "module": "wellness",
        "title": f"Strava activity summary through {summary['period_end']}",
        "date": summary["import_date"],
        "private": True,
        "source": summary["source"],
        "source_private_path": summary["source_private_path"],
        "strava_activity_count": summary["totals"]["activities"],
        "strava_period_start": summary["period_start"],
        "strava_period_end": summary["period_end"],
        "strava_moving_hours": summary["totals"]["moving_hours"],
        "strava_distance_km": summary["totals"]["distance_km"],
        "strava_recent_90d_activities": summary["recent_90d"]["activities"],
        "strava_recent_90d_moving_hours": summary["recent_90d"]["moving_hours"],
        "strava_recent_90d_distance_km": summary["recent_90d"]["distance_km"],
        "strava_summary_json": json.dumps(summary, separators=(",", ":")),
    }
    if project:
        frontmatter["project"] = project
    top_types = summary["activity_types"][:5]
    recent = summary["recent_90d"]
    totals = summary["totals"]
    top_type_lines = "\n".join(
        f"- {item['type']}: {item['activities']} activities, {item['moving_hours']} hours, {item['distance_km']} km."
        for item in top_types
    )
    body = f"""# Strava Activity Summary Through {summary['period_end']}

Source: private Strava archive import. Raw GPS/workout files stay under the ignored private import folder.

## Safe aggregate snapshot

- Period covered: {summary['period_start']} to {summary['period_end']}.
- Activities: {totals['activities']}.
- Moving time: {totals['moving_hours']} hours.
- Distance: {totals['distance_km']} km.
- Recent 90 days: {recent['activities']} activities, {recent['moving_hours']} moving hours, {recent['distance_km']} km.

## Main activity mix

{top_type_lines}

## Architecture

- Put future Strava exports in the ignored private import area via `python3 scripts/import_strava_archive.py /path/to/export.zip`.
- The script extracts only `activities.csv` and writes sanitized aggregate frontmatter into this tracked private note.
- Do not commit raw GPX, FIT, TCX, media, profile, contact, route, or social files.
- Health Review reads the aggregate `strava_summary` frontmatter for charts and keeps details hidden in private mode.
"""
    return f"---\n{yaml.safe_dump(frontmatter, sort_keys=False, allow_unicode=False).strip()}\n---\n{body}"


def main() -> None:
    args = parse_args()
    archive = args.archive.expanduser().resolve()
    if not archive.exists():
        raise SystemExit(f"Archive not found: {archive}")

    activities, activities_csv = read_activities(archive)
    import_slug = f"{args.import_date}-{slugify(archive.stem)}"
    import_dir = (args.import_root if args.import_root.is_absolute() else ROOT / args.import_root) / import_slug
    import_dir.mkdir(parents=True, exist_ok=True)
    (import_dir / "activities.csv").write_text(activities_csv, encoding="utf-8")
    if args.copy_archive:
        shutil.copy2(archive, import_dir / archive.name)

    manifest = {
        "source_archive": str(archive),
        "source_sha256": sha256_file(archive),
        "import_date": args.import_date,
        "activity_rows": len(activities),
        "extracted_files": ["activities.csv"],
        "not_extracted": ["activities/*.gpx", "activities/*.fit.gz", "activities/*.tcx.gz", "media/*", "routes/*", "profile/contact/social files"],
    }
    (import_dir / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    source_pointer = str(import_dir.relative_to(ROOT))
    summary = build_summary(activities, args.import_date, source_pointer)
    (import_dir / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")

    note_dir = args.note_dir if args.note_dir.is_absolute() else ROOT / args.note_dir
    note_dir.mkdir(parents=True, exist_ok=True)
    note_path = note_dir / f"{args.import_date}-strava-activity-summary.md"
    note_path.write_text(build_note(summary, args.project), encoding="utf-8")
    print(json.dumps({"note": str(note_path.relative_to(ROOT)), "private_import": source_pointer, "activities": len(activities)}, indent=2))


if __name__ == "__main__":
    main()
