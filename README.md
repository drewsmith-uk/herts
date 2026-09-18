# Herts

**Hermes Tasks:** a private task, reading and conversation app for one person. Use it in a browser or install it as a PWA on Android or Mac. Herts connects to the same Desktop-compatible backend as [Hermes Desktop](https://hermes-agent.nousresearch.com/docs/user-guide/features/web-dashboard#connecting-hermes-desktop-to-a-remote-backend).

Capture tasks without calling an agent; organise them manually into spaces with Inbox, Next, Waiting, Parked, Snoozed and Done. Browse your existing Hermes conversations and deliberately turn one into a task. Save links to a separate reading list, continue their conversations, and keep article text offline. Conversations and Reading are shared across spaces.

Herts runs on your Linux server behind **Tailscale Serve**. It is a **single-user application**, not a public web service or a multi-user task manager. You supply your own Hermes installation and configuration. Herts is an independent project; it is not an official Nous Research product.

## Requirements

- Linux with a user systemd session, Python 3, Git, and **Node.js 24 or later** with npm. Native dependencies may need a C/C++ build toolchain if a prebuilt binary is unavailable.
- Tailscale on the server and your devices, with HTTPS certificates/Serve enabled for your tailnet.
- A configured [Hermes Agent](https://hermes-agent.nousresearch.com/docs/) installation for conversation, transcription and speech features, including its web/backend dependencies. Follow the [upstream prerequisites](https://hermes-agent.nousresearch.com/docs/user-guide/features/web-dashboard#prerequisites); for a source installation, run `uv pip install -e ".[web]"` from the Hermes checkout in its environment. Tasks remain usable without Hermes. Hermes owns model credentials, model selection, project folders and tools.
- A recent browser with IndexedDB and service workers. Android Chrome supports the installable app, share target, voice shortcut and web push. Browser/OS support for these features varies.

The integration has been checked against Hermes Agent **0.21.2** source and an existing Desktop-compatible backend. It depends on session history/profile identity, WebSocket JSON-RPC and event replay; an arbitrary OpenAI-compatible API is not sufficient. See [backend compatibility](docs/hermes-compatibility.md) before connecting another version.

## Install

Clone into a directory owned by your Linux user, outside the Hermes source tree:

```sh
git clone https://github.com/drewsmith-uk/herts.git
cd herts
npm ci
npm run build
```

Decide which HTTPS port Tailscale Serve will use. These examples use 8443 for Herts, 8787 for its loopback server and 8788 for a dedicated Hermes backend. They are configurable. Inspect `tailscale serve status` first and pick an unused mapping.

Use the exact Tailscale **user login**, not the display name or device name. Find it under Users in your tailnet admin console. Replace both values below:

```sh
HERTS_ORIGIN='https://your-node.your-tailnet.ts.net:8443'
HERTS_IDENTITY='you@example.com'
```

Choose **one** backend mode. The installer has a dry run, refuses occupied ports/unrelated units and never overwrites different configuration. It does not send prompts or stop/restart any running Hermes process.

### A. Manage a dedicated Hermes backend

Configure Hermes first with `hermes setup`. Confirm `hermes serve --help` supports `--isolated`. Then:

```sh
python3 scripts/install-services.py --mode managed \
  --origin "$HERTS_ORIGIN" --identity "$HERTS_IDENTITY" --dry-run
python3 scripts/install-services.py --mode managed \
  --origin "$HERTS_ORIGIN" --identity "$HERTS_IDENTITY"
```

This creates private `data/app.env`, `data/backend.env`, and a random `data/backend-token`, plus `herts.service` and `herts-backend.service` in your user systemd directory. It starts `hermes --profile default serve --isolated` on loopback with the existing default Hermes configuration. It neither creates a new profile nor replaces your normal Hermes gateway.

To use an existing named profile, add `--profile research`. To use a custom Hermes root, add `--hermes-home /path/to/hermes-home`; named profiles are resolved under `profiles/NAME`. The selected profile must already have `config.yaml`. `--hermes-bin /path/to/hermes` and `--node /path/to/node` override executable discovery. `--app-port`, `--backend-port` and `--data-dir` override their defaults. Use the same options on a rerun.

### B. Connect to an existing backend

If `hermes serve` is already running and you want to use it, explicitly provide its origin and session-token file. Do not copy a provider API key or browser cookie. The token must be the backend's Desktop session token, configured by its owner through `HERMES_DASHBOARD_SESSION_TOKEN` or the supported Desktop launch flow.

```sh
chmod 600 /private/path/backend-token
python3 scripts/install-services.py --mode existing \
  --origin "$HERTS_ORIGIN" --identity "$HERTS_IDENTITY" \
  --backend-url http://127.0.0.1:9119 \
  --token-file /private/path/backend-token --profile default --dry-run
```

Repeat without `--dry-run` after checking the result. This mode installs only `herts.service`; the existing backend remains independently managed. Use a stable backend whose lifetime and token will survive closing Desktop. A remote endpoint requires HTTPS; loopback HTTP is allowed.

### Expose the app privately

After either mode:

```sh
tailscale serve --bg --https=8443 http://127.0.0.1:8787
systemctl --user status herts.service
node --env-file=data/app.env --import tsx scripts/check-connection.ts
```

The connection check reads app status/session metadata and pings the gateway. It never creates or resumes a conversation, sends a message, downloads an article, or sends a notification. It does not print task titles, conversations or credentials.

Open your configured HTTPS URL from a device signed into Tailscale as the configured user. See [Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve) for enabling certificates and Serve. **Do not enable Funnel or expose port 8787 publicly.** The app trusts the identity headers that Serve supplies to its loopback connection. Other local OS users/processes are inside that trust boundary.

To start user services after reboot without an interactive login, enable lingering if appropriate for your host: `loginctl enable-linger "$USER"`. This may require an administrator. For manual service review, the installer supports `--no-start`; templates are in `deploy/`.

## Configuration

The service reads its private environment file; `npm start` does not automatically load `.env`. For manual startup, copy `.env.example` to a private file, edit it, `chmod 600` it, then run:

```sh
node --env-file=/private/path/app.env --import tsx server/index.ts
```

| Setting | Purpose / default |
| --- | --- |
| `HERTS_ORIGIN` | Required production HTTPS origin, with no trailing slash or path. |
| `HERTS_IDENTITY` | Required exact Tailscale user login. |
| `HERTS_DATA_DIR` | Persistent private data directory; default `./data`. Prefer an absolute path for services. |
| `HERTS_PORT` | Loopback port; default `8787`. |
| `HERTS_DEV` | `1` bypasses Tailscale identity on loopback for development only; default off. |
| `HERMES_BASE_URL` | Backend HTTP(S) origin. HTTP is allowed only on loopback. |
| `HERMES_TOKEN_FILE` | Private UTF-8 file containing the backend session token. Takes precedence over `HERMES_TOKEN`. |
| `HERMES_TOKEN` | Alternative token via process environment; a file is preferable. Never a `VITE_*` variable. |
| `HERMES_PROFILE` | Existing profile name; default `default`. Used for history, execution, attachments, transcription and speech. |
| `HERMES_EXCLUDED_CONVERSATIONS` | Optional comma-separated conversation/lineage IDs excluded from browsing. |

Leave both `HERMES_BASE_URL` and token settings unset for tasks-only use. A configured but temporarily unreachable Hermes does not prevent task management. Changing server environment requires restarting **only the app** to apply it.

Legacy `TASKS_DATA_DIR`, `TASKS_ORIGIN`, `TASKS_IDENTITY`, `TASKS_DEV`, `TASKS_PORT` and `PORT` remain accepted. `HERTS_*` takes precedence, followed by `TASKS_*`, then `PORT` for the port. Existing installations need not rename services or change environment files.

Each data directory is bound to its Hermes endpoint and profile. Once it contains conversation references or action records, Herts refuses a different target. Use a separate data directory for another backend/profile. On the first upgrade of a legacy store, retain its original endpoint and `default` profile so Herts can record that binding. Rotating a token for the **same** backend is supported; moving the backend to another URL needs a deliberate, verified migration, not an environment-only switch.

## Install on your devices

In Android Chrome, open the HTTPS URL and choose **Install app** / **Add to Home screen**. On Mac, use a browser's install/add-to-Dock option when available, or bookmark the app. Keep Tailscale connected to sync and use Hermes.

- Enable notifications in Settings on each device, then deliberately send a test. Settings distinguishes push-service acceptance from the device confirming display. Repair is shown only when needed. Notifications contain task titles, which may appear on the lock screen.
- Long-press the installed Android icon for **New voice task**. The shortcut records after microphone permission, then lets you stop, review and save the title. Opening the app normally never records. Existing Android shortcuts/app names can take time to refresh after an update.
- When a new deployed version is ready, an **Update available** toast offers **Update now** or **Later**. Updating saves local drafts and reloads the current screen; pending changes remain on the device and accepted Hermes work keeps running. Finish recording or unsaved forms first. Later dismisses that version for the current page session. **Settings → App updates** shows the loaded app version and provides **Check for updates** plus **Update now** for a ready update, even after dismissing its toast. Explicit checks report when you are up to date or when the latest version cannot be verified. The app checks on launch, when returning to the foreground, and periodically while open. This updates the web app; Chrome separately manages Android's launcher name, icon and shortcuts.
- Share a link from another app to Herts to add it to Reading and send it to Hermes. Reading titles can be edited on the item page or inline in Edit list, just like task titles.
- Open a conversation from Conversations to read or reply directly, without creating a task or reading item. All three views share messaging, saved drafts on the same device, activity and approval/stop controls. Opening a conversation never starts Hermes; sending a message deliberately continues it.
- Inbox tasks can be snoozed from their page or by swiping the row. The server returns them to Inbox at the chosen time, even when Hermes is offline; notification delivery also depends on browser/OS push support.

See [behaviour and data ownership](docs/decisions.md) for conversation linking, offline work and deliberate agent execution.

## Backups and upgrades

The data directory is **private**, including the SQLite database, uploads, environment files and notification keys. Keep it outside version control and restrict it to your server user. Backups are equally sensitive. Never attach it, browser profiles, HAR traces or transcripts to an issue.

For a consistent backup, briefly stop the app while leaving the backend running:

```sh
systemctl --user stop herts.service
node --env-file=data/app.env scripts/backup.mjs /private/backups/herts-before-update
systemctl --user start herts.service
```

The destination must be new and outside the data directory. The backup includes SQLite, complete uploads and environment/token files stored alongside it. Also back up externally located token files and Hermes itself separately. Device-only unsynced edits/drafts/recordings are not in a server backup: sync/recover those before clearing browser storage. Incomplete uploads remain recoverable on their original devices.

Build and test an update in a separate checkout first (`npm ci`, `npm run check`, `npm run test:installer`; see browser tests below). Preserve your data directory, environment, origin and service names. Stop only the app before replacing its source, dependencies and `dist` with the tested version; retain previous hashed `dist/assets` files for clients with older open pages. Start the app and run the read-only connection check. Do not rerun the installer to upgrade an existing differently named service.

Keep the previous source revision/build and private backup until the update is verified. To roll back, stop the app, restore the prior source/build/dependencies, and restore a matching data backup if the update migrated the database. Restore files with private permissions and restart only the app. Restoring a database backup discards newer server changes; recover device drafts before proceeding. Never retry an uncertain Hermes send just because you restored the app.

Herts retains the historical IndexedDB name `hermes-tasks`, SQLite filename `tasks.sqlite`, browser storage/cache keys, API routes, PWA ID `/`, service worker URL `/sw.js` and legacy request header for installed clients. The visible app name can change without reinstalling, clearing data, changing its URL, or replacing notification keys.

## Development and checks

```sh
npm ci
npm run check
npm run test:installer
npx playwright install --with-deps chromium
npm run test:browser
```

Browser tests start their own temporary app and fake Hermes on ports 8790/8791. They use synthetic data, not your Hermes profile. For a custom Chromium installation, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`; otherwise Playwright uses its installed full Chromium channel in headless mode, including the notification integration checks. Test traces/screenshots stay ignored locally and are not uploaded by CI.

For interactive development, use a separate data directory:

```sh
HERTS_DEV=1 HERTS_DATA_DIR=.runtime/dev-data npm run dev:server
# In another terminal:
npm run dev
```

Open `http://127.0.0.1:5173`. If inherited environment variables configure Hermes, unset them for tasks-only development. Never run development mode against production data. See [testing](docs/testing.md) for the safety and regression checks.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| 403 / access restricted | Exact Tailscale login, HTTPS host/port, and Serve mapping. Tagged/shared devices may not supply the expected user identity. |
| Installer reports occupied port | Choose unused ports or explicitly select existing-backend mode. Do not stop unrelated services. |
| Installer reports different configuration | It intentionally refuses to overwrite files. Retain the original arguments, or review/edit your existing configuration manually. |
| Hermes unavailable | Correct token file permissions, backend origin/profile, `hermes serve` lifetime and compatibility. Task management still works. |
| Different Hermes target | Restore the original endpoint/profile, or use a fresh data directory. Do not delete the guard to guess at conversation ownership. |
| Notification accepted but not shown | Tailscale reachability for acknowledgements, Android/browser permission, battery restrictions and Do Not Disturb. Use Repair only when Settings offers it. |
| Old app name/shortcut | Open online and close/reopen the app; allow the browser to refresh installed metadata. Avoid clearing storage when drafts are unsynced. |
| Article is only an excerpt | Some sites require login or an extra step. Use the original link; Herts does not bypass access controls. |

Logs are available with `journalctl --user -u herts.service` (and `herts-backend.service` in managed mode). Inspect/redact logs before sharing: Hermes logs can contain conversation data. See [SECURITY.md](SECURITY.md) for reporting a vulnerability. License: [MIT](LICENSE).
