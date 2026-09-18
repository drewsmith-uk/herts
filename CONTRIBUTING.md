# Contributing

Use a separate checkout and synthetic fixtures. Install locked dependencies with `npm ci`, then run the build/unit, installer and browser checks documented in [testing](docs/testing.md).

Keep agent execution deliberate. Viewing, organising or completing tasks must not create/resume/send/stop Hermes work. Preserve durable request IDs, uncertain-outcome handling and old-client storage/API compatibility. Never add model/provider secrets to browser code or `VITE_*` configuration.

Avoid personal deployment defaults in examples and tests. Do not commit local environment files, production databases, transcripts, recordings, traces or screenshots. Review `git diff --cached` and run a redacted secret scan before sharing changes.

Explain the problem, the resulting behaviour and meaningful validation in pull requests. Contributions are licensed under the repository's MIT licence.
