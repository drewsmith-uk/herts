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

## Installation

Each installation provides private access for one user through Tailscale.
The server requires:

- Linux with systemd, Node.js 24 or later, npm, Python 3, and Git.
- A configured Hermes Agent installation with its web backend.
- Tailscale, with HTTPS and Serve enabled. Devices that access Herts also need Tailscale.

Follow the [installation guide](docs/installation.md) to build Herts, connect Hermes, and configure access.
The guide covers both a dedicated Hermes backend and an existing backend.

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
