from __future__ import annotations

import subprocess
import sys
import os
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_ai_plan_context_cli_emits_copyable_prompt() -> None:
    result = subprocess.run(
        [
            sys.executable,
            "scripts/pm.py",
            "ai-plan-context",
            "--no-sync",
            "--date",
            "2026-05-06",
            "--week",
            "2026-05-06",
            "--ad-hoc",
            "protect writing",
        ],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=True,
    )

    assert "# Codex Agent Planning Brief" in result.stdout
    assert "protect writing" in result.stdout
    assert "Do not mark tasks complete" in result.stdout


def test_vault_context_loads_application_code_for_an_external_vault(tmp_path: Path) -> None:
    vault = tmp_path / "starter-vault"
    subprocess.run(
        [
            sys.executable,
            "scripts/pm.py",
            "init",
            "--vault",
            str(vault),
            "--today",
            "2030-01-15",
        ],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=True,
    )

    env = os.environ.copy()
    env["PM_VAULT_ROOT"] = str(vault)
    result = subprocess.run(
        [sys.executable, "scripts/pm.py", "vault-context"],
        cwd=ROOT,
        env=env,
        text=True,
        capture_output=True,
        check=True,
    )

    assert f'"vaultPath": "{vault}"' in result.stdout
    assert '"noteCount":' in result.stdout
