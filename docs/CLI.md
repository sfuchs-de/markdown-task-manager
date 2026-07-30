# CLI

Run commands with `.venv/bin/python scripts/pm.py`.

```text
init --vault PATH       create a starter vault; never overwrite nonempty PATH
doctor                  read-only dependency and configuration checks
status                  list project state
today                   show the near-term task queue
focus                   show a compact focus view
sync                    rebuild generated JSON from Markdown
render                  rebuild deterministic static views
validate-schema         check task and structured-frontmatter conventions
privacy-scan            scan the active vault for obvious private residue
plan                    allocate a local time plan
ai-plan-context         emit a copyable planning context without changing tasks
```

The CLI honors `PM_VAULT_ROOT` and `PM_OUTPUT_ROOT`. Markdown remains canonical;
JSON and HTML under `.generated` are disposable caches.
