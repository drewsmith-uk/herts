# Contributing

Use a separate checkout and synthetic fixtures.
Install locked dependencies with `npm ci`.
Run the checks in the [testing guide](docs/testing.md).

Use **ASD-STE100 Simplified Technical English** for all project documentation.
Read the [writing guide](docs/documentation-style.md) before you write or edit documentation.
Run `npm run check:docs` after changes.
Review vocabulary and meaning separately from the automatic check.
The root [AGENTS.md](AGENTS.md) applies this rule to future coding-agent tasks without another reminder.

Keep agent execution under user control.
Viewing, organising, or completing tasks must not create, resume, send, or stop Hermes work.
Preserve durable request IDs and handling for uncertain outcomes.
Keep storage and APIs compatible with older clients.
Never add model or provider secrets to browser code or `VITE_*` configuration.

Use example deployment values in examples and tests.
Do not commit local environment files, production databases, transcripts, recordings, traces, or screenshots.
Review `git diff --cached` before you share changes.
Run a secret scan with its values redacted.

Explain the problem, resulting behaviour, and relevant checks in pull requests.
Contributions use the repository's MIT licence.
