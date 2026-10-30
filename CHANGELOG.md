# Changelog

## 0.1.0 — 2026-10-31

- Initial release: footer usage indicator and `/go` dialog.
- Server-side credential resolution and 60-second cache keyed by connection + org.
- Graceful handling of missing login, missing Go subscription, network errors, timeouts, and invalid responses.
- Footer error labels use RPC error codes; server logic is covered by committed tests.
- English UI strings and error messages.
