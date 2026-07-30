# Backup and restore

The vault is the durable state. Back up the whole vault except disposable
`.generated` output.

Before an upgrade or GitHub restore:

1. Stop writes.
2. Copy the vault to encrypted storage.
3. Record the application tag.
4. Run `pm.py validate-schema`.
5. Test the copy by starting Research Workbench against it.

GitHub restore is optional and can create a timestamped `.backups` snapshot.
It does not replace an offline backup. Keep credentials and attachments outside
the application repository and test restoration periodically.
