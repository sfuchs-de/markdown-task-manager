# Self-hosting

## Local network

Create a vault and token:

```bash
mkdir -p vault
export PM_APP_TOKEN="$(python -c 'import secrets; print(secrets.token_urlsafe(32))')"
docker compose up --build
```

The Compose file binds the app to port 8765 and mounts `./vault` at `/vault`.
Add TLS through a reverse proxy before exposing it beyond a trusted machine.

## Render

The included Blueprint provisions a small persistent disk and generates the app
token. After creating the service:

1. Copy the generated `PM_APP_TOKEN` from Render into the browser unlock form.
2. Upload or synchronize a vault.
3. Confirm `/api/health` returns `ok: true`.
4. Confirm unauthenticated `/api/vault/entries` returns `401`.
5. Back up the persistent disk.

The Render service is not a public demo. It contains the deployer’s private
vault and should be protected accordingly.

## Optional private GitHub vault

Create a separate private repository containing only vault files. Then set:

```text
PM_GITHUB_SYNC_ENABLED=true
PM_GITHUB_REPO=account/private-vault
PM_GITHUB_BRANCH=main
PM_GITHUB_TOKEN=<fine-grained token>
```

The token should have Contents read/write access only to that repository.

Synchronization is deliberately explicit:

- Status and dry-run endpoints are safe inspection operations.
- Push copies allowed vault files into a temporary sparse checkout and commits
  them.
- Restore can create a local backup before changing the vault.
- Deletion of extra files is opt-in.

Do not configure synchronization to this public application repository.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `PM_VAULT_ROOT` | Absolute vault directory |
| `PM_APP_TOKEN` | Bearer token for remote requests |
| `PM_REQUIRE_LOCAL_AUTH` | Require the token on localhost when true |
| `PM_CORS_ORIGINS` | Comma-separated additional browser origins |
| `PM_GITHUB_SYNC_ENABLED` | Enable private GitHub vault sync |
| `PM_GITHUB_REPO` | `owner/repository` for the private vault |
| `PM_GITHUB_BRANCH` | Vault branch, normally `main` |
| `PM_GITHUB_TOKEN` | Fine-grained vault token |

## Upgrade procedure

1. Back up the vault.
2. Pull a tagged application release.
3. Rebuild the image or reinstall dependencies.
4. Run tests and the privacy scan.
5. Start the app and verify entry counts before editing.
