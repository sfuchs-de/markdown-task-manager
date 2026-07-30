# Markdown Task Manager

A private-by-default task and project workbench built on ordinary Markdown
files.

The application gives you a searchable dashboard, project and task views,
Markdown editing and preview, wiki links, lightweight metadata controls,
calendar-oriented filtering, and optional synchronization to a **separate
private GitHub vault**. Your files remain readable in any editor and are never
locked into a database.

## What is public—and what is not

This repository contains only application code, documentation, and a fictional
example vault. It contains no user vault, credentials, messages, calendar
events, health records, travel plans, collaborator records, or private Git
history.

When you use the app, keep your real vault outside this repository or under the
ignored `vault/` directory. If you synchronize it with GitHub, create a separate
**private** repository for the vault.

## Features

- Markdown and YAML frontmatter remain canonical.
- Overview counts for projects, open tasks, waiting work, and notes.
- Searchable Tasks, Projects, Calendar, and full Library views.
- Read and edit modes with conflict-aware, atomic saves.
- Quick task-status changes and lifecycle moves.
- `[[wiki links]]`, `[[document-id|labels]]`, aliases, and backlinks.
- Responsive light and dark interfaces.
- Token-protected remote access.
- Optional, explicit GitHub push and restore workflow.
- Privacy and credential scans in CI.

## Try it in five minutes

Requirements: Python 3.11+, Node.js 22+, and npm.

```bash
git clone https://github.com/<owner>/markdown-task-manager.git
cd markdown-task-manager
make setup
make demo
```

Start the API in one terminal:

```bash
make api
```

Start the web application in a second terminal:

```bash
make web
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173). Localhost access does not
require a token by default.

To use an existing vault instead:

```bash
PM_VAULT_ROOT="/absolute/path/to/your/vault" make api
```

The app never modifies a file until you explicitly save or change task
metadata.

## Markdown format

A task is a Markdown file with a small YAML header:

```markdown
---
kind: task
id: revise-introduction
title: Revise the introduction
status: active
priority: 1
project: paper-example
due: 2026-09-30
assignee: Example User
---
# Revise the introduction

## Next action

- Incorporate the argument from [[identification-note]].
```

Projects live at `projects/<project-id>/README.md`; tasks commonly live under
`tasks/active`, `tasks/waiting`, and `tasks/done`. The parser also accepts less
structured Markdown, so you can adopt the conventions incrementally.

See [Vault format](docs/VAULT_FORMAT.md) for the complete recommended layout.

## Docker

Copy the example vault or add your own files under `vault/`, choose a strong
token, and start the container:

```bash
cp -R example-vault/. vault/
export PM_APP_TOKEN="$(python -c 'import secrets; print(secrets.token_urlsafe(32))')"
docker compose up --build
```

Open [http://127.0.0.1:8765](http://127.0.0.1:8765). The vault is mounted into
the container and is not built into the image.

## Remote access

Do not expose the server directly without `PM_APP_TOKEN` and TLS. The API
requires a bearer token for non-local requests and deliberately returns no
credentials or vault contents from its health endpoint.

For deployment, backup, and optional GitHub synchronization, read
[Self-hosting](docs/SELF_HOSTING.md) and [Privacy model](docs/PRIVACY.md).

## Development

```bash
make test
make build
make privacy
```

Pull requests run Python tests, TypeScript checks, frontend tests, a production
build, the privacy scan, and a container build.

## Scope

This public edition focuses on the reusable core: projects, tasks, notes,
calendar metadata, Markdown editing, links, and private synchronization.
Personalized modules and any user-specific data from the original private
installation are intentionally not distributed.

## License

[MIT](LICENSE). Use it, adapt it, and keep your own vault private.
