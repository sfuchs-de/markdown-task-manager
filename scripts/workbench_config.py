"""Load and apply vault-local Research Workbench configuration."""
from __future__ import annotations

from copy import deepcopy
from pathlib import Path
from typing import Any

import yaml


DEFAULT_CONFIG: dict[str, Any] = {
    "application": {
        "name": "Research Workbench",
        "owner_label": "Owner",
        "owner_aliases": ["owner", "me", "self"],
    },
    "modules": {
        "overview": {"enabled": True, "label": "Overview"},
        "tasks": {"enabled": True, "label": "Tasks"},
        "projects": {"enabled": True, "label": "Projects"},
        "notes": {"enabled": True, "label": "Library"},
        "calendar": {"enabled": True, "label": "Calendar"},
        "boards": {"enabled": True, "label": "Boards"},
        "graph": {"enabled": True, "label": "Graph"},
        "time_planning": {"enabled": True, "label": "Time Plan"},
        "admin": {"enabled": True, "label": "Admin Center"},
        "travel": {"enabled": True, "label": "Travel Center"},
        "collaborators": {"enabled": True, "label": "Collaborators"},
        "wellness": {"enabled": True, "label": "Wellness"},
        "performance": {"enabled": True, "label": "Performance Review"},
        "scholar_metrics": {"enabled": True, "label": "Scholar Metrics"},
        "github_sync": {"enabled": False, "label": "GitHub Sync"},
        "markdown_editor": {"enabled": True, "label": "Editor"},
        "codex_backlog": {"enabled": True, "label": "Agent Backlog"},
    },
    "domains": {
        "labels": {
            "research": "Research",
            "admin": "Administration",
            "teaching": "Teaching",
            "personal": "Personal",
            "system": "System",
            "archive": "Archive",
            "other": "Other",
        },
        "classification_rules": [
            {"domain": "research", "field": "domain", "values": ["research"]},
            {"domain": "admin", "field": "domain", "values": ["admin"]},
            {"domain": "teaching", "field": "domain", "values": ["teaching"]},
            {"domain": "personal", "field": "domain", "values": ["personal", "wellness"]},
            {"domain": "system", "field": "domain", "values": ["system"]},
            {"domain": "archive", "field": "domain", "values": ["archive"]},
        ],
    },
    "profile": {
        "scholar_statistics_source": "",
    },
}


def _merge(base: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
    merged = deepcopy(base)
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = _merge(merged[key], value)
        else:
            merged[key] = deepcopy(value)
    return merged


def load_workbench_config(vault_root: Path) -> dict[str, Any]:
    path = vault_root / "settings" / "workbench.yml"
    if not path.exists():
        return deepcopy(DEFAULT_CONFIG)
    try:
        parsed = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    except (OSError, yaml.YAMLError):
        parsed = {}
    return _merge(DEFAULT_CONFIG, parsed if isinstance(parsed, dict) else {})


def safe_ui_config(config: dict[str, Any]) -> dict[str, Any]:
    application = config.get("application") if isinstance(config.get("application"), dict) else {}
    domains = config.get("domains") if isinstance(config.get("domains"), dict) else {}
    modules = config.get("modules") if isinstance(config.get("modules"), dict) else {}
    return {
        "application_name": str(application.get("name") or "Research Workbench"),
        "owner_label": str(application.get("owner_label") or "Owner"),
        "owner_aliases": [
            str(value).strip()
            for value in application.get("owner_aliases", [])
            if str(value).strip()
        ],
        "modules": {
            str(key): {
                "enabled": bool(value.get("enabled", True)) if isinstance(value, dict) else bool(value),
                "label": str(value.get("label") or key.replace("_", " ").title()) if isinstance(value, dict)
                else key.replace("_", " ").title(),
            }
            for key, value in modules.items()
        },
        "domain_labels": {
            str(key): str(value)
            for key, value in (domains.get("labels") or {}).items()
        },
    }


def normalized(value: Any) -> str:
    return str(value or "").strip().lower().replace("_", "-")


def classify_entry(
    entry: dict[str, Any],
    config: dict[str, Any],
    project_domains: dict[str, str] | None = None,
) -> tuple[str, str]:
    domains = config.get("domains") if isinstance(config.get("domains"), dict) else {}
    labels = domains.get("labels") if isinstance(domains.get("labels"), dict) else {}
    valid = {normalized(key) for key in labels} | {"other"}

    explicit = normalized(entry.get("domain"))
    if explicit in valid:
        return explicit, "frontmatter"

    project = normalized(entry.get("project"))
    if project and project_domains and project_domains.get(project):
        return project_domains[project], "project"

    rules = domains.get("classification_rules")
    if isinstance(rules, list):
        for rule in rules:
            if not isinstance(rule, dict):
                continue
            target = normalized(rule.get("domain"))
            field = str(rule.get("field") or "").strip()
            values = rule.get("values")
            if target not in valid or not field or not isinstance(values, list):
                continue
            current = normalized(entry.get(field) or (entry.get("properties") or {}).get(field))
            if current and current in {normalized(value) for value in values}:
                return target, f"rule:{field}"

    kind = normalized(entry.get("kind") or entry.get("type"))
    collection = normalized(entry.get("collection"))
    status = normalized(entry.get("status"))
    if collection == "templates" or kind == "template":
        return "system", "structural"
    if collection == "archive" or status in {"archive", "archived"}:
        return "archive", "structural"
    return "other", "fallback"


def apply_domain_classification(entries: list[dict[str, Any]], config: dict[str, Any]) -> None:
    project_domains: dict[str, str] = {}
    for entry in entries:
        if str(entry.get("kind") or "").lower() != "project":
            continue
        project = normalized(entry.get("id") or entry.get("project"))
        domain, _source = classify_entry(entry, config)
        if project and domain != "other":
            project_domains[project] = domain
    for entry in entries:
        domain, source = classify_entry(entry, config, project_domains)
        entry["domain"] = domain
        entry["domain_source"] = source
