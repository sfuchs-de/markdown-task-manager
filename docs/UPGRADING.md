# Upgrading

1. Back up the vault.
2. Read `CHANGELOG.md` and fetch the desired tag.
3. Reinstall Python and Node dependencies.
4. Run `make doctor`, `make qa`, and `make test-e2e`.
5. Run the new version against a copy of the vault.
6. Validate entry counts, module empty states, and one reversible edit.
7. Rebuild the Docker image if applicable.

Generated JSON and HTML may be deleted and rebuilt. Never overwrite the vault
with `example-vault`; `pm.py init` deliberately refuses nonempty targets.

The first Research Workbench release in this existing repository is `v1.1.0`;
the earlier `v1.0.0` tag belongs to the original public Markdown Task Manager.
