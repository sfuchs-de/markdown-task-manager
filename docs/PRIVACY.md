# Privacy model

Markdown Task Manager is designed for private data, but privacy depends on how
you deploy and store the vault.

## Boundaries

- The public application repository contains no real vault.
- The server reads only the directory configured by `PM_VAULT_ROOT`.
- Markdown reads and writes are constrained to that directory.
- Only Markdown files are editable.
- Common private, import, database, dependency, and build directories are
  excluded from indexing.
- Non-local API requests require `PM_APP_TOKEN`.
- The health endpoint reports availability, not paths or file contents.
- The browser stores the app token locally and sends it only to the configured
  origin.

## What the app does not provide

- `private: true` is not encryption.
- The bearer token is not multi-user authentication.
- The app does not encrypt the vault at rest.
- The app cannot prevent a vault repository from being made public.
- The privacy scanner catches common mistakes; it is not a proof that text is
  anonymous.

## Recommended setup

1. Keep the public application checkout separate from the vault.
2. Store the vault on an encrypted device or private persistent disk.
3. Use a long random `PM_APP_TOKEN`.
4. Put remote access behind TLS and, preferably, an identity-aware proxy.
5. Use a separate private GitHub repository if synchronization is enabled.
6. Grant a GitHub token access only to that vault repository.
7. Never commit `.env`, private keys, exports, or browser data.
8. Test restores and keep an offline backup.

## Public contributions

Before committing:

```bash
make privacy
git diff --cached
```

Do not add screenshots, fixtures, test names, example messages, calendar
events, file paths, or logs copied from a real installation.
