# Security

Herts is designed for one user behind Tailscale Serve, with the app bound to loopback and exact identity/origin checks. It is not designed for anonymous public hosting or mutually untrusted local server users. Task spaces do not isolate data from one another.

Keep the app data directory, Hermes token/provider keys, database backups, browser profiles and conversation content private. Notification titles can appear on a device's lock screen. Cached browser data relies on the device's access controls.

To report a vulnerability, use [private vulnerability reporting](https://github.com/drewsmith-uk/herts/security/advisories/new) when available. Do not put credentials, private hostnames, task data or transcripts in a public issue. If private reporting is unavailable, open a minimal issue requesting a private contact channel without exploit details or sensitive data.

Supported fixes target the current main branch. Before installing a change, retain a private backup and a known-working build; review the setup and upgrade instructions in README.md.
