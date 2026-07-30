# Vault format

The vault is a folder of Markdown files. Folder names provide useful defaults;
frontmatter can override them.

## Recommended layout

```text
vault/
├── START_HERE.md
├── _inbox/
├── projects/
│   └── project-id/
│       ├── README.md
│       └── notes/
├── tasks/
│   ├── active/
│   ├── waiting/
│   └── done/
├── dates/
├── notes/
├── settings/
│   └── workbench.yml
├── sources/
└── templates/
```

Only `.md` and `.markdown` files are indexed. Hidden application directories,
private/import folders, databases, and generated build folders are excluded.

## Common frontmatter

| Field | Meaning |
| --- | --- |
| `kind` | `task`, `project`, `event`, `note`, or a custom note kind |
| `id` | Stable identifier used by wiki links |
| `title` | Display title; an H1 is the fallback |
| `status` | Workflow state |
| `project` | Owning project ID |
| `domain` | Primary top-level classifier; unmatched entries become `other` |
| `area` | Optional module or work-area label |
| `module` | Optional dedicated module, such as `travel` or `wellness` |
| `priority` | Lower numbers sort first |
| `due` / `date` | ISO date, `YYYY-MM-DD` |
| `assignee` | Optional person or team label |
| `private` | Display filter; not encryption or access control |
| `aliases` | Alternative stable link targets |

Task states recognized by the quick editor are `open`, `active`, `waiting`,
`blocked`, `done`, and `cancelled`.

## Links

Use:

```markdown
[[document-id]]
[[document-id|Readable label]]
```

The app resolves links against file paths, stems, titles, IDs, and aliases.
Ordinary Markdown links remain ordinary links.

## Safety rules

- `private: true` is a display label, not access control.
- Put secrets and sensitive attachments outside the vault.
- Back up the vault before bulk edits or Git restore operations.
- Avoid duplicate IDs and aliases.
- Keep the app repository and a real vault in separate repositories.
