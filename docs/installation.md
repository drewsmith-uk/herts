# Installation

Herts runs on a Linux server and connects to a configured Hermes backend.
Each installation provides private access for one Tailscale user.

## Requirements

- Linux with a user systemd session, Python 3, Git, and **Node.js 24 or later** with npm. Native dependencies can require C/C++ build tools when no prepared binary is available.
- Tailscale on the server and your devices, with HTTPS certificates/Serve enabled for your tailnet.
- A configured [Hermes Agent](https://hermes-agent.nousresearch.com/docs/) installation for conversation, transcription and speech features, including its web/backend dependencies. Follow the [upstream prerequisites](https://hermes-agent.nousresearch.com/docs/user-guide/features/web-dashboard#prerequisites); for a source installation, run `uv pip install -e ".[web]"` from the Hermes checkout in its environment. Tasks remain usable without Hermes. Hermes owns model credentials, available models, project folders and tools; Herts exposes session settings through that backend.
- A modern browser with IndexedDB and service workers. Optional features depend on browser and operating-system support.

The integration targets the **Hermes Desktop-compatible backend, through Desktop contract 8**. History/execution and session settings were checked against Hermes Agent 0.21.2/0.21.3 revisions; the newer interactive-prompt protocol was checked separately. Exact revisions and required capabilities are recorded in [backend compatibility](hermes-compatibility.md). An OpenAI-compatible API alone is insufficient. A version number alone does not prove compatibility.

## Build Herts

Clone into a directory owned by your Linux user, outside the Hermes source tree:

```sh
git clone https://github.com/drewsmith-uk/herts.git
cd herts
npm ci
npm run build
```

Decide which HTTPS port Tailscale Serve will use. These examples use 8443 for Herts, 8787 for its loopback server and 8788 for a dedicated Hermes backend. You can change these ports. Run `tailscale serve status` first. Select an unused mapping.

Use the exact Tailscale **user login**, not the display name or device name. Find it under Users in your tailnet admin console. Replace both values below:

```sh
HERTS_ORIGIN='https://your-node.your-tailnet.ts.net:8443'
HERTS_IDENTITY='you@example.com'
```

Choose **one** backend mode. The installer supports a dry run. It rejects occupied ports and unrelated units. It never overwrites different configuration. It does not send prompts or stop/restart any running Hermes process.

## Option A: Manage a dedicated Hermes backend

Configure Hermes first with `hermes setup`. Confirm `hermes serve --help` supports `--isolated`. Then:

```sh
python3 scripts/install-services.py --mode managed \
  --origin "$HERTS_ORIGIN" --identity "$HERTS_IDENTITY" --dry-run
python3 scripts/install-services.py --mode managed \
  --origin "$HERTS_ORIGIN" --identity "$HERTS_IDENTITY"
```

This creates private `data/app.env`, `data/backend.env`, and a random `data/backend-token`, plus `herts.service` and `herts-backend.service` in your user systemd directory. It starts `hermes --profile default serve --isolated` on loopback with the existing default Hermes configuration. It neither creates a new profile nor replaces your normal Hermes gateway.

To use an existing named profile, add `--profile research`. To use a custom Hermes root, add `--hermes-home /path/to/hermes-home`; named profiles are resolved under `profiles/NAME`. The selected profile must already have `config.yaml`. `--hermes-bin /path/to/hermes` and `--node /path/to/node` override executable discovery. `--app-port`, `--backend-port` and `--data-dir` override their defaults. Use the same options on a rerun.

## Option B: Connect to an existing backend

If `hermes serve` is already running and you want to use it, explicitly provide its origin and session-token file. Do not copy a provider API key or browser cookie. Use the backend's Desktop session token. Its owner configures this token through `HERMES_DASHBOARD_SESSION_TOKEN` or the supported Desktop launch procedure.

```sh
chmod 600 /private/path/backend-token
python3 scripts/install-services.py --mode existing \
  --origin "$HERTS_ORIGIN" --identity "$HERTS_IDENTITY" \
  --backend-url http://127.0.0.1:9119 \
  --token-file /private/path/backend-token --profile default --dry-run
```

Check the result. Then repeat without `--dry-run`. This mode installs only `herts.service`; the existing backend remains independently managed. Use a stable backend whose lifetime and token will survive closing Desktop. A remote endpoint requires HTTPS; loopback HTTP is allowed.

## Open Herts

After either mode:

```sh
tailscale serve --bg --https=8443 http://127.0.0.1:8787
systemctl --user status herts.service
node --env-file=data/app.env --import tsx scripts/check-connection.ts
```

The connection check reads app status/session metadata and pings the gateway. It never creates or resumes a conversation, sends a message, downloads an article, or sends a notification. It does not print task titles, conversations or credentials.

Open your configured HTTPS URL from a device signed into Tailscale as the configured user. See [Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve) for enabling certificates and Serve. **Do not enable Funnel or expose port 8787 publicly.** The app trusts the identity headers that Serve supplies to its loopback connection. Other local operating-system users and processes have access within that trust boundary.

To start user services after reboot without an interactive login, enable lingering if appropriate for your host: `loginctl enable-linger "$USER"`. This may require an administrator. For manual service review, the installer supports `--no-start`; templates are in `deploy/`.

For an existing installation, follow [Backups and upgrades](maintenance.md) instead of repeating the installer.
See [Configuration](configuration.md) for environment settings and custom paths.
