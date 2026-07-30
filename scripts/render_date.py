#!/usr/bin/env python3
"""Shared render clock for dashboard generation.

Dashboards embed today-relative content (day offsets like "(+3d)", "today"
badges, week windows). For the committed dashboards to stay reproducible across
machines and CI, every renderer must agree on what "today" is. `date.today()`
returns the LOCAL date, so a render on a Pacific-time laptop and the GitHub
Actions render (which runs in UTC) disagree across the day boundary and the
`git diff --exit-code -- data dashboard` drift gate fails.

Using the UTC date makes a local render and the CI render produce identical
output on the same calendar day. `PM_RENDER_DATE=YYYY-MM-DD` pins the date
explicitly when an exact, stable date is needed.
"""
from __future__ import annotations

import os
from datetime import date, datetime, timezone


def render_today() -> date:
    override = os.environ.get("PM_RENDER_DATE")
    if override:
        try:
            return date.fromisoformat(override.strip())
        except ValueError:
            pass
    return datetime.now(timezone.utc).date()
