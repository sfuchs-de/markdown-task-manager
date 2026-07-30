# GitHub synchronization

Synchronization is optional, disabled by default, and intended only for a
separate private vault repository.

```text
PM_GITHUB_SYNC_ENABLED=true
PM_GITHUB_REPO=account/private-vault
PM_GITHUB_BRANCH=main
PM_GITHUB_TOKEN=<fine-grained token>
```

Use a token with Contents access only to that repository. Status and dry-run
operations inspect changes first. Push and restore require explicit actions;
remote deletions and local extra-file deletion are opt-in. Restore can make a
local backup before changing Markdown.

Never configure synchronization to the public application repository. The
public release-import path for a private customized installation is a separate,
one-way code utility; it never exports private files.
