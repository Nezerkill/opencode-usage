# OpenCode Go Usage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Показывать остаток лимитов OpenCode Go в футере TUI и в диалоге `/go`.

**Architecture:** Локальный пакет плагина без `package.json`: entrypoint `server.ts` связывает host-контекст с `service.ts` (credential resolution, кэш, RPC output); `rpc.ts` описывает контракт; TUI-часть (`tui.tsx`) рендерит футер, команду `/go` и диалог. Чистые функции парсинга, форматирования и HTTP-слоя живут в `usage.ts`.

**Tech Stack:** OpenCode 2.1.4 plugin API, TypeScript, SolidJS, OpenTUI, Node 24 built-in test runner.

**Spec:** `~/.config/opencode/plugins/opencode-go-usage/docs/superpowers/specs/2026-10-31-opencode-go-usage-design.md`

## Global Constraints

- Целевая версия OpenCode: `2.1.4`; API плагина: `@opencode/plugin@2.1.4`.
- Корень плагина: `~/.config/opencode/plugins/opencode-go-usage/`.
- Не создавать `package.json` и `node_modules` в папке плагина: host сам резолвит `@opencode/plugin`, `solid-js`, `@opentui/*`.
- Файлы плагина лежат в корне: `server.ts` (entrypoint), `service.ts`, `rpc.ts`, `tui.tsx`, `usage.ts`; тесты — в `test/`.
- UI-тексты на английском; код и идентификаторы на английском. (Исторические русские строки в примерах ниже заменены на английские в финальной реализации; источник истины — код и README.)
- Endpoint: `https://opencode.ai/zen/go/v1/usage`, fallback `https://opencode.ai/inference/go/v1/usage`.
- Кэш сервера: 60 000 мс. Автообновление TUI: 60 000 мс. `/go` передаёт `force: true`.
- Проценты в API — использованные. В футере показывать остаток `100 - percent`.
- Никаких git-операций: папка не является git-репозиторием.
- Не выводить токены, заголовки Authorization и содержимое credential в логи, тесты и ответы.
- Не перезапускать общий OpenCode service изнутри агентской сессии: это может прервать текущую сессию. Полагаться на hot reload; если RPC не зарегистрировался, попросить пользователя выполнить `opencode service restart` в отдельном терминале.

## Review Focus

- Credential `opencode` — OAuth, а не API key: токен брать из `value.access`, для `value.type === "key"` — из `value.key`; `external` должен давать `not_connected`.
- `x-opencode-org-id` обязателен для нескольких организаций: брать `orgID` из `credential.metadata`, не хардкодить.
- 401 и 403 — разные ошибки: `auth_failed` против `not_subscribed`; обе должны быть понятны в футере и диалоге.
- `percent` — расход, не остаток: `footerText` и шкалы должны показывать `100 - percent`.
- Футер не должен падать при загрузке, таймауте, отсутствии входа или неожиданном ответе: всегда возвращать `<text>`.
- Время сброса должно корректно переходить через часы, дни и отрицательные значения (`сейчас`).

---

### Task 1: Чистые функции usage и их тесты

**Files:**
- Create: `~/.config/opencode/plugins/opencode-go-usage/usage.ts`
- Create: `~/.config/opencode/plugins/opencode-go-usage/test/usage.test.ts`

**Interfaces:**
- Produces:
  - `type WindowID = "rolling" | "weekly" | "monthly"`
  - `type WindowStatus = "ok" | "rate-limited"`
  - `interface UsageWindow { status: WindowStatus; percent: number; resetsAt: string }`
  - `interface UsageSnapshot { fetchedAt: number; windows: Record<WindowID, UsageWindow> }`
  - `class UsageParseError extends Error`
  - `const WINDOW_IDS: readonly WindowID[]`
  - `const WINDOW_LABELS: Record<WindowID, string>` (`"5 часов"`, `"неделя"`, `"месяц"`)
  - `const WINDOW_SHORT_LABELS: Record<WindowID, string>` (`"5ч"`, `"нед"`, `"мес"`)
  - `parseUsage(payload: unknown, fetchedAt?: number): UsageSnapshot`
  - `remainingPercent(percent: number): number`
  - `worstRemaining(snapshot: UsageSnapshot): number`
  - `toneFor(remaining: number): "good" | "warn" | "bad"`
  - `progressBar(remaining: number, width?: number): string`
  - `formatReset(resetsAt: string, now?: number): string`
  - `footerText(snapshot: UsageSnapshot): string`

- [ ] **Step 1: Write the failing tests**

Create `test/usage.test.ts`:

```ts
import test from "node:test"
import assert from "node:assert/strict"
import {
  UsageParseError,
  footerText,
  formatReset,
  parseUsage,
  progressBar,
  remainingPercent,
  toneFor,
  worstRemaining,
} from "../usage.ts"

const payload = {
  usage: {
    rolling: { status: "ok", percent: 31, resetsAt: "2026-10-31T02:48:27.000Z" },
    weekly: { status: "rate-limited", percent: 100, resetsAt: "2026-11-02T00:00:00.000Z" },
    monthly: { status: "ok", percent: 12, resetsAt: "2026-11-29T21:47:14.000Z" },
  },
}

test("parseUsage parses windows and clamps percent", () => {
  const snapshot = parseUsage(payload, 1000)
  assert.equal(snapshot.fetchedAt, 1000)
  assert.equal(snapshot.windows.rolling.percent, 31)

  const clamped = parseUsage({
    usage: { ...payload.usage, rolling: { ...payload.usage.rolling, percent: 140 } },
  })
  assert.equal(clamped.windows.rolling.percent, 100)
})

test("parseUsage rejects invalid payloads", () => {
  assert.throws(() => parseUsage({}), UsageParseError)
  assert.throws(
    () => parseUsage({ usage: { rolling: {}, weekly: {}, monthly: {} } }),
    UsageParseError,
  )
})

test("remaining and footer text show remaining, not used", () => {
  const snapshot = parseUsage(payload)
  assert.equal(remainingPercent(31), 69)
  assert.equal(footerText(snapshot), "Go · 5ч 69% · нед 0% · мес 88%")
})

test("worst remaining and tone use thresholds 50 and 20", () => {
  const snapshot = parseUsage(payload)
  assert.equal(worstRemaining(snapshot), 0)
  assert.equal(toneFor(50), "good")
  assert.equal(toneFor(49.9), "warn")
  assert.equal(toneFor(20), "warn")
  assert.equal(toneFor(19.9), "bad")
})

test("formatReset renders Russian durations", () => {
  const now = Date.parse("2026-10-31T00:00:00.000Z")
  assert.equal(formatReset("2026-10-31T00:00:20.000Z", now), "сейчас")
  assert.equal(formatReset("2026-10-31T00:05:00.000Z", now), "5м")
  assert.equal(formatReset("2026-10-31T02:15:00.000Z", now), "2ч 15м")
  assert.equal(formatReset("2026-11-03T04:00:00.000Z", now), "3д 4ч")
})

test("progressBar fills proportionally", () => {
  assert.equal(progressBar(100, 10), "██████████")
  assert.equal(progressBar(0, 10), "░░░░░░░░░░")
  assert.equal(progressBar(69, 10), "███████░░░")
})
```

- [ ] **Step 2: Run the tests and verify they fail**

Run:

```sh
cd ~/.config/opencode/plugins/opencode-go-usage
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test test/usage.test.ts
```

Expected: FAIL because `usage.ts` does not exist (module not found).

- [ ] **Step 3: Implement `usage.ts`**

Implement exactly the exported signatures from the Interfaces block. Parsing rules:

- `parseUsage` requires `payload.usage` to be an object with all three windows.
- `status` must be `"ok"` or `"rate-limited"`.
- `percent` must be a finite number; clamp it to `0..100`.
- `resetsAt` must be a string that `Date.parse` accepts.
- Any violation throws `UsageParseError` with the window name in the message.
- `remainingPercent` clamps the input and returns `100 - percent`.
- `toneFor`: `≥ 50` → `"good"`, `≥ 20` → `"warn"`, otherwise `"bad"`.
- `progressBar` clamps `remaining` to `0..100` and `width` to a non-negative integer; filled characters use `█`, empty use `░`.
- `formatReset`: `< 60s` → `"сейчас"`; `< 60m` → `"Nм"`; `< 24h` → `"Nч Mм"` (omit `Mм` when zero); otherwise `"Nд Mч"` (omit `Mч` when zero). Past timestamps → `"сейчас"`.
- `footerText` uses short labels and `Math.round(remainingPercent(...))`.

- [ ] **Step 4: Run the tests and verify they pass**

Run:

```sh
cd ~/.config/opencode/plugins/opencode-go-usage
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test test/usage.test.ts
```

Expected: PASS for all 6 tests.

---

### Task 2: HTTP-слой и серверный RPC

**Files:**
- Modify: `~/.config/opencode/plugins/opencode-go-usage/usage.ts`
- Create: `~/.config/opencode/plugins/opencode-go-usage/service.ts` (execution ruling: host-free credential/cache logic for testability)
- Create: `~/.config/opencode/plugins/opencode-go-usage/test/fetch.test.ts`
- Create: `~/.config/opencode/plugins/opencode-go-usage/test/service.test.ts`
- Create: `~/.config/opencode/plugins/opencode-go-usage/rpc.ts`
- Create: `~/.config/opencode/plugins/opencode-go-usage/server.ts`

**Interfaces:**
- Consumes: all types and functions from Task 1.
- Produces:
  - `type UsageErrorCode = "not_connected" | "not_subscribed" | "auth_failed" | "request_failed" | "invalid_response"`
  - `class UsageError extends Error { readonly code: UsageErrorCode; readonly status?: number }`
  - `fetchUsage(options: { token: string; orgID?: string; fetchImpl?: typeof fetch; now?: () => number; timeoutMs?: number }): Promise<UsageSnapshot>`
  - `const GoUsageRpc` — RPC definition with id `"opencode-go-usage"`, method `get`, input `{ force?: boolean }`, output `{ fetchedAt: number; windows: Record<WindowID, UsageWindow> }`, errors with the five codes above.
  - Default server plugin `Plugin.define({ id: "opencode-go-usage", setup })`.

- [ ] **Step 1: Write the failing HTTP tests**

Create `test/fetch.test.ts`:

```ts
import test from "node:test"
import assert from "node:assert/strict"
import { UsageError, fetchUsage } from "../usage.ts"

const okPayload = {
  usage: {
    rolling: { status: "ok", percent: 31, resetsAt: "2026-10-31T02:48:27.000Z" },
    weekly: { status: "ok", percent: 25, resetsAt: "2026-11-02T00:00:00.000Z" },
    monthly: { status: "ok", percent: 12, resetsAt: "2026-11-29T21:47:14.000Z" },
  },
}

function response(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

test("fetchUsage sends bearer and org headers", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const snapshot = await fetchUsage({
    token: "token-123",
    orgID: "org-1",
    now: () => 42,
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init })
      return response(200, okPayload)
    },
  })

  assert.equal(snapshot.fetchedAt, 42)
  assert.equal(calls[0].url, "https://opencode.ai/zen/go/v1/usage")
  const headers = new Headers(calls[0].init?.headers)
  assert.equal(headers.get("authorization"), "Bearer token-123")
  assert.equal(headers.get("x-opencode-org-id"), "org-1")
})

test("fetchUsage falls back to the inference URL on 404", async () => {
  const urls: string[] = []
  await fetchUsage({
    token: "t",
    fetchImpl: async (url) => {
      urls.push(String(url))
      return urls.length === 1 ? response(404, {}) : response(200, okPayload)
    },
  })

  assert.deepEqual(urls, [
    "https://opencode.ai/zen/go/v1/usage",
    "https://opencode.ai/inference/go/v1/usage",
  ])
})

test("fetchUsage maps status codes to UsageError", async () => {
  const cases = [
    [401, "auth_failed"],
    [403, "not_subscribed"],
    [500, "request_failed"],
  ] as const

  for (const [status, code] of cases) {
    await assert.rejects(
      () => fetchUsage({ token: "t", fetchImpl: async () => response(status, {}) }),
      (error) => error instanceof UsageError && error.code === code,
    )
  }
})

test("fetchUsage maps network and parse failures", async () => {
  await assert.rejects(
    () =>
      fetchUsage({
        token: "t",
        fetchImpl: async () => {
          throw new DOMException("aborted", "AbortError")
        },
      }),
    (error) => error instanceof UsageError && error.code === "request_failed",
  )

  await assert.rejects(
    () => fetchUsage({ token: "t", fetchImpl: async () => response(200, {}) }),
    (error) => error instanceof UsageError && error.code === "invalid_response",
  )
})
```

- [ ] **Step 2: Run the new tests and verify they fail**

Run:

```sh
cd ~/.config/opencode/plugins/opencode-go-usage
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test test/fetch.test.ts
```

Expected: FAIL because `UsageError` and `fetchUsage` are not exported.

- [ ] **Step 3: Implement `fetchUsage` and `UsageError` in `usage.ts`**

Behavior:

- Try `https://opencode.ai/zen/go/v1/usage` first, then `https://opencode.ai/inference/go/v1/usage` only on HTTP 404.
- Headers: `Authorization: Bearer <token>` and `x-opencode-org-id: <orgID>` when `orgID` is present.
- Timeout: `timeoutMs ?? 10_000` via `AbortSignal.timeout`.
- 401 → `UsageError("auth_failed", "Вход в OpenCode недействителен. Подключитесь заново через /connect.")`
- 403 → `UsageError("not_subscribed", "У аккаунта нет активной подписки OpenCode Go.")`
- Other non-2xx → `UsageError("request_failed", "OpenCode Go вернул HTTP <status>.")`
- JSON parse or `parseUsage` failure → `UsageError("invalid_response", "OpenCode Go вернул неожиданный ответ.")`
- Fetch rejection: `AbortError`/timeout → `request_failed` with a timeout message; other network errors → `request_failed` with the error message.
- Never include the token in an error message.

- [ ] **Step 4: Run all tests and verify they pass**

Run:

```sh
cd ~/.config/opencode/plugins/opencode-go-usage
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test test/*.test.ts
```

Expected: PASS for all 10 tests.

- [ ] **Step 5: Write the RPC contract**

Create `rpc.ts`:

- Import `Rpc` from `@opencode/plugin/rpc`.
- Define `GoUsageRpc` with `id: "opencode-go-usage"` and `events: {}`.
- Method `get`:
  - Input JSON Schema: object, optional boolean `force`, no additional properties.
  - Output JSON Schema: object with required `fetchedAt` (number) and `windows` (object with required `rolling`, `weekly`, `monthly`; each window has required `status` enum `["ok","rate-limited"]`, `percent` number 0..100, `resetsAt` string; no additional properties).
  - Errors: `not_connected`, `not_subscribed`, `auth_failed`, `request_failed`, `invalid_response`; each maps to an empty object schema (`type: "object", properties: {}, additionalProperties: false`).

- [ ] **Step 6: Write the server plugin**

Create `server.ts`:

- Import `Plugin` from `@opencode/plugin`, `GoUsageRpc` from `./rpc.ts`, and `UsageError`, `fetchUsage`, `UsageSnapshot` from `./usage.ts`.
- `Plugin.define({ id: "opencode-go-usage", async setup(ctx) { ... } })`.
- Inside setup keep `let cache: { snapshot: UsageSnapshot; expiresAt: number } | undefined`.
- `getSnapshot(force: boolean)`:
  - Return cache when `!force && cache.expiresAt > Date.now()`.
  - `const connection = await ctx.integration.connection.active("opencode")`; if absent throw `UsageError("not_connected", "Нет активного подключения OpenCode. Войдите через /connect.")`.
  - `const credential = await ctx.integration.connection.resolve(connection)`; if absent throw `not_connected`.
  - Token: `credential.type === "oauth" ? credential.access : credential.type === "key" ? credential.key : undefined`; if absent throw `not_connected` with a message about unsupported connection type.
  - Org ID: `credential.metadata?.orgID` when it is a string.
  - `const snapshot = await fetchUsage({ token, orgID })`; store cache with 60_000 ms expiry; return snapshot.
- Register `ctx.rpc.register(GoUsageRpc, { get: async (input, context) => { ... } })`:
  - Read `force` from input when it is a boolean, otherwise `false`.
  - `try { return await getSnapshot(force) } catch (error) { ... }`.
  - `UsageError` → `return context.error(error.code, error.message, {})`.
  - Any other error → `return context.error("request_failed", "Не удалось получить лимиты OpenCode Go.", {})`.
  - Do not log the token or credential.

- [ ] **Step 7: Check syntax of server files**

Run:

```sh
cd ~/.config/opencode/plugins/opencode-go-usage
npx --yes esbuild@0.25.0 server.ts rpc.ts usage.ts --outdir=/tmp/opencode/go-usage-server-check --format=esm --external:@opencode/*
```

Expected: build succeeds with no syntax errors.

- [ ] **Step 8: Verify the server RPC end-to-end**

Do not restart the shared service from inside the agent session. Wait for OpenCode's config watcher to load the new plugin directory, then run:

```sh
opencode api post /api/rpc/opencode-go-usage/get --data '{"input":{"force":true}}'
```

Expected: JSON containing `"fetchedAt"` and `"windows"` with `rolling`, `weekly`, `monthly`.

If the response is 404, check the plugin log:

```sh
grep -i "opencode-go-usage" ~/.local/share/opencode/log/opencode.log | tail -20
```

If the plugin is not loaded, ask the user to run `opencode service restart` in a separate terminal, then repeat the RPC call.

---

### Task 3: TUI-часть

**Files:**
- Create: `~/.config/opencode/plugins/opencode-go-usage/tui.tsx`

**Interfaces:**
- Consumes: `GoUsageRpc`, `UsageSnapshot`, `WINDOW_IDS`, `WINDOW_LABELS`, `footerText`, `formatReset`, `progressBar`, `remainingPercent`, `toneFor`, `worstRemaining`.
- Produces: default TUI plugin `Plugin.define({ id: "opencode-go-usage.tui", setup })`.

- [ ] **Step 1: Implement the TUI plugin**

Create `tui.tsx` with:

- Imports from `@opencode/plugin/tui`: `Plugin`, `usePlugin`.
- Imports from `solid-js`: `For`, `createSignal`.
- RPC client: `const rpc = context.client.rpc(GoUsageRpc)`.
- State union: `{ kind: "loading" } | { kind: "ready"; snapshot: UsageSnapshot } | { kind: "error"; message: string }`.
- `refresh(force: boolean)` calls `rpc.get({ force })`, sets ready state, catches errors into `error` state, and never throws.
- Footer component returns one `<text>` with `fg` from the worst window:
  - `toneFor(worstRemaining(snapshot)) === "good"` → `context.theme.text.feedback.success.base`
  - `"warn"` → `context.theme.text.feedback.warning.base`
  - `"bad"` → `context.theme.text.feedback.error.base`
  - loading/error → `context.theme.text.muted` or error color.
- Footer text:
  - loading: `Go · загрузка…`
  - ready: `footerText(snapshot)`
  - error: `Go · нет входа`, `Go · нет подписки` or `Go · ошибка` (short mapping; full message only in the dialog).
- Register two slots: `append: "home.footer.status"` and `append: "prompt.footer.status"`, both render the Footer component. Save the returned unsubscribe functions.
- Register a keymap layer with one command:
  - `id: "opencode-go-usage.show"`, `title: "OpenCode Go: лимиты"`, `group: "OpenCode Go"`, `palette: true`, `slash: { name: "go", aliases: ["golimits"] }`.
  - `run` calls `refresh(true)`; on failure shows `context.ui.dialog.alert({ title: "OpenCode Go", message: <full error> })`; on success shows the usage dialog.
- Usage dialog:
  - `context.ui.dialog.set({ size: "medium", centered: true })`.
  - `context.ui.dialog.show(() => <UsageView snapshot={snapshot} />)`.
  - `UsageView` uses `usePlugin()` and renders a column: title `OpenCode Go · лимиты`, then for each `WINDOW_IDS` a block with label and `осталось N%`, `progressBar(remaining)`, status (`ok` / `лимит исчерпан`), `использовано N% · сброс <formatReset>`, and a footer line `Данные на HH:MM · /go — обновить`.
  - Use `context.theme.text.base`, `text.muted`, and feedback colors.
- Start with `void refresh(false)`.
- Start `setInterval(() => void refresh(false), 60_000)`.
- Return a cleanup function that clears the interval and calls both slot unsubscribe functions.

- [ ] **Step 2: Check syntax of the TUI file**

Run:

```sh
cd ~/.config/opencode/plugins/opencode-go-usage
npx --yes esbuild@0.25.0 tui.tsx --outfile=/tmp/opencode/go-usage-tui-check.js --format=esm --external:@opencode/* --external:solid-js --external:@opentui/*
```

Expected: build succeeds with no syntax errors.

- [ ] **Step 3: Typecheck in a temporary project**

Do not install packages into the plugin directory. Use `/tmp/opencode/go-usage-typecheck`:

```sh
rm -rf /tmp/opencode/go-usage-typecheck
mkdir -p /tmp/opencode/go-usage-typecheck/src
cp ~/.config/opencode/plugins/opencode-go-usage/usage.ts /tmp/opencode/go-usage-typecheck/src/
cp ~/.config/opencode/plugins/opencode-go-usage/rpc.ts /tmp/opencode/go-usage-typecheck/src/
cp ~/.config/opencode/plugins/opencode-go-usage/server.ts /tmp/opencode/go-usage-typecheck/src/
cp ~/.config/opencode/plugins/opencode-go-usage/tui.tsx /tmp/opencode/go-usage-typecheck/src/
cd /tmp/opencode/go-usage-typecheck
npm init -y >/dev/null
npm install --no-audit --no-fund --save-dev @opencode/plugin@2.1.4 @opencode/client@2.1.4 @opencode/theme@2.1.4 @opentui/core@0.6.8 @opentui/solid@0.6.8 solid-js@1.9.15 typescript@5.9.3 @types/node@24.12.2
```

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "preserve",
    "jsxImportSource": "@opentui/solid",
    "strict": true,
    "noEmit": true,
    "allowImportingTsExtensions": true,
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": ["src/**/*.ts", "src/**/*.tsx"]
}
```

Run:

```sh
npx tsc -p tsconfig.json
```

Expected: no output, exit code 0. Fix type errors in the plugin source and repeat the copy and typecheck.

- [ ] **Step 4: Re-run all tests**

```sh
cd ~/.config/opencode/plugins/opencode-go-usage
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test test/*.test.ts
```

Expected: PASS for all 10 tests.

- [ ] **Step 5: Smoke-test the TUI**

If a PTY is available, start the TUI briefly and inspect logs:

```sh
timeout 6s script -qec "opencode" /dev/null >/tmp/opencode/go-usage-tui-smoke.log 2>&1 || true
grep -i "opencode-go-usage" ~/.local/share/opencode/log/opencode.log | tail -20
```

Expected: no `error`/`failed` entries for the plugin. If the TUI cannot start non-interactively, record that and ask the user to open OpenCode and check the footer plus `/go`. Do not claim a visual pass without evidence.

---

### Task 4: Документация и финальная проверка

**Files:**
- Create: `~/.config/opencode/plugins/opencode-go-usage/README.md`
- Create: `~/.config/opencode/plugins/opencode-go-usage/CHANGELOG.md`
- Create: `~/.config/opencode/plugins/opencode-go-usage/Agents/README.md`

- [ ] **Step 1: Write README.md**

Include:

- What the plugin shows: 5-hour, weekly, monthly remaining limits in the footer and `/go`.
- Requirements: OpenCode 2.1.4+, active OpenCode Console login with an OpenCode Go subscription.
- Install: files live in `~/.config/opencode/plugins/opencode-go-usage/` and load automatically.
- Data source and refresh behavior.
- Troubleshooting: `Go · нет входа` → `/connect`; `Go · нет подписки` → activate Go; RPC 404 → `opencode service restart` in a separate terminal.
- Disable: add `"-opencode-go-usage"` to the `plugins` array in `~/.config/opencode/opencode.jsonc`, or move the directory out of the plugins folder.

- [ ] **Step 2: Write CHANGELOG.md**

Add one entry:

```md
# Changelog

## 0.1.0 — 2026-10-31

- Initial release: footer usage indicator and `/go` dialog.
- Server-side credential resolution and 60-second cache.
- Graceful handling of missing login, missing Go subscription, network errors, and invalid responses.
```

- [ ] **Step 3: Write Agents/README.md**

Describe:

- File responsibilities (`server.ts`, `rpc.ts`, `tui.tsx`, `usage.ts`).
- Data flow: TUI → RPC → credential resolve → usage endpoint → cache → TUI.
- Invariants: percent is used, footer shows remaining; no secrets in logs; no `package.json`; host resolves imports; 60-second cache/refresh.
- How to run tests and the RPC smoke check.

- [ ] **Step 4: Run the final checks**

```sh
cd ~/.config/opencode/plugins/opencode-go-usage
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test test/*.test.ts
npx --yes esbuild@0.25.0 server.ts rpc.ts usage.ts tui.tsx --outdir=/tmp/opencode/go-usage-final-check --format=esm --external:@opencode/* --external:solid-js --external:@opentui/*
opencode api post /api/rpc/opencode-go-usage/get --data '{"input":{"force":true}}'
```

Expected:

- All tests pass.
- esbuild exits 0.
- RPC returns JSON with `fetchedAt` and the three windows.

- [ ] **Step 5: Report the manual check**

Ask the user to open OpenCode and verify:

- Footer shows `Go · 5ч …% · нед …% · мес …%`.
- `/go` opens the dialog with three windows, bars, reset times, and refresh hint.
- No plugin errors appear in `~/.local/share/opencode/log/opencode.log`.

Do not claim the visual check passed unless the user confirms it.

---

## Self-Review

- Spec coverage: footer, `/go`, refresh/cache, credential resolution, endpoint fallback, error mapping, no package.json, tests, typecheck, docs — all mapped to Tasks 1–4.
- Type consistency: `UsageSnapshot`, `WindowID`, `UsageErrorCode`, `fetchUsage`, `GoUsageRpc`, `footerText`, `formatReset`, `progressBar`, `remainingPercent`, `toneFor`, `worstRemaining` are defined once and reused with the same names.
- Review Focus tests: OAuth/key/external handling is in the server setup (manual RPC check); 401/403 mapping in `test/fetch.test.ts`; percent/remaining in `test/usage.test.ts`; footer error states in the TUI implementation; reset transitions in `test/usage.test.ts`.
- No git steps: the target directory is not a repository and global instructions forbid git changes without a request.
