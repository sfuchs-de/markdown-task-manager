"""Deterministic, metadata-driven static views for a Research Workbench vault."""
from __future__ import annotations

import html
import hashlib
import json
import os
import re
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

try:
    from scripts.workbench_paths import DASHBOARD_ROOT, DATA_ROOT
except ImportError:  # pragma: no cover - direct script invocation
    from workbench_paths import DASHBOARD_ROOT, DATA_ROOT


CSS = """
:root{color-scheme:light dark;--bg:#f5f6f5;--panel:#fff;--ink:#202622;--muted:#68716c;--line:#d9ded9;--accent:#245a64}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.5 system-ui,sans-serif}
main{max-width:1180px;margin:auto;padding:24px}a{color:var(--accent)}nav{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px}
nav a,.pill{border:1px solid var(--line);border-radius:6px;background:var(--panel);padding:6px 9px;text-decoration:none}
.hero,.card{border:1px solid var(--line);border-radius:8px;background:var(--panel);padding:16px}.hero{margin-bottom:16px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px}.stack{display:grid;gap:8px}
.item{border-top:1px solid var(--line);padding:9px 0}.item:first-child{border-top:0}.muted{color:var(--muted)}
.meta{display:flex;gap:7px;flex-wrap:wrap;color:var(--muted);font-size:12px}.private{border-left:3px solid #a66;padding-left:9px}
table{width:100%;border-collapse:collapse;background:var(--panel)}th,td{text-align:left;padding:8px;border-bottom:1px solid var(--line)}
@media(prefers-color-scheme:dark){:root{--bg:#151816;--panel:#1d221f;--ink:#eef2ef;--muted:#aab4ae;--line:#39423d;--accent:#8ac4cf}}
"""

CLOSED = {"done", "complete", "completed", "cancelled", "canceled", "dropped", "archived", "archive"}


def esc(value: Any) -> str:
    return html.escape(str(value if value is not None else ""))


def slug(value: Any) -> str:
    return re.sub(r"[^a-z0-9]+", "-", str(value or "").lower()).strip("-") or "item"


def load(name: str) -> list[dict[str, Any]]:
    path = DATA_ROOT / name
    if not path.exists():
        return []
    parsed = json.loads(path.read_text(encoding="utf-8"))
    return parsed if isinstance(parsed, list) else []


def visible(items: list[dict[str, Any]], include_private: bool) -> list[dict[str, Any]]:
    return items if include_private else [item for item in items if not bool(item.get("private"))]


def navigation(name: str) -> str:
    prefix = "../" * (len(Path(name).parts) - 1)
    return (
        f'<nav><a href="{prefix}index.html">Overview</a><a href="{prefix}today.html">Today</a>'
        f'<a href="{prefix}calendar.html">Calendar</a><a href="{prefix}boards.html">Boards</a>'
        f'<a href="{prefix}status.html">Projects</a><a href="{prefix}graph.html">Graph</a>'
        f'<a href="{prefix}public.html">Public-safe</a></nav>'
    )


def write_page(name: str, title: str, body: str, *, private_warning: bool = True) -> None:
    DASHBOARD_ROOT.mkdir(parents=True, exist_ok=True)
    destination = DASHBOARD_ROOT / name
    destination.parent.mkdir(parents=True, exist_ok=True)
    warning = (
        '<p class="muted"><strong>Privacy:</strong> “private” is a display filter, not encryption.</p>'
        if private_warning else ""
    )
    stamp = os.environ.get("PM_RENDER_TIMESTAMP", "deterministic build")
    document = (
        '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
        f"<title>{esc(title)} · Research Workbench</title><style>{CSS}</style></head><body><main>{navigation(name)}"
        f'<section class="hero"><h1>{esc(title)}</h1>{warning}<p class="muted">Generated: {esc(stamp)}</p></section>'
        f"{body}</main></body></html>\n"
    )
    destination.write_text(document, encoding="utf-8")


def item_html(item: dict[str, Any]) -> str:
    private_class = " private" if item.get("private") else ""
    date = item.get("due") or item.get("date") or item.get("deadline") or ""
    return (
        f'<article class="item{private_class}"><strong>{esc(item.get("title") or item.get("name") or item.get("id"))}</strong>'
        f'<div class="meta"><span>{esc(item.get("kind") or item.get("type") or "entry")}</span>'
        f'<span>{esc(item.get("project") or item.get("domain") or "other")}</span>'
        f'<span>{esc(item.get("status") or "")}</span><span>{esc(date)}</span>'
        f'<span>{esc(item.get("path") or "")}</span></div></article>'
    )


def render_overview(projects: list[dict[str, Any]], tasks: list[dict[str, Any]], events: list[dict[str, Any]], notes: list[dict[str, Any]]) -> None:
    open_tasks = [task for task in tasks if str(task.get("status") or "").lower() not in CLOSED]
    domains = Counter(str(item.get("domain") or item.get("area") or "other") for item in projects + tasks + notes)
    body = (
        '<section class="grid">'
        f'<div class="card"><strong>{len(projects)}</strong><p>Projects</p></div>'
        f'<div class="card"><strong>{len(open_tasks)}</strong><p>Open tasks</p></div>'
        f'<div class="card"><strong>{len(events)}</strong><p>Dated events</p></div>'
        f'<div class="card"><strong>{len(notes)}</strong><p>Notes</p></div></section>'
        '<h2>Domains</h2><section class="grid">'
        + "".join(f'<div class="card"><strong>{esc(label)}</strong><p>{count} entries</p></div>' for label, count in sorted(domains.items()))
        + '</section><h2>Open task queue</h2><section class="card stack">'
        + "".join(item_html(item) for item in open_tasks[:30])
        + ("<p class=\"muted\">No open tasks.</p>" if not open_tasks else "")
        + "</section>"
    )
    write_page("index.html", "Research Workbench", body)


def render_today(tasks: list[dict[str, Any]], events: list[dict[str, Any]]) -> None:
    current = [item for item in tasks if str(item.get("status") or "").lower() not in CLOSED]
    current.sort(key=lambda item: (int(item.get("priority") or 99), str(item.get("due") or "9999-12-31")))
    dated = sorted(events, key=lambda item: str(item.get("date") or "9999-12-31"))
    body = '<div class="grid"><section class="card"><h2>Focus</h2>' + "".join(item_html(item) for item in current[:10])
    body += '</section><section class="card"><h2>Upcoming</h2>' + "".join(item_html(item) for item in dated[:10]) + "</section></div>"
    write_page("today.html", "Today", body)


def render_calendar(tasks: list[dict[str, Any]], events: list[dict[str, Any]]) -> None:
    rows = [item for item in tasks + events if item.get("due") or item.get("date") or item.get("start_date")]
    rows.sort(key=lambda item: str(item.get("due") or item.get("date") or item.get("start_date")))
    body = '<section class="card"><table><thead><tr><th>Date</th><th>Item</th><th>Kind</th><th>Project</th></tr></thead><tbody>'
    for item in rows:
        body += (
            f'<tr><td>{esc(item.get("due") or item.get("date") or item.get("start_date"))}</td>'
            f'<td>{esc(item.get("title"))}</td><td>{esc(item.get("kind") or item.get("type"))}</td>'
            f'<td>{esc(item.get("project"))}</td></tr>'
        )
    body += "</tbody></table></section>"
    write_page("calendar.html", "Calendar", body)


def render_boards(tasks: list[dict[str, Any]]) -> None:
    lanes: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for task in tasks:
        status = str(task.get("status") or "open").lower()
        lane = "done" if status in CLOSED else "waiting" if status in {"waiting", "blocked"} else "active"
        lanes[lane].append(task)
    body = '<section class="grid">'
    for lane in ("active", "waiting", "done"):
        body += f'<div class="card"><h2>{lane.title()}</h2>' + "".join(item_html(item) for item in lanes[lane]) + "</div>"
    body += "</section>"
    write_page("boards.html", "Boards", body)


def render_projects(projects: list[dict[str, Any]], tasks: list[dict[str, Any]]) -> None:
    project_dir = DASHBOARD_ROOT / "projects"
    project_dir.mkdir(parents=True, exist_ok=True)
    cards: list[str] = []
    for project in projects:
        project_id = str(project.get("id") or project.get("project") or slug(project.get("name")))
        related = [task for task in tasks if str(task.get("project") or "") == project_id]
        cards.append(
            f'<article class="card"><h2><a href="projects/{slug(project_id)}.html">{esc(project.get("name") or project_id)}</a></h2>'
            f'<p>{esc(project.get("next_action") or "")}</p><span class="pill">{len(related)} tasks</span></article>'
        )
        detail = '<section class="card"><h2>Project metadata</h2>' + item_html(project) + '</section><h2>Tasks</h2><section class="card">'
        detail += "".join(item_html(item) for item in related) or '<p class="muted">No linked tasks.</p>'
        detail += "</section>"
        write_page(f"projects/{slug(project_id)}.html", str(project.get("name") or project_id), detail)
    write_page("status.html", "Projects", '<section class="grid">' + "".join(cards) + "</section>")


def render_collaborators(notes: list[dict[str, Any]], tasks: list[dict[str, Any]]) -> None:
    safe_notes = visible(notes, False)
    safe_tasks = visible(tasks, False)
    people = [
        note
        for note in safe_notes
        if str(note.get("kind") or "").lower() == "collaborator-status"
    ]
    cards: list[str] = []
    for person in people:
        name = str(person.get("assignee") or person.get("title") or person.get("id") or "Collaborator")
        person_slug = slug(person.get("id") or name)
        related_notes = [
            note
            for note in safe_notes
            if str(note.get("assignee") or "").casefold() == name.casefold()
        ]
        related_tasks = [
            task
            for task in safe_tasks
            if str(task.get("assignee") or "").casefold() == name.casefold()
        ]
        cards.append(
            f'<article class="card"><h2><a href="{person_slug}.html">{esc(name)}</a></h2>'
            f'<p>{len(related_tasks)} tasks · {len(related_notes)} notes</p></article>'
        )
        body = '<section class="card"><h2>Tasks</h2>'
        body += "".join(item_html(item) for item in related_tasks) or '<p class="muted">No linked tasks.</p>'
        body += '</section><h2>Notes</h2><section class="card">'
        body += "".join(item_html(item) for item in related_notes) or '<p class="muted">No linked notes.</p>'
        body += "</section>"
        write_page(f"collaborators/{person_slug}.html", name, body)
    empty = '<p class="muted">No public-safe collaborator status notes.</p>' if not cards else ""
    write_page("collaborators/index.html", "Collaborators", '<section class="grid">' + "".join(cards) + empty + "</section>")


def render_graph(projects: list[dict[str, Any]], tasks: list[dict[str, Any]], notes: list[dict[str, Any]]) -> None:
    lines = ["graph TD"]
    for project in projects:
        project_id = str(project.get("id") or project.get("project") or slug(project.get("name")))
        project_node = f"p_{slug(project_id).replace('-', '_')}"
        lines.append(f'  {project_node}["{str(project.get("name") or project_id).replace(chr(34), chr(39))}"]')
        for item in tasks + notes:
            if str(item.get("project") or "") != project_id:
                continue
            digest = hashlib.sha256(str(item.get("path") or "").encode("utf-8")).hexdigest()[:12]
            item_node = f"n_{digest}"
            lines.append(f'  {project_node} --> {item_node}["{str(item.get("title") or item.get("path")).replace(chr(34), chr(39))}"]')
    body = '<section class="card"><p>Mermaid source for the project-to-entry graph.</p><pre>' + esc("\n".join(lines)) + "</pre></section>"
    write_page("graph.html", "Graph", body)


def render_public(projects: list[dict[str, Any]], tasks: list[dict[str, Any]], events: list[dict[str, Any]], notes: list[dict[str, Any]]) -> None:
    safe_projects = visible(projects, False)
    safe_tasks = visible(tasks, False)
    safe_events = visible(events, False)
    safe_notes = visible(notes, False)
    body = (
        '<section class="card"><p>This export includes only entries without <code>private: true</code>. '
        'That field is a display filter, not encryption; review before sharing.</p></section>'
        '<h2>Projects</h2><section class="grid">' + "".join(item_html(item) for item in safe_projects)
        + '</section><h2>Tasks and dates</h2><section class="card">'
        + "".join(item_html(item) for item in safe_tasks + safe_events)
        + '</section><h2>Notes</h2><section class="card">'
        + "".join(item_html(item) for item in safe_notes)
        + "</section>"
    )
    write_page("public.html", "Public-safe display", body, private_warning=False)


def render_all() -> None:
    projects = load("projects.json")
    tasks = load("tasks.json")
    events = load("events.json")
    notes = load("notes.json")
    render_overview(projects, tasks, events, notes)
    render_today(tasks, events)
    render_calendar(tasks, events)
    render_boards(tasks)
    render_projects(projects, tasks)
    render_collaborators(notes, tasks)
    render_graph(projects, tasks, notes)
    render_public(projects, tasks, events, notes)
    print(f"Rendered static views to {DASHBOARD_ROOT}")


if __name__ == "__main__":
    render_all()
