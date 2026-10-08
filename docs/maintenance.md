# Backups and upgrades

Run these commands from the Herts checkout.
The examples use `herts.service`.
Use the installed service name if it differs, such as `hermes-tasks.service`.

The data directory is **private**, including the SQLite database, uploads, environment files and notification keys. Keep it outside version control and restrict it to your server user. Backups are equally sensitive. Never attach it, browser profiles, HAR traces or transcripts to an issue. See [retention and provider processing](decisions.md#execution-recovery-and-privacy) for temporary dictation copies and device caches. Private access to Herts does not imply that Hermes runs its model or audio processing locally.

For a consistent backup, briefly stop the app while leaving the backend running:

```sh
systemctl --user stop herts.service
node --env-file=data/app.env scripts/backup.mjs /private/backups/herts-before-update
systemctl --user start herts.service
```

The destination must be new and outside the data directory. The backup includes SQLite, complete uploads, plugin-owned files, retained plugin package versions, and a plugin inventory. It also includes environment and token files in the data directory. Back up your source plugin directory separately if it contains local development work. Also back up externally located token files and Hermes itself separately. Device-only unsynced edits/drafts/recordings are not in a server backup: sync/recover those before clearing browser storage. Incomplete uploads remain recoverable on their original devices.

Build and test an update in a separate checkout first (`npm ci`, then `npm run check:release`; see [Testing](testing.md)). Preserve your data directory, environment, origin and service names. Stop only the app before you replace its source, dependencies, and `dist` with the tested version. Keep previous hashed `dist/assets` files for clients with older open pages. Start the app and run the read-only connection check. Do not rerun the installer to upgrade an existing differently named service.

The plugin transition migrates the database and browser queues while retaining the historical storage identities. Keep the previous source revision/build and private backup until the update is verified. A pre-plugin build must be paired with its pre-migration database backup; do not run it against the migrated database. To roll back, stop the app. Restore the previous source, build, and dependencies. If the update migrated the database, restore a matching data backup. Restore files with private permissions and restart only the app. Restoring a database backup discards newer server changes; recover device drafts before proceeding. Never retry an uncertain Hermes send just because you restored the app.

Herts keeps the historical IndexedDB name `hermes-tasks` and SQLite filename `tasks.sqlite`. It also keeps browser storage keys, cache keys, API routes, and the legacy request header. The PWA ID remains `/`. The service worker URL remains `/sw.js`. The visible app name can change without reinstalling, clearing data, changing its URL, or replacing notification keys.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| 403 / access restricted | Exact Tailscale login, HTTPS host/port, and Serve mapping. Tagged/shared devices may not supply the expected user identity. |
| Installer reports occupied port | Choose unused ports or explicitly select existing-backend mode. Do not stop unrelated services. |
| Installer reports different configuration | It intentionally refuses to overwrite files. Retain the original arguments, or review/edit your existing configuration manually. |
| Hermes unavailable | Correct token file permissions, backend origin/profile, `hermes serve` lifetime and compatibility. Task management still works. |
| Different Hermes target | Restore the original endpoint/profile, or use a fresh data directory. Do not delete the guard to guess at conversation ownership. |
| Notification accepted but not shown | Tailscale reachability for acknowledgements, browser and device permission, battery restrictions and Do Not Disturb. Use Repair only when Settings offers it. |
| Old app name/shortcut | Open online and close/reopen the app; allow the browser to refresh installed metadata. Avoid clearing storage when drafts are unsynced. |
| Article is only an excerpt | Some sites require login or an extra step. Use the original link; Herts does not bypass access controls. |

Logs are available with `journalctl --user -u herts.service` (and `herts-backend.service` in managed mode). Inspect/redact logs before sharing: Hermes logs can contain conversation data. See [SECURITY.md](../SECURITY.md) for reporting a vulnerability. Herts is [MIT licensed](../LICENSE). Builds include `THIRD_PARTY_NOTICES.txt` in `dist/` and every prepared plugin folder; retain those files when distributing builds. The app serves its notices at `/THIRD_PARTY_NOTICES.txt`, also available offline.
