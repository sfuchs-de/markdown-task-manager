# Configuration

Create `<vault>/settings/workbench.yml`. Missing fields inherit safe defaults.

```yaml
application:
  name: Research Workbench
  owner_label: Owner
  owner_aliases: [Owner, me, self]

modules:
  travel: {enabled: true, label: Travel Center}
  wellness: {enabled: false, label: Wellness}

domains:
  labels:
    research: Research
    admin: Administration
    other: Other
  classification_rules:
    - {domain: research, field: domain, values: [research]}

profile:
  scholar_statistics_source: settings/scholar-stats.json
```

`GET /api/config` returns only display-safe values: the application label,
owner aliases, module state/labels, and domain labels. It never returns source
paths, synchronization credentials, or arbitrary configuration.

Classification is metadata-first. Set `domain`, `area`, `kind`, `project`, and
module-specific fields in frontmatter. A task can inherit a domain from its
project. Unmatched material becomes `other`.

Environment variables retain the `PM_*` prefix:

| Variable | Purpose |
| --- | --- |
| `PM_VAULT_ROOT` | Active vault; defaults to `./vault` |
| `PM_OUTPUT_ROOT` | Generated cache/output; defaults to `<vault>/.generated` |
| `PM_APP_TOKEN` | Bearer token required for non-local requests |
| `PM_REQUIRE_LOCAL_AUTH` | Require the token on localhost |
| `PM_CORS_ORIGINS` | Additional comma-separated browser origins |
| `PM_GITHUB_SYNC_ENABLED` | Enables optional vault synchronization |

See `.env.example` for the full synchronization set.
