# Herts

Herts is a web app for [Hermes Agent](https://hermes-agent.nousresearch.com/docs/).
It brings conversations, tasks, saved articles, and bot routines into one interface.
Run it on a Linux server and access it through a browser on a phone, tablet, or computer.

## Features

- **Conversations:** Start new conversations, browse history, and continue existing work. Attach files, dictate messages, and read responses aloud.
- **Tasks:** Organise tasks into spaces, set priorities, and schedule reminders. Send a task to Hermes when it needs agent work.
- **Reading:** Save links, read downloaded articles offline, and discuss them with Hermes.
- **Bots:** Open bot chats, edit Hermes profiles, and manage scheduled routines.

Conversations is always available.
Enable Tasks, Reading, and Bots as needed in **Settings → Plugins**.

## Browser support

Herts is designed for modern desktop and mobile browsers.
So far, device testing is limited to Android and macOS.
Optional features, including app installation, sharing, and notifications, depend on the browser and operating system.

Where supported, use the browser's install option to add Herts to the home screen or desktop.
You can also use it directly in a browser tab.

## Setup and installation

Each installation provides private access for one user through Tailscale.
Run the following commands on the Linux server, using the account that will run Herts.
For an existing Herts installation, use the [upgrade instructions](docs/maintenance.md).

### 1. Prepare the server

Install these requirements:

- Linux with a user systemd session, Node.js 24 or later, npm, Python 3, and Git.
- [Hermes Agent](https://hermes-agent.nousresearch.com/docs/), including its [web backend dependencies](https://hermes-agent.nousresearch.com/docs/user-guide/features/web-dashboard#prerequisites).
- Tailscale on the server and each device that will access Herts.

Configure Hermes with `hermes setup` if it is not already configured.
Enable HTTPS certificates and [Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve) for the network.
Native Node.js dependencies can also require C/C++ build tools when no prepared binary is available.

### 2. Download and build Herts

Use a directory owned by the service account, outside the Hermes source directory:

```sh
git clone https://github.com/drewsmith-uk/herts.git
cd herts
npm ci
npm run build
```

Run the remaining commands from this `herts` directory.

### 3. Set the address and user

Check existing Tailscale Serve mappings:

```sh
tailscale serve status
```

These examples use HTTPS port `8443`, Herts port `8787`, and managed Hermes port `8788`.
Use unused ports.
For custom ports, see the [installation options](docs/installation.md).

Set the server's Tailscale address and the exact Tailscale user login:

```sh
HERTS_ORIGIN='https://your-node.your-tailnet.ts.net:8443'
HERTS_IDENTITY='you@example.com'
```

Replace both example values.
Find the user login under **Users** in the Tailscale admin console.
Use the login, not a display name or device name.

### 4. Connect Hermes

Choose one of the following options.

#### Run a dedicated Hermes backend

This option starts a separate backend using the existing default Hermes profile on this server.
Check that `hermes serve --help` lists `--isolated`.

Preview the installation:

```sh
python3 scripts/install-services.py --mode managed \
  --origin "$HERTS_ORIGIN" --identity "$HERTS_IDENTITY" --dry-run
```

If validation succeeds, install and start the services:

```sh
python3 scripts/install-services.py --mode managed \
  --origin "$HERTS_ORIGIN" --identity "$HERTS_IDENTITY"
```

The installer creates `herts.service`, `herts-backend.service`, and private configuration files under `data/`.

#### Use an existing Hermes backend

Use this option when a compatible `hermes serve` backend is already running.
Obtain its address and Desktop session-token file.
The token must be the backend session token, not a model provider API key.

Replace the example backend address and token path, then preview the installation:

```sh
chmod 600 /private/path/backend-token
python3 scripts/install-services.py --mode existing \
  --origin "$HERTS_ORIGIN" --identity "$HERTS_IDENTITY" \
  --backend-url http://127.0.0.1:9119 \
  --token-file /private/path/backend-token --profile default --dry-run
```

If validation succeeds, repeat the installer command without `--dry-run`.
This option installs only the Herts service.
A remote backend requires HTTPS; a backend on loopback can use HTTP.
The backend and its token must remain available after Hermes Desktop closes.

### 5. Open the app

Configure private access through Tailscale:

```sh
tailscale serve --bg --https=8443 http://127.0.0.1:8787
```

Use Tailscale Serve, not Funnel.
Do not expose port `8787` publicly.

Check the service and Hermes connection:

```sh
systemctl --user status herts.service
node --env-file=data/app.env --import tsx scripts/check-connection.ts
```

On a device connected to Tailscale, open the HTTPS address set in `HERTS_ORIGIN`.
Sign into Tailscale with the login set in `HERTS_IDENTITY`.

To start services after reboot without an interactive login, enable lingering for the server account:

```sh
loginctl enable-linger "$USER"
```

This command can require administrator permission.
See [Troubleshooting](docs/maintenance.md#troubleshooting) if installation or connection checks fail.

## Use Herts

### Start a conversation

1. Connect the device to Tailscale.
2. Open the installation's HTTPS address.
3. Open **Conversations**.
4. Select **New conversation**.
5. Write a message and add any attachments.
6. Select **Send**.

Open an existing conversation to read its history or send another message.
The settings beside the message field control the model, reasoning effort, and working folder for the next send.

### Organise tasks and reading

Enable **Tasks** or **Reading** in **Settings → Plugins**.

In Tasks, capture an item and select **Save to Inbox**.
Move tasks between lists to organise work, or snooze a task until a later time.
Select **Send** from a task to work on it with Hermes.

In Reading, add a link and select **Save link**.
Open the item to read the article or discuss it with Hermes.
On browsers that support sharing to installed apps, you can also share content directly to Herts.

### Use bots and routines

Enable **Bots** in **Settings → Plugins**.
Select a bot to open its chat.
Choose **Routines** from the chat header to create a schedule, run a routine, or read its results.
See the [Bots guide](docs/bots.md) for profile creation and routine settings.

### Change settings

- **Settings → Plugins:** Enable features and change the tab order.
- **Settings → General → Appearance:** Choose a theme.
- **Settings → General → New conversation defaults:** Set defaults for new conversations.
- **Settings → General → Notifications on this device:** Enable notifications on each device and send a test notification.

### Work offline and update the app

Saved drafts, downloaded articles, and cached conversation history remain available offline.
Task edits synchronise when the connection returns.
Sending messages to Hermes requires a connection.
Clearing browser storage removes local drafts and unsynchronised edits.

When an update is available, finish active recordings or unsaved forms, then select **Update now**.
You can also check for updates in **Settings → General → App updates**.
Server upgrades use the separate [maintenance instructions](docs/maintenance.md).

## Documentation

- [Installation](docs/installation.md) and [configuration](docs/configuration.md)
- [Backups, upgrades, and troubleshooting](docs/maintenance.md)
- [Plugins](docs/plugins.md) and [Bots](docs/bots.md)
- [Themes and local fonts](themes/README.md)
- [Offline behaviour, data storage, and privacy](docs/decisions.md)
- [Hermes compatibility](docs/hermes-compatibility.md)

To contribute, read [Contributing](CONTRIBUTING.md).
For plugin development, see the [plugin API guide](docs/plugin-api.md).
Report security issues through the process in [Security](SECURITY.md).

Herts is an independent project, released under the [MIT licence](LICENSE).
