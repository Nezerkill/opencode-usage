# opencode-go-usage — architecture

## Purpose

The plugin shows the remaining OpenCode Go limits in the OpenCode TUI: a compact
footer line and a detailed `/go` dialog.

## Files

| File | Responsibility |
| --- | --- |
| `usage.ts` | Pure functions: response parsing, formatting, the `fetchUsage` HTTP call, error codes, and the `UsageSnapshot`/`UsageError` types. It does not import host modules. |
| `service.ts` | Host-free server logic: `resolveUsageCredential` (OAuth/key/external, orgID, cache key) and `createUsageService` (60-second cache, force, invalidation on auth errors). |
| `rpc.ts` | RPC contract `opencode-go-usage`, method `get`, input/output/error schemas. |
| `server.ts` | Thin host wiring: passes `ctx.integration.connection` into `service.ts` and registers the RPC. |
| `tui.tsx` | TUI part: state signal, footer in `home.footer.status` and `prompt.footer.status`, `/go` command, dialog. |
| `test/*.test.ts` | Unit tests for `usage.ts` and `service.ts` using the built-in Node 24 runner. |

## Registration

The plugin is registered in `~/.config/opencode/opencode.jsonc` as
`"./plugins/opencode-go-usage"`. This gives it the stable server ID
`opencode-go-usage`; the TUI part uses a separate ID, `opencode-go-usage.tui`.
Disabling the plugin completely requires both IDs.

## Data flow

```text
TUI (tui.tsx)
  → context.client.rpc(GoUsageRpc).get({ force })
  → server (server.ts)
  → ctx.integration.connection.active("opencode")
  → ctx.integration.connection.resolve(connection)
  → resolveUsageCredential(...)  (service.ts)
  → createUsageService(...).get(force)  (service.ts)
  → fetchUsage({ token, orgID })  (usage.ts)
  → https://opencode.ai/zen/go/v1/usage (fallback /inference/go/v1/usage)
  → parseUsage → UsageSnapshot
  → 60 000 ms cache keyed by cacheKey (connection + orgID)
  → RPC output
  → footer / dialog
```

## Invariants

- The API `percent` value is usage, not remaining. The footer and dialog show
  `100 - percent`; the dialog also shows the used value.
- The token and the `Authorization` header are never logged or returned over RPC.
- Credential types `oauth` (`value.access`) and `key` (`value.key`) are supported;
  `external` produces `not_connected`.
- `x-opencode-org-id` comes from `credential.metadata.orgID` when present.
- 401 → `auth_failed`; 403 → `not_subscribed`; other HTTP/network errors →
  `request_failed`; malformed JSON/schema → `invalid_response`.
- The plugin directory has no `package.json` or `node_modules`: the host resolves
  `@opencode/plugin`, `solid-js`, and `@opentui/*`. This prevents duplicate Solid
  instances.
- Cache and auto-refresh are 60 seconds. The cache is keyed by `cacheKey`
  (connection + orgID), and `auth_failed`/`not_subscribed`/`not_connected` clear it.
  `/go` passes `force: true` and bypasses the cache.
- The request timeout is 10 seconds. `TimeoutError`/abort during fetch or body
  reading maps to `request_failed`, not `invalid_response`.
- RPC errors must not break the TUI: the footer always renders `<text>`, and the
  full message is available in `/go`. The short footer label is chosen by error
  code (`usageErrorCode` + `footerErrorLabel`), not by message text.

## Verification

```sh
cd ~/.config/opencode/plugins/opencode-go-usage
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test test/*.test.ts
opencode api post /api/rpc/opencode-go-usage/get --data '{"input":{"force":true}}'
```

`test/service.test.ts` covers credential types, cache key, TTL, force, and cache
clearing on auth errors without host dependencies. Typechecking runs in a temporary
directory with `@opencode/plugin@2.1.4`; the plugin itself does not create
`node_modules`.

## Limitations

- Not a billing tool: it does not show invoices, history, or a per-model breakdown.
- The plan name (Go / Go Plus / Go Teams) is not exposed by the endpoint, so it is
  not displayed.
- It targets the active `opencode` connection and does not affect other providers.
