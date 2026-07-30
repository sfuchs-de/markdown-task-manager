# Modules

Modules are enabled and labeled in `settings/workbench.yml`. Empty modules show
an empty state; they do not require placeholder files.

| Module | Primary metadata |
| --- | --- |
| Tasks | `kind: task`, `status`, `priority`, `due`, `deadline_type` |
| Projects | `kind: project`, `id`, `domain`, `status` |
| Notes/editor | Any Markdown kind, plus `project`, `area`, and aliases |
| Calendar | `date`, `start_date`, `end_date` |
| Time planning | Task duration and scheduling fields; vault settings |
| Admin | `domain: admin`, optional `admin_category` |
| Travel | `module: travel`, `trip_key`, travel kinds, optional `ledger` |
| Collaborators | collaborator kinds, `module: collaborators`, `assignee` |
| Wellness | `area` or `module: wellness`, optional `wellness_category` |
| Performance | `performance-category`, `performance-achievement`, and verification kinds |
| Scholar metrics | JSON source configured in `workbench.yml` |
| GitHub sync | Environment configuration; disabled by default |

The internal `ra-management` view identifier remains for API/UI compatibility,
but its default public label is “Collaborators.”

The complete fictional examples under `example-vault/` are the reference
fixtures for supported frontmatter.
