# OpenCode Go Usage — дизайн

Дата: 2026-10-31
Статус: утверждён

## Зачем

Показать остаток лимитов подписки OpenCode Go прямо в TUI OpenCode, чтобы не открывать
консоль и не проверять usage вручную.

## Что показываем

- В `home.footer.status` и `prompt.footer.status` — компактная строка:
  `Go · 5ч 69% · нед 75% · мес 88%`. Числа означают остаток, не расход.
- Цвет строки определяется худшим окном: зелёный при остатке ≥ 50%, жёлтый при 20–49%,
  красный при < 20%.
- Команда `/go` (и команда в палитре) делает свежий запрос и открывает диалог:
  три окна, шкала, процент использовано/осталось, время сброса, статус, время обновления.
- Автообновление раз в 60 секунд. Повторный `/go` — ручное обновление.
- Серверный кэш 60 секунд; `/go` передаёт `force: true` и обходит кэш.

## Архитектура

Пакет локального плагина в `~/.config/opencode/plugins/opencode-go-usage/`:

- `server.ts` — тонкая серверная обвязка: передаёт `ctx.integration.connection` в
  `service.ts` и регистрирует RPC.
- `service.ts` — серверная логика без host-зависимостей: `resolveUsageCredential`
  (OAuth/key/external, orgID, cache key) и `createUsageService` (кэш, force,
  инвалидация при auth-ошибках).
- `rpc.ts` — контракт RPC `opencode-go-usage` с методом `get`.
- `tui.tsx` — TUI-часть: сигнал состояния, футер, команда `/go`, диалог.
- `usage.ts` — чистые функции парсинга, форматирования и HTTP-запроса.

Плагин зарегистрирован в `~/.config/opencode/opencode.jsonc` как
`"./plugins/opencode-go-usage"`, чтобы иметь стабильный ID для управления.
`package.json` и `node_modules` в папке плагина не нужны: host резолвит
`@opencode/plugin`, `solid-js` и `@opentui/*` сам. Это также избегает дублирования
Solid.

## Данные

`GET https://opencode.ai/zen/go/v1/usage`, fallback на
`https://opencode.ai/inference/go/v1/usage`.

Заголовки:

- `Authorization: Bearer <access token>`
- `x-opencode-org-id: <orgID>` — если `orgID` есть в metadata credential.

Ответ:

```json
{
  "usage": {
    "rolling": { "status": "ok", "percent": 31, "resetsAt": "2026-10-31T02:48:27.000Z" },
    "weekly":  { "status": "ok", "percent": 25, "resetsAt": "2026-11-02T00:00:00.000Z" },
    "monthly": { "status": "ok", "percent": 12, "resetsAt": "2026-11-29T21:47:14.000Z" }
  }
}
```

`percent` — это использованный процент. Футер показывает `100 - percent`.
Поддерживаются credential типа `oauth` (поле `access`) и `key` (поле `key`).

## Ошибки

- Нет активного подключения `opencode` → `not_connected`.
- Credential типа `external` или без токена → `not_connected`.
- HTTP 401 → `auth_failed`.
- HTTP 403 → `not_subscribed`.
- Таймаут (включая `TimeoutError` при чтении body), сеть и прочие HTTP-ошибки →
  `request_failed`.
- Некорректный JSON или схема → `invalid_response`.
- Ошибки обновления OAuth при `connection.resolve` → `auth_failed` с подсказкой
  переподключиться; прочие ошибки получения credential → `not_connected`.
- Кэш привязан к подключению и orgID; `auth_failed`/`not_subscribed`/`not_connected`
  сбрасывают его.

В футере ошибка сокращается до `Go · нет входа`, `Go · нет подписки` или `Go · ошибка`.
В диалоге `/go` показывается полное сообщение. TUI не падает при ошибках.

## Не входит в задачу

- Биллинг, счета, история расходов.
- Разбивка по моделям.
- Отдельный API-ключ или хранение секретов.
- Изменение настроек провайдера.
- Графики и несколько аккаунтов одновременно.

## Проверка

- Юнит-тесты чистых функций и HTTP-слоя через `node --test`.
- Проверка синтаксиса `server.ts`, `rpc.ts`, `tui.tsx` через esbuild.
- Типчек в временной папке с `@opencode/plugin@2.1.4`.
- `opencode service restart` и вызов RPC через
  `opencode api post /api/rpc/opencode-go-usage/get --data '{"input":{"force":true}}'`.
- Ручная проверка футера и `/go` в TUI.
