#!/usr/bin/env python3
from __future__ import annotations
import json
from pathlib import Path
from datetime import date, datetime, timedelta
from render_date import render_today

try:
    from scripts.workbench_paths import APP_ROOT, DATA_ROOT, VAULT_ROOT
except ImportError:  # pragma: no cover
    from workbench_paths import APP_ROOT, DATA_ROOT, VAULT_ROOT

ROOT = VAULT_ROOT
DATA = DATA_ROOT
CLOSED_TASK_STATUSES = {"done", "complete", "completed", "cancelled", "canceled", "dropped", "archive", "archived"}


def load(name: str):
    p = DATA / name
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else []


def parse_date(x):
    try:
        return date.fromisoformat(str(x))
    except Exception:
        return None


def days_until(x):
    d = parse_date(x)
    return None if d is None else (d - render_today()).days


def rel(p: Path) -> str:
    return str(p.relative_to(ROOT))


def md_link(label: str, path: str) -> str:
    if not path:
        return label
    # Weekly file lives in journal/weekly, so links go two levels up.
    return f"[{label}](../../{path})"


def week_id(today: date | None = None) -> str:
    today = today or render_today()
    y, w, _ = today.isocalendar()
    return f"{y}-W{w:02d}"


def build_review(week: str | None = None, force: bool = False) -> Path:
    if not (DATA / "tasks.json").exists():
        import subprocess, sys
        subprocess.check_call([sys.executable, str(APP_ROOT / "scripts/sync_markdown.py")])
    week = week or week_id()
    out_dir = ROOT / "journal/weekly"
    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / f"{week}.md"
    if out.exists() and not force:
        return out

    tasks = [t for t in load("tasks.json") if str(t.get("status", "")).lower() not in CLOSED_TASK_STATUSES]
    projects = load("projects.json")
    events = load("events.json")
    notes = load("notes.json")

    task_by_project = {}
    for t in tasks:
        task_by_project.setdefault(t.get("project", ""), []).append(t)
    note_counts = {}
    for n in notes:
        note_counts[n.get("project", "")] = note_counts.get(n.get("project", ""), 0) + 1

    due_3 = sorted([t for t in tasks if (days_until(t.get("due")) is not None and days_until(t.get("due")) <= 3)], key=lambda t: (days_until(t.get("due")), t.get("priority", 9)))
    due_14 = sorted([t for t in tasks if (days_until(t.get("due")) is not None and days_until(t.get("due")) <= 14)], key=lambda t: (days_until(t.get("due")), t.get("priority", 9)))
    event_14 = sorted([e for e in events if (days_until(e.get("date")) is not None and days_until(e.get("date")) <= 14)], key=lambda e: days_until(e.get("date")))
    waiting = [p for p in projects if any(k in str(p.get("status", "")).lower() for k in ["waiting", "needs", "blocked", "source", "audit"])]
    active_research = [
        p
        for p in projects
        if "research" in {
            str(p.get("domain", "")).lower(),
            str(p.get("area", "")).lower(),
        }
        and str(p.get("status", "")).lower().startswith("active")
    ]
    active_research = sorted(active_research, key=lambda p: (p.get("priority", 9), p.get("deadline") or "9999-12-31"))[:6]
    admin = [
        t
        for t in tasks
        if str(t.get("domain", "")).lower() in {"admin", "personal"}
        or str(t.get("area", "")).lower() in {"admin", "travel", "wellness"}
    ]
    admin = sorted(admin, key=lambda t: (t.get("priority", 9), t.get("due") or "9999-12-31"))[:10]

    flags = []
    for p in projects:
        fs = []
        pid = p.get("id", "")
        if not p.get("next_action"):
            fs.append("missing next action")
        if not p.get("deadline") and p.get("priority", 9) <= 2:
            fs.append("priority project without deadline")
        if note_counts.get(pid, 0) == 0 and str(p.get("domain", "")).lower() == "research":
            fs.append("no notes yet")
        d = days_until(p.get("deadline"))
        if d is not None and d <= 14:
            fs.append(f"deadline in {d} days")
        if any(k in str(p.get("status", "")).lower() for k in ["needs", "waiting", "audit"]):
            fs.append(f"status: {p.get('status')}")
        if fs:
            flags.append((p, fs))

    def task_line(t):
        return f"- [ ] **{t.get('due') or 'no date'}** — {md_link(t.get('title','task'), t.get('path',''))} (`{t.get('project','')}`): {t.get('next','')}"

    def project_line(p):
        return f"- **{md_link(p.get('name','project'), p.get('path',''))}** — {p.get('next_action','')}"

    lines = [
        "---",
        "kind: weekly-review",
        f"week: {week}",
        "status: draft",
        f"generated: {datetime.now().isoformat(timespec='seconds')}",
        "---",
        f"# Weekly review — {week}",
        "",
        "> Markdown is canonical. Use this page as the review surface, then update project/task Markdown files.",
        "",
        "## 1. Executive summary",
        "",
        f"- Open tasks: **{len(tasks)}**",
        f"- Tasks due in ≤3 days: **{len(due_3)}**",
        f"- Tasks due in ≤14 days: **{len(due_14)}**",
        f"- Active research projects surfaced: **{len(active_research)}**",
        f"- Waiting/source-gap projects: **{len(waiting)}**",
        "",
        "## 2. Must not slip",
        "",
    ]
    lines += [task_line(t) for t in due_3[:12]] or ["- None detected."]
    lines += ["", "## 3. This-week deadlines and events", ""]
    lines += [task_line(t) for t in due_14[:20]] or ["- No dated tasks within 14 days."]
    lines += ["", "### Calendar/date markers", ""]
    lines += [f"- **{e.get('date')}** — {md_link(e.get('title','event'), e.get('path',''))} (`{e.get('project','')}`)" for e in event_14[:20]] or ["- No dated events within 14 days."]
    lines += ["", "## 4. Recommended deep-work blocks", ""]
    lines += [project_line(p) for p in active_research] or ["- No active research projects detected."]
    lines += ["", "## 5. Administration / personal sprint", ""]
    lines += [task_line(t) for t in admin[:12]] or ["- No administration or personal tasks detected."]
    lines += ["", "## 6. Waiting on / source gaps", ""]
    lines += [f"- **{md_link(p.get('name','project'), p.get('path',''))}** — status `{p.get('status')}` — next: {p.get('next_action','')}" for p in waiting] or ["- No waiting/source-gap projects detected."]
    lines += ["", "## 7. Project hygiene flags", ""]
    if flags:
        for p, fs in flags[:20]:
            lines.append(f"- **{md_link(p.get('name','project'), p.get('path',''))}**: {', '.join(fs)}")
    else:
        lines.append("- No project hygiene flags detected.")
    lines += [
        "",
        "## 8. Wins / shipped this week",
        "",
        "- ",
        "",
        "## 9. Decisions made",
        "",
        "- ",
        "",
        "## 10. Notes to create or clean up",
        "",
        "- ",
        "",
        "## 11. Wellness check-in",
        "",
        "- Sleep:",
        "- Exercise:",
        "- Diet:",
        "- Recovery / appointments:",
        "- Next experiment:",
        "",
        "## 12. Next week plan",
        "",
        "### Top 3 outcomes",
        "",
        "1. ",
        "2. ",
        "3. ",
        "",
        "### First three actions on Monday",
        "",
        "1. ",
        "2. ",
        "3. ",
        "",
        "## 13. Agent prompt",
        "",
        "```text",
        "Read this weekly review plus data/tasks.json, data/projects.json, and data/notes.json. Update project Markdown files only. Do not invent completions. Produce a 5-day plan with one deep-work block per day and a short admin sprint.",
        "```",
        "",
    ]
    out.write_text("\n".join(lines), encoding="utf-8")
    return out


if __name__ == "__main__":
    p = build_review(force=True)
    print(p)
