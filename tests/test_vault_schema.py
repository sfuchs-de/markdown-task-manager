from __future__ import annotations

from pathlib import Path

from scripts.validate_vault_schema import validate_root


def write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def test_schema_validator_accepts_canonical_task_and_travel_ledger(tmp_path: Path) -> None:
    write(
        tmp_path / "tasks/active/t-good.md",
        """---
id: t-good
kind: task
status: open
priority: 1
deadline_type: hard
due: 2026-05-28
urgent: true
---
# Good task
""",
    )
    write(
        tmp_path / "projects/operations/travel_ledger.md",
        """---
kind: travel-ledger
ledger:
  - id: test-trip-flight
    trip_key: test-trip
    item: Flight estimate
    category: flight
    estimate: 500
    currency: USD
    status: approval_needed
    reimbursable: true
---
# Travel ledger
""",
    )

    assert validate_root(tmp_path) == []


def test_schema_validator_reports_invalid_task_fields(tmp_path: Path) -> None:
    write(
        tmp_path / "tasks/active/t-bad.md",
        """---
id: wrong-id
kind: task
status: urgent-ish
priority: high
deadline_type: approximate
due: soon
urgent: maybe
---
# Bad task
""",
    )

    issues = validate_root(tmp_path)
    fields = {issue.field for issue in issues}

    assert {"id", "status", "priority", "deadline_type", "due", "urgent"} <= fields


def test_schema_validator_reports_deprecated_status_and_ownership_fields(tmp_path: Path) -> None:
    write(
        tmp_path / "tasks/active/t-deprecated.md",
        """---
id: t-deprecated
kind: task
status: completed
priority: 2
deadline_type: soft
due: 2026-05-28
lead: Owner
assignee: Owner
owner: Team
---
# Deprecated task
""",
    )

    issues = validate_root(tmp_path)
    messages = "\n".join(f"{issue.field}: {issue.message}" for issue in issues)

    assert "deprecated task status 'completed'; use 'done'" in messages
    assert "deprecated task ownership field; use 'assignee'" in messages
    assert "use only one task ownership field" in messages


def test_schema_validator_requires_deadline_type_for_open_dated_tasks(tmp_path: Path) -> None:
    write(
        tmp_path / "tasks/active/t-dated.md",
        """---
id: t-dated
kind: task
status: open
priority: 2
due: 2026-05-28
---
# Dated task
""",
    )

    issues = validate_root(tmp_path)

    assert any(
        issue.field == "deadline_type" and "open dated tasks" in issue.message
        for issue in issues
    )


def test_schema_validator_reports_travel_ledger_shape_errors(tmp_path: Path) -> None:
    write(
        tmp_path / "projects/operations/travel_ledger.md",
        """---
kind: travel-ledger
ledger:
  - id: bad-row
    trip_key: bad
    item: Broken row
    category: flight
    status: mystery
    estimate: lots
    booking_url: https://example.com
---
# Travel ledger
""",
    )

    issues = validate_root(tmp_path)
    messages = "\n".join(f"{issue.field}: {issue.message}" for issue in issues)

    assert "unknown ledger field(s): booking_url" in messages
    assert "unsupported ledger status 'mystery'" in messages
    assert "amount fields must be numeric" in messages
