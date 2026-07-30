# Docker and private hosting

Initialize a vault, then start Compose:

```bash
make init
docker compose up --build
```

The default host binding is `127.0.0.1:8765`. The container runs as an
unprivileged user with a read-only root filesystem and a writable `/vault`
mount. Edits and `.generated` output persist across restarts.

On Linux, a bind-mounted vault must be writable by container UID/GID `10001`.
Either adjust the directory ownership deliberately or set compatible bind
permissions before starting Compose. Do not make a sensitive vault
world-writable. Docker Desktop normally translates bind-mount permissions.

For remote access:

1. Set a long random `PM_APP_TOKEN`.
2. Terminate TLS at a trusted reverse proxy.
3. Restrict access with a VPN, identity-aware proxy, or private network.
4. Back up the mounted vault.
5. Verify an unauthenticated content request returns `401`.

To require the token even on localhost, add
`PM_REQUIRE_LOCAL_AUTH=true`. The CI container smoke test verifies a
localhost-only port, non-root execution, token rejection, a persisted Markdown
edit after restart, and disabled-by-default GitHub synchronization.

The application has no public demo and should not be exposed directly to the
internet. The bearer token is a single-instance gate, not multi-user
authorization.
