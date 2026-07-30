#!/usr/bin/env python3
from __future__ import annotations
import argparse, json, os, shutil, subprocess, sys, re, time
from pathlib import Path
from datetime import date, datetime, timedelta

try:
    from scripts.workbench_config import load_workbench_config
    from scripts.workbench_paths import APP_ROOT, DATA_ROOT, EXAMPLE_VAULT_ROOT, TEMPLATE_ROOT, VAULT_ROOT
except ImportError:  # pragma: no cover - direct script invocation
    from workbench_config import load_workbench_config
    from workbench_paths import APP_ROOT, DATA_ROOT, EXAMPLE_VAULT_ROOT, TEMPLATE_ROOT, VAULT_ROOT

ROOT=VAULT_ROOT
DATA=DATA_ROOT
PERF_LOGS_ENABLED=os.environ.get("PM_PERF_LOGS","").lower() in {"1","true","yes","on"}
CLOSED_TASK_STATUSES={"done","complete","completed","cancelled","canceled","dropped","archive","archived"}
NOTE_TYPES={
    "meeting":("academic/meeting_note.md","meetings"),
    "feedback":("academic/feedback_note.md","feedback"),
    "model":("academic/model_note.md","modeling"),
    "derivation":("academic/derivation_note.md","modeling"),
    "data":("academic/data_note.md","data"),
    "code":("academic/code_run_log.md","code-runs"),
    "result":("academic/result_note.md","empirics"),
    "literature":("academic/literature_note.md","notes/literature"),
    "presentation":("academic/presentation_plan.md","presentations"),
    "revision":("academic/revision_matrix.md","revisions"),
    "section":("academic/section_draft_note.md","writing"),
    "idea":("academic/idea_note.md","notes/ideas"),
    "coauthor":("academic/coauthor_update.md","notes/procedural"),
    "procedural":("academic/coauthor_update.md","notes/procedural"),
    "technical-issue":("academic/technical_issue.md","notes/technical"),
}

def perf_log(event, **fields):
    if PERF_LOGS_ENABLED:
        print("[perf] "+event+" "+" ".join(f"{k}={v}" for k,v in fields.items()), file=sys.stderr)

def timed_check_call(label, argv):
    started=time.perf_counter()
    subprocess.check_call(argv)
    perf_log(label, elapsed_ms=round((time.perf_counter()-started)*1000,2))

def sync_markdown(): timed_check_call("pm.sync_markdown", [sys.executable, str(APP_ROOT/"scripts/sync_markdown.py")])
def load(n):
    p=DATA/n
    if not p.exists(): sync_markdown()
    return json.loads(p.read_text(encoding="utf-8"))
def days_until(d):
    try: return (date.fromisoformat(str(d))-date.today()).days
    except Exception: return None
def is_open_task(t):
    return str(t.get("status","")).lower() not in CLOSED_TASK_STATUSES
def slugify(s): return re.sub(r"[^a-z0-9]+","-",s.lower()).strip("-")[:80] or "note"
def project_dir(project):
    for base in [ROOT/"projects",ROOT/"areas"]:
        d=base/project
        if d.exists(): return d
    print(f"No such project/area: {project}", file=sys.stderr); sys.exit(1)
def tmpl(src,dst,mapping,force=False):
    if dst.exists() and not force: print(f"Exists: {dst}"); return dst
    s=src.read_text(encoding="utf-8")
    for k,v in mapping.items(): s=s.replace("{{"+k+"}}",str(v))
    dst.parent.mkdir(parents=True,exist_ok=True); dst.write_text(s,encoding="utf-8"); print(f"Created {dst}"); return dst

def status(args):
    if not args.no_sync: sync_markdown()
    print("\nPROJECT STATUS\n"+"="*14)
    for p in sorted(load("projects.json"), key=lambda p:(p.get("priority",9),p.get("deadline") or "9999",p.get("name",""))):
        due=p.get("deadline",""); delta=days_until(due) if due else None
        print(f"[{p.get('priority')}] {p['name']} — {p['status']}"+(f" due {due}"+(f" ({delta:+d}d)" if delta is not None else "") if due else ""))
        print(f"    next: {p.get('next_action','')}")
        print(f"    file: {p.get('path','')}")

def today(args):
    if not args.no_sync: sync_markdown()
    open_tasks=[t for t in load("tasks.json") if is_open_task(t)]
    print("\nTODAY / NEAR-TERM\n"+"="*18)
    for t in sorted(open_tasks,key=lambda t:(t.get("priority",9),t.get("due") or "9999-12-31"))[:15]:
        due=t.get("due",""); delta=days_until(due) if due else None; warn=""
        if delta is not None: warn=" OVERDUE" if delta<0 else (" URGENT" if delta<=3 else "")
        print(f"- [{t.get('priority')}] {t['title']} ({t['project']}) due {due}{warn}")
        print(f"  next: {t.get('next','')}")
        print(f"  file: {t.get('path','')}")

def focus(args):
    if not args.no_sync: sync_markdown()
    tasks=[t for t in load("tasks.json") if is_open_task(t)]
    projects=load("projects.json")
    urgent=[t for t in tasks if (days_until(t.get("due")) is not None and days_until(t.get("due"))<=3)]
    top=sorted(urgent,key=lambda t:(t.get("priority",9), days_until(t.get("due"))))[:5]
    if len(top)<5:
        extra=[t for t in tasks if t not in top]
        top += sorted(extra,key=lambda t:(t.get("priority",9),t.get("due") or "9999"))[:5-len(top)]
    research=[p for p in projects if str(p.get("domain") or p.get("area") or "").lower() == "research" and str(p.get("status","")).lower().startswith("active")]
    research=sorted(research,key=lambda p:(p.get("priority",9),p.get("deadline") or "9999"))
    waiting=[p for p in projects if any(k in str(p.get("status","")).lower() for k in ["waiting","needs","audit","source"])]
    print("\nFOCUS VIEW\n"+"="*10)
    print("\nTop actions")
    for i,t in enumerate(top,1):
        print(f"{i}. {t.get('title')} — due {t.get('due') or 'no date'} — {t.get('project')}")
        print(f"   next: {t.get('next','')}")
    print("\nSuggested deep-work block")
    if research:
        p=research[0]
        print(f"- {p.get('name')} — {p.get('next_action')}")
        print(f"  file: {p.get('path')}")
    else:
        print("- No active research project detected.")
    print("\nWaiting / source gaps")
    for p in waiting[:8]:
        print(f"- {p.get('name')} [{p.get('status')}] — {p.get('next_action')}")

def render(args):
    if not args.no_sync: sync_markdown()
    timed_check_call("pm.render.static", [sys.executable, str(APP_ROOT/"scripts/render_static.py")])
    print(f"Rendered deterministic static views to {DATA.parent / 'dashboard'}.")

def weekly_review(args):
    if not args.no_sync: sync_markdown()
    sys.path.insert(0, str(APP_ROOT/"scripts"))
    from generate_weekly_review import build_review
    out=build_review(args.week, force=args.force)
    sync_markdown()
    if args.render:
        subprocess.check_call([sys.executable, str(APP_ROOT/"scripts/render_static.py")])
    print(f"Weekly review: {out}")

def export_codex(args):
    if not args.no_sync: sync_markdown()
    ps=load("projects.json"); ts=[t for t in load("tasks.json") if is_open_task(t)]; ns=load("notes.json") if (DATA/"notes.json").exists() else []
    lines=["# Agent context packet","",f"Generated: {datetime.now().isoformat(timespec='seconds')}","","Markdown is canonical. JSON in data/ is generated cache. Exclude confidential source material and raw private imports.","","## Active projects"]
    for p in sorted(ps,key=lambda p:(p.get("priority",9),p.get("name",""))): lines += [f"### {p['name']}",f"- ID: {p.get('id')}",f"- Status: {p.get('status')}",f"- Priority: {p.get('priority')}",f"- Deadline: {p.get('deadline') or ''}".rstrip(),f"- Next: {p.get('next_action')}",f"- File: {p.get('path')}",""]
    lines.append("## Open tasks")
    for t in sorted(ts,key=lambda t:(t.get("priority",9),t.get("due") or "9999")): lines.append(f"- [{t.get('priority')}] {t['title']} — {t['project']} — due {t.get('due')} — {t.get('next')} — file: {t.get('path')}")
    lines += ["","## Recent notes"]
    for n in ns[:30]: lines.append(f"- {n.get('date')} [{n.get('kind')}] {n.get('title')} — {n.get('project')} — file: {n.get('path')}")
    out=ROOT/"codex/CONTEXT_PACKET.md"; out.write_text("\n".join(lines)+"\n",encoding="utf-8"); print(f"Wrote {out}")

def log(args):
    d=project_dir(args.project); f=d/"progress.md"
    f.write_text((f.read_text(encoding="utf-8") if f.exists() else "")+f"\n## {date.today().isoformat()}\n\n{args.message}\n",encoding="utf-8"); print(f"Logged to {f}")

def capture(args):
    now=datetime.now()
    title=args.title or args.text[:60]
    slug=slugify(title)
    out=ROOT/"_inbox"/f"{now.strftime('%Y-%m-%d-%H%M')}-{slug}.md"
    body=[
        "---",
        "kind: inbox-note",
        f"title: \"{title.replace(chr(34), chr(39))}\"",
        f"date: {now.date().isoformat()}",
        f"status: uncategorized",
        f"project: {args.project or ''}",
        f"source: {args.source or 'manual'}",
        "---",
        "",
        f"# {title}",
        "",
        args.text,
        "",
        "## Triage",
        "",
        "- Project/area:",
        "- Is this a task, note, source, or decision?",
        "- Next action:",
        "- File to move/link to:",
        "",
    ]
    out.write_text("\n".join(body),encoding="utf-8")
    print(f"Captured {out}")

def new_daily(args): tmpl(TEMPLATE_ROOT/"daily_note.md",ROOT/"journal/daily"/f"{args.date or date.today().isoformat()}.md",{"date":args.date or date.today().isoformat()},args.force)
def new_health(args): tmpl(TEMPLATE_ROOT/"health/daily_health_log.md",ROOT/"areas/wellness/daily"/f"{args.date or date.today().isoformat()}.md",{"date":args.date or date.today().isoformat()},args.force)
def new_note(args):
    d=project_dir(args.project); when=args.date or date.today().isoformat(); slug=slugify(args.title)
    template,subdir=NOTE_TYPES[args.type]
    tmpl(TEMPLATE_ROOT/template,d/subdir/f"{when}-{slug}.md",{"date":when,"project":args.project,"title":args.title,"slug":slug},args.force)
def list_notes(args):
    if not args.no_sync: sync_markdown()
    ns=load("notes.json")
    if args.project: ns=[n for n in ns if n.get("project")==args.project]
    if args.kind: ns=[n for n in ns if n.get("kind")==args.kind or n.get("kind")==args.kind+"-note"]
    print("\nNOTES\n"+"="*5)
    for n in ns[:args.limit]:
        print(f"- {n.get('date','')} [{n.get('kind')}] {n.get('title')} — {n.get('project')}")
        print(f"  file: {n.get('path')}")
def sync_cmd(args): sync_markdown()


def vault_context_cmd(args):
    sys.path.insert(0, str(APP_ROOT/"scripts"))
    import markdown_reader
    entries = markdown_reader.scan_vault(include_private=args.include_private)
    types = sorted({e.get("type") or e.get("kind") for e in entries if e.get("type") or e.get("kind")})
    folders = sorted({str(e.get("path","")).split("/",1)[0] + "/" for e in entries if "/" in str(e.get("path",""))})
    recent = [{"path": e.get("path"), "title": e.get("title"), "type": e.get("type") or e.get("kind")} for e in entries[:20]]
    print(json.dumps({"types": types, "noteCount": len(entries), "folders": folders, "recentNotes": recent, "vaultPath": str(ROOT)}, indent=2, ensure_ascii=False))

def get_note_cmd(args):
    sys.path.insert(0, str(APP_ROOT/"scripts"))
    import markdown_reader
    p = (ROOT / args.path).resolve()
    try:
        p.relative_to(ROOT.resolve())
    except Exception:
        raise SystemExit("Note path must stay inside the active vault")
    raw = p.read_text(encoding="utf-8", errors="replace")
    fm, body = markdown_reader.split_frontmatter(raw)
    print(json.dumps({"path": str(p.relative_to(ROOT)), "frontmatter": markdown_reader.json_safe(fm), "content": body.strip()}, indent=2, ensure_ascii=False))

def search_notes_cmd(args):
    sys.path.insert(0, str(APP_ROOT/"scripts"))
    import markdown_reader
    q = args.query.lower()
    results = []
    for e in markdown_reader.scan_vault(include_private=args.include_private):
        hay = " ".join(str(e.get(k) or "") for k in ["title", "path", "type", "kind", "snippet", "project", "status"]).lower()
        if q not in hay:
            # Fall back to body search only until limit is met.
            try:
                raw = (ROOT / e.get("path", "")).read_text(encoding="utf-8", errors="replace")
                if q not in raw.lower():
                    continue
            except Exception:
                continue
        results.append({"path": e.get("path"), "title": e.get("title"), "type": e.get("type") or e.get("kind"), "project": e.get("project"), "snippet": e.get("snippet")})
        if len(results) >= args.limit:
            break
    print(json.dumps(results, indent=2, ensure_ascii=False))


def scan_vault_cmd(args):
    sys.path.insert(0, str(APP_ROOT/"scripts"))
    import markdown_reader
    entries = markdown_reader.scan_vault(include_private=args.include_private)
    markdown_reader.write_cache(include_private=args.include_private)
    print(f"Scanned {len(entries)} Markdown entries.")
    print("Wrote data/vault_entries.json and data/relationships.json")
    by_type = {}
    for e in entries:
        k = e.get("type") or e.get("kind") or "untyped"
        by_type[k] = by_type.get(k, 0) + 1
    for k, v in sorted(by_type.items(), key=lambda kv: (-kv[1], kv[0]))[:12]:
        print(f"- {k}: {v}")

def preview_cmd(args):
    sys.path.insert(0, str(APP_ROOT/"scripts"))
    import markdown_reader
    print(markdown_reader.markdown_preview(args.path, args.limit))

def graph_cmd(args):
    if not args.no_sync:
        sync_markdown()
    subprocess.check_call([sys.executable, str(APP_ROOT/"scripts/render_static.py")])
    print(f"Graph view: {DATA.parent / 'dashboard/graph.html'}")



def calendar_cmd(args):
    if not args.no_sync:
        sync_markdown()
    subprocess.check_call([sys.executable, str(APP_ROOT/"scripts/render_calendar.py")])
    print(f"Calendar view: {DATA.parent / 'dashboard/calendar.html'}")



def plan_cmd(args):
    if not args.no_sync: sync_markdown()
    from time_blocks import allocate_daily_plan, allocate_weekly_plan, parse_date, task_reason
    from calendar_feed import load_calendar_events_by_day
    from time_plan_context import read_time_planning_settings

    target_day = parse_date(args.date) if args.date else date.today()
    if target_day is None:
        print(f"Invalid --date: {args.date}", file=sys.stderr)
        sys.exit(2)
    week_start = parse_date(args.week) if args.week and len(args.week) == 10 else target_day
    if week_start is None:
        print(f"Invalid --week date: {args.week}", file=sys.stderr)
        sys.exit(2)
    week_prefix = args.week if args.week and len(args.week) < 10 else target_day.isoformat()[:8]
    tasks=load("tasks.json")
    no_work_before = parse_date(read_time_planning_settings(ROOT).get("no_work_before"))
    calendar_end = max(target_day + timedelta(days=1), week_start + timedelta(days=args.weekdays + 14))
    calendar_import = load_calendar_events_by_day(ROOT, min(target_day, week_start), calendar_end)
    calendar_events_by_day = calendar_import["events_by_day"]

    daily, daily_overflow = allocate_daily_plan(
        tasks,
        target_day,
        start=args.start,
        capacity_minutes=args.capacity_minutes,
        horizon_days=args.horizon_days,
        week_prefix=week_prefix,
        no_work_before=no_work_before,
        calendar_events=calendar_events_by_day.get(target_day, []),
    )

    print("\nDAILY TIME BLOCK PLAN\n"+"="*22)
    print(f"Date: {target_day.isoformat()}")
    if no_work_before and target_day < no_work_before:
        print(f"Availability: no work blocks before {no_work_before.isoformat()}.")
    print(f"Automatic allocation: open tasks ranked by overdue/today/due-soon/P1/P2.")
    if calendar_import["status"].get("enabled"):
        print(
            "Calendar: "
            f"{calendar_import['status'].get('event_count', 0)} work event(s) from "
            f"{', '.join(calendar_import['status'].get('source_labels') or []) or 'configured feed'}."
        )
        for error in calendar_import["status"].get("errors") or []:
            print(f"Calendar warning: {error}")
    if not daily:
        print("- No urgent or high-priority tasks fit the workday capacity.")
    total=0
    for item in daily:
        t=item.task
        total += item.minutes
        if t.get("kind") == "calendar":
            print(f"- {item.start}-{item.end} | calendar | {t.get('title')} ({t.get('source_label') or t.get('project')})")
            print(f"  blocks: {'yes' if t.get('blocking') else 'no'} | {item.minutes}m")
        else:
            print(f"- {item.start}-{item.end} | {item.reason} | P{t.get('priority')} | {t.get('title')} ({t.get('project')})")
            print(f"  est: {item.minutes}m | due: {t.get('due') or 'no date'} | next: {t.get('next','')}")
            print(f"  file: {t.get('path')}")
    print(f"Total scheduled: {total} minutes ({total/60:.1f}h)")
    if daily_overflow:
        print(f"Overflow not scheduled today: {len(daily_overflow)} task(s).")
        for t in daily_overflow[:8]:
            print(f"  - {task_reason(t, target_day, week_prefix)} | P{t.get('priority')} {t.get('title')} due {t.get('due') or 'no date'} [{t.get('project')}]")

    weekly, weekly_overflow = allocate_weekly_plan(
        tasks,
        week_start,
        start=args.start,
        capacity_minutes=args.capacity_minutes,
        weekdays=args.weekdays,
        horizon_days=args.horizon_days,
        week_prefix=week_prefix,
        no_work_before=no_work_before,
        calendar_events_by_day=calendar_events_by_day,
    )

    print("\nWEEKLY TIME BLOCK PLAN\n"+"="*23)
    print(f"Start day: {week_start.isoformat()} | workdays: {args.weekdays} | capacity/day: {args.capacity_minutes}m")
    if no_work_before and week_start < no_work_before:
        print(f"Availability: weekly allocation starts no earlier than {no_work_before.isoformat()}.")
    print(f"Manual week tag still respected when block_week: {week_prefix}")
    for day, items in weekly.items():
        day_total=sum(item.minutes for item in items)
        print(f"\n{day.isoformat()} - {day_total}m ({day_total/60:.1f}h)")
        if not items:
            print("  - No urgent/high-priority allocation.")
            continue
        for item in items:
            t=item.task
            if t.get("kind") == "calendar":
                print(f"  - {item.start}-{item.end} | calendar | {t.get('title')} [{t.get('source_label') or t.get('project')}] ({item.minutes}m)")
            else:
                print(f"  - {item.start}-{item.end} | {item.reason} | P{t.get('priority')} {t.get('title')} [{t.get('project')}] ({item.minutes}m)")
    if weekly_overflow:
        print(f"\nWeekly overflow after allocation: {len(weekly_overflow)} task(s).")
        for t in weekly_overflow[:12]:
            print(f"  - {task_reason(t, week_start, week_prefix)} | P{t.get('priority')} {t.get('title')} due {t.get('due') or 'no date'} [{t.get('project')}]")

def ai_plan_context_cmd(args):
    if not args.no_sync:
        sync_markdown()
    from time_blocks import parse_clock, parse_date
    from calendar_feed import load_calendar_events_by_day
    from time_plan_context import build_agent_plan_context

    target_day = parse_date(args.date) if args.date else date.today()
    if target_day is None:
        print(f"Invalid --date: {args.date}", file=sys.stderr)
        sys.exit(2)
    week_start = parse_date(args.week) if args.week and len(args.week) == 10 else target_day
    if week_start is None:
        print(f"Invalid --week date: {args.week}", file=sys.stderr)
        sys.exit(2)
    try:
        parse_clock(args.start)
    except Exception:
        print(f"Invalid --start: {args.start}; expected HH:MM", file=sys.stderr)
        sys.exit(2)

    week_prefix = args.week if args.week and len(args.week) < 10 else week_start.isoformat()[:8]
    calendar_end = max(target_day + timedelta(days=1), week_start + timedelta(days=args.weekdays + 14))
    calendar_import = load_calendar_events_by_day(ROOT, min(target_day, week_start), calendar_end)
    context = build_agent_plan_context(
        root=ROOT,
        tasks=load("tasks.json"),
        projects=load("projects.json"),
        target_day=target_day,
        week_start_day=week_start,
        start=args.start,
        capacity_minutes=args.capacity_minutes,
        weekdays=args.weekdays,
        horizon_days=args.horizon_days,
        week_prefix=week_prefix,
        ad_hoc=args.ad_hoc or "",
        include_private=args.include_private,
        calendar_events_by_day=calendar_import["events_by_day"],
        calendar_status=calendar_import["status"],
    )
    print(context["agent_prompt"])

def boards_cmd(args):
    if not args.no_sync:
        sync_markdown()
    subprocess.check_call([sys.executable, str(APP_ROOT/"scripts/render_boards.py")])
    print(f"Board views: {DATA.parent / 'dashboard/boards.html'}")

def deadline_audit_cmd(args):
    if not args.no_sync:
        sync_markdown()
    tasks = [t for t in load("tasks.json") if is_open_task(t)]
    dated = [t for t in tasks if t.get("due") or t.get("date") or t.get("start_date")]
    missing = [t for t in dated if not str(t.get("deadline_type") or "").strip()]
    hard = [t for t in dated if str(t.get("deadline_type") or "").lower() == "hard"]
    soft = [t for t in dated if str(t.get("deadline_type") or "").lower() == "soft"]
    print("\nDEADLINE AUDIT\n"+"="*14)
    print(f"Dated open/waiting tasks: {len(dated)}")
    print(f"- hard: {len(hard)}")
    print(f"- soft: {len(soft)}")
    print(f"- missing hard/soft: {len(missing)}")
    if missing:
        print("\nMissing deadline_type")
        for task in sorted(missing, key=lambda t: (t.get("priority", 9), t.get("due") or t.get("date") or t.get("start_date") or "9999")):
            print(f"- [P{task.get('priority')}] {task.get('title')} due {task.get('due') or task.get('date') or task.get('start_date')} :: {task.get('path')}")

def qa_cmd(args):
    sync_markdown()
    timed_check_call("pm.validate_schema", [sys.executable, str(APP_ROOT/"scripts/validate_vault_schema.py"), "--root", str(ROOT)])
    timed_check_call("pm.privacy_scan", [sys.executable, str(APP_ROOT/"scripts/privacy_scan.py"), "--root", str(ROOT), "--all-files"])
    render(type("Args", (), {"no_sync": True})())
    print("QA: schema, privacy, synchronization, and static rendering completed.")


def init_cmd(args):
    target = Path(args.vault).expanduser().resolve()
    if target.exists():
        existing = [path for path in target.iterdir() if path.name != ".gitkeep"]
        if existing:
            raise SystemExit(f"Refusing to overwrite non-empty directory: {target}")
    target.mkdir(parents=True, exist_ok=True)
    shutil.copytree(EXAMPLE_VAULT_ROOT, target, dirs_exist_ok=True)
    today_value = date.fromisoformat(args.today) if args.today else date.today()
    replacements = {
        "{{TODAY}}": today_value.isoformat(),
        "{{TODAY_PLUS_7}}": (today_value + timedelta(days=7)).isoformat(),
        "{{TODAY_PLUS_14}}": (today_value + timedelta(days=14)).isoformat(),
        "{{TODAY_PLUS_30}}": (today_value + timedelta(days=30)).isoformat(),
    }
    for path in target.rglob("*"):
        if not path.is_file() or path.suffix.lower() not in {".md", ".yaml", ".yml", ".json"}:
            continue
        text = path.read_text(encoding="utf-8")
        for marker, value in replacements.items():
            text = text.replace(marker, value)
        path.write_text(text, encoding="utf-8")
    print(f"Created starter vault at {target}")


def doctor_cmd(_args):
    checks: list[tuple[str, bool, str]] = []
    checks.append(("Python", sys.version_info >= (3, 11), f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}"))
    node = shutil.which("node")
    node_version = ""
    if node:
        node_version = subprocess.run([node, "--version"], capture_output=True, text=True, check=False).stdout.strip()
    node_major = int(re.sub(r"\D", "", node_version.split(".")[0]) or 0)
    checks.append(("Node.js", bool(node and node_major >= 22), node_version or "not found"))
    checks.append(("Vault", ROOT.is_dir(), str(ROOT)))
    config_path = ROOT / "settings" / "workbench.yml"
    try:
        load_workbench_config(ROOT)
        config_ok = True
        config_detail = str(config_path) if config_path.exists() else "defaults in use"
    except Exception as exc:  # pragma: no cover - defensive CLI boundary
        config_ok = False
        config_detail = str(exc)
    checks.append(("Configuration", config_ok, config_detail))
    output_parent = DATA.parent
    checks.append(("Output location", output_parent != APP_ROOT or ROOT == APP_ROOT, str(output_parent)))
    for label, ok, detail in checks:
        print(f"{'OK' if ok else 'FAIL'}  {label}: {detail}")
    if not all(ok for _label, ok, _detail in checks):
        raise SystemExit(1)
    print("Doctor found no blocking installation or configuration problems.")

def ra_status_cmd(args):
    if not args.no_sync:
        sync_markdown()
    collaborator_kinds={"collaborator-status","collaborator-checkin","collaborator-assignment","ra-status","ra-checkin","ra-plan"}
    ts=[t for t in load("tasks.json") if is_open_task(t) and str(t.get("area") or t.get("domain") or "").lower() in {"collaborators","ra"}]
    ns=[n for n in load("notes.json") if n.get("kind") in collaborator_kinds]
    es=[e for e in load("events.json") if str(e.get("area") or e.get("domain") or "").lower() in {"collaborators","ra"}]
    print("\nCOLLABORATOR MONITOR\n"+"="*20)
    print("\nOpen collaborator tasks")
    for t in sorted(ts,key=lambda t:(t.get("priority",9),t.get("due") or "9999")):
        print(f"- [P{t.get('priority')}] {t.get('title')} — due {t.get('due')}")
        print(f"  next: {t.get('next')}")
        print(f"  file: {t.get('path')}")
    print("\nRecent collaborator notes")
    for n in ns[:12]:
        print(f"- {n.get('date')} [{n.get('kind')}] {n.get('title')} — {n.get('project')}")
        print(f"  file: {n.get('path')}")
    print("\nCollaborator dates")
    for e in es[:12]:
        print(f"- {e.get('date')} {e.get('title')}")

def main():
    ap=argparse.ArgumentParser(description="Research Workbench CLI")
    sub=ap.add_subparsers(dest="cmd",required=True)
    p=sub.add_parser("init", help="Create a starter vault without overwriting existing content")
    p.add_argument("--vault", required=True)
    p.add_argument("--today", help=argparse.SUPPRESS)
    p.set_defaults(func=init_cmd)
    sub.add_parser("doctor", help="Run read-only installation and configuration checks").set_defaults(func=doctor_cmd)
    for n,f in [("status",status),("today",today),("focus",focus),("render",render),("export-codex",export_codex)]:
        p=sub.add_parser(n); p.add_argument("--no-sync",action="store_true"); p.set_defaults(func=f)
    p=sub.add_parser("project-status"); p.add_argument("--no-sync", action="store_true"); p.set_defaults(func=status)
    sub.add_parser("sync").set_defaults(func=sync_cmd)
    p=sub.add_parser("weekly-review"); p.add_argument("--week"); p.add_argument("--force",action="store_true"); p.add_argument("--render",action="store_true"); p.add_argument("--no-sync",action="store_true"); p.set_defaults(func=weekly_review)
    p=sub.add_parser("log"); p.add_argument("project"); p.add_argument("message"); p.set_defaults(func=log)
    p=sub.add_parser("capture"); p.add_argument("text"); p.add_argument("--title"); p.add_argument("--project"); p.add_argument("--source"); p.set_defaults(func=capture)
    p=sub.add_parser("new-daily"); p.add_argument("date",nargs="?"); p.add_argument("--force",action="store_true"); p.set_defaults(func=new_daily)
    p=sub.add_parser("new-health"); p.add_argument("date",nargs="?"); p.add_argument("--force",action="store_true"); p.set_defaults(func=new_health)
    p=sub.add_parser("new-note"); p.add_argument("project"); p.add_argument("type",choices=sorted(NOTE_TYPES)); p.add_argument("title"); p.add_argument("--date"); p.add_argument("--force",action="store_true"); p.set_defaults(func=new_note)
    p=sub.add_parser("notes"); p.add_argument("--project"); p.add_argument("--kind"); p.add_argument("--limit",type=int,default=30); p.add_argument("--no-sync",action="store_true"); p.set_defaults(func=list_notes)
    p=sub.add_parser("scan-vault"); p.add_argument("--include-private", action="store_true"); p.set_defaults(func=scan_vault_cmd)

    p=sub.add_parser("vault-context"); p.add_argument("--include-private", action="store_true"); p.set_defaults(func=vault_context_cmd)
    p=sub.add_parser("get-note"); p.add_argument("path"); p.set_defaults(func=get_note_cmd)
    p=sub.add_parser("search-notes"); p.add_argument("query"); p.add_argument("--limit", type=int, default=10); p.add_argument("--include-private", action="store_true"); p.set_defaults(func=search_notes_cmd)
    p=sub.add_parser("preview"); p.add_argument("path"); p.add_argument("--limit", type=int, default=420); p.set_defaults(func=preview_cmd)
    p=sub.add_parser("graph"); p.add_argument("--no-sync", action="store_true"); p.set_defaults(func=graph_cmd)
    p=sub.add_parser("calendar"); p.add_argument("--no-sync", action="store_true"); p.set_defaults(func=calendar_cmd)
    p=sub.add_parser("boards"); p.add_argument("--no-sync", action="store_true"); p.set_defaults(func=boards_cmd)
    p=sub.add_parser("deadline-audit"); p.add_argument("--no-sync", action="store_true"); p.set_defaults(func=deadline_audit_cmd)
    sub.add_parser("validate-schema").set_defaults(func=lambda args: timed_check_call("pm.validate_schema", [sys.executable, str(APP_ROOT/"scripts/validate_vault_schema.py"), "--root", str(ROOT)]))
    sub.add_parser("duplicate-tasks").set_defaults(func=lambda args: timed_check_call("pm.duplicate_tasks", [sys.executable, str(APP_ROOT/"scripts/report_task_lifecycle_duplicates.py")]))
    sub.add_parser("privacy-scan").set_defaults(func=lambda args: timed_check_call("pm.privacy_scan", [sys.executable, str(APP_ROOT/"scripts/privacy_scan.py"), "--root", str(ROOT), "--all-files"]))
    p=sub.add_parser("qa"); p.set_defaults(func=qa_cmd)
    p=sub.add_parser("ra"); p.add_argument("--no-sync", action="store_true"); p.set_defaults(func=ra_status_cmd)
    p=sub.add_parser("plan")
    p.add_argument("--date")
    p.add_argument("--week", help="Week start as YYYY-MM-DD, or legacy manual block_week prefix such as YYYY-MM-")
    p.add_argument("--start", default="09:00")
    p.add_argument("--capacity-minutes", type=int, default=420)
    p.add_argument("--weekdays", type=int, default=5)
    p.add_argument("--horizon-days", type=int, default=14)
    p.add_argument("--no-sync", action="store_true")
    p.set_defaults(func=plan_cmd)
    p=sub.add_parser("ai-plan-context")
    p.add_argument("--date")
    p.add_argument("--week", help="Week start as YYYY-MM-DD, or legacy manual block_week prefix such as YYYY-MM-")
    p.add_argument("--start", default="09:00")
    p.add_argument("--capacity-minutes", type=int, default=420)
    p.add_argument("--weekdays", type=int, default=5)
    p.add_argument("--horizon-days", type=int, default=14)
    p.add_argument("--ad-hoc", default="")
    p.add_argument("--include-private", action="store_true")
    p.add_argument("--no-sync", action="store_true")
    p.set_defaults(func=ai_plan_context_cmd)
    args=ap.parse_args(); args.func(args)
if __name__=="__main__": main()
