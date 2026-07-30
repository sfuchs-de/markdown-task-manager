# Architecture

Research Workbench has four layers:

1. The user-selected vault contains canonical Markdown and safe settings.
2. Python readers parse YAML frontmatter, enforce path boundaries, and expose a
   FastAPI JSON/file API.
3. The React application derives views from entry metadata and edits Markdown
   through conflict-aware API calls.
4. Optional JSON and static HTML are generated under `<vault>/.generated`.

No database is required. The server preserves unknown frontmatter fields and
uses atomic file replacement for writes. The configuration endpoint exposes a
small allowlist rather than arbitrary settings.

GitHub sync operates through a temporary checkout and an explicit vault-file
allowlist. It starts disabled and reports a dry-run diff before mutation.

The public application repository never reads from the private customized
repository. A private installation may import a reviewed public tag through a
one-way, allowlisted utility; there is no reverse synchronization path.
