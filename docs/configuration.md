# Configuration

Run these commands from the Herts checkout.

The service reads its private environment file; `npm start` does not automatically load `.env`. For manual startup, copy `.env.example` to a private file, edit it, `chmod 600` it, then run:

```sh
node --env-file=/private/path/app.env --import tsx server/index.ts
```

| Setting | Purpose / default |
| --- | --- |
| `HERTS_ORIGIN` | Required production HTTPS origin, with no trailing slash or path. |
| `HERTS_IDENTITY` | Required exact Tailscale user login. |
| `HERTS_DATA_DIR` | Persistent private data directory; default `./data`. Prefer an absolute path for services. |
| `HERTS_PLUGINS_DIR` | Prepared plugin folder directory; default `./plugins`. The installer also accepts `--plugins-dir`. |
| `HERTS_THEMES_DIR` | Custom theme JSON/font directory; default `./themes`. Adding or editing files needs no rebuild or restart. |
| `HERTS_PORT` | Loopback port; default `8787`. |
| `HERTS_DEV` | `1` bypasses Tailscale identity on loopback for development only; default off. |
| `HERMES_BASE_URL` | Backend HTTP(S) origin. HTTP is allowed only on loopback. |
| `HERMES_TOKEN_FILE` | Private UTF-8 file containing the backend session token. Takes precedence over `HERMES_TOKEN`. |
| `HERMES_TOKEN` | Alternative token via process environment; a file is preferable. Never a `VITE_*` variable. |
| `HERMES_PROFILE` | Existing profile name; default `default`. Used for history, execution, attachments, transcription and speech. |
| `HERMES_EXCLUDED_CONVERSATIONS` | Optional comma-separated conversation/lineage IDs excluded from browsing. |

Leave both `HERMES_BASE_URL` and token settings unset for local use, then enable Tasks in Settings if needed. A configured but temporarily unreachable Hermes does not prevent task management. After you change server environment settings, restart **only the app** to apply them.

Legacy `TASKS_DATA_DIR`, `TASKS_ORIGIN`, `TASKS_IDENTITY`, `TASKS_DEV`, `TASKS_PORT` and `PORT` remain accepted. `HERTS_*` takes precedence, followed by `TASKS_*`, then `PORT` for the port. Existing installations need not rename services or change environment files.

Each data directory is bound to its Hermes endpoint and profile. Once it contains conversation references or action records, Herts refuses a different target. Use a separate data directory for another backend/profile. For the first upgrade of a legacy store, keep its original endpoint and `default` profile. Herts then records that binding. You can rotate a token for the **same** backend. Moving the backend to another URL requires a planned and verified migration. An environment change alone is insufficient.

See [Installation](installation.md) for service setup and [Backups and upgrades](maintenance.md) before changes to an existing installation.
