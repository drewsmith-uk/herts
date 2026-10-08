# Security

Herts supports one user behind Tailscale Serve.
The app binds to loopback and checks the exact identity and origin.
It does not support anonymous public hosting or local server users who cannot trust each other.
Task spaces do not isolate data from one another.

Keep the app data directory, Hermes tokens, provider keys, database backups, browser profiles, and conversation content private.
Notification titles can appear on a device's lock screen.
Cached browser data depends on the device's access controls.

Use [private vulnerability reporting](https://github.com/drewsmith-uk/herts/security/advisories/new) to report a vulnerability when that service is available.
Do not put credentials, private hostnames, task data, or transcripts in a public issue.
If private reporting is unavailable, open an issue to request a private contact channel.
Exclude exploit details and sensitive data from that issue.

Security fixes apply to the current main branch.
Before you install a change, keep a private backup and a build that works.
Read the [installation guide](docs/installation.md) and [upgrade instructions](docs/maintenance.md).
