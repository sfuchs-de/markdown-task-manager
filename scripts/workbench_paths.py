"""Shared filesystem locations for the application and the active vault."""
from __future__ import annotations

import os
from pathlib import Path


APP_ROOT = Path(__file__).resolve().parents[1]


def configured_vault_root() -> Path:
    raw = os.environ.get("PM_VAULT_ROOT", "").strip()
    return Path(raw).expanduser().resolve() if raw else (APP_ROOT / "vault").resolve()


def configured_output_root(vault_root: Path | None = None) -> Path:
    raw = os.environ.get("PM_OUTPUT_ROOT", "").strip()
    if raw:
        return Path(raw).expanduser().resolve()
    return ((vault_root or configured_vault_root()) / ".generated").resolve()


VAULT_ROOT = configured_vault_root()
OUTPUT_ROOT = configured_output_root(VAULT_ROOT)
DATA_ROOT = OUTPUT_ROOT / "data"
DASHBOARD_ROOT = OUTPUT_ROOT / "dashboard"
TEMPLATE_ROOT = APP_ROOT / "templates"
EXAMPLE_VAULT_ROOT = APP_ROOT / "example-vault"
