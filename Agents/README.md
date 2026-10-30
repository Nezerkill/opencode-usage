# opencode-go-usage — архитектура

## Назначение

Плагин показывает остаток лимитов OpenCode Go в TUI OpenCode: компактную строку
в футере и подробный диалог по `/go`.

## Файлы

| Файл | Ответственность |
| --- | --- |
| `usage.ts` | Чистые функции: парсинг ответа, форматирование, HTTP-запрос `fetchUsage`, коды ошибок, типы `UsageSnapshot` и `UsageError`. Не импортирует host-модули. |
| `service.ts` | Серверная логика без host-зависимостей: `resolveUsageCredential` (OAuth/key/external, orgID, cache key) и `createUsageService` (кэш 60 секунд, force, инвалидация при auth-ошибках). |
| `rpc.ts` | Контракт RPC `opencode-go-usage`, метод `get`. Схемы входа/выхода/ошибок. |
| `server.ts` | Тонкая host-обвязка: передаёт `ctx.integration.connection` в `service.ts`, регистрирует RPC. |
| `tui.tsx` | TUI-часть: сигнал состояния, футер в `home.footer.status` и `prompt.footer.status`, команда `/go`, диалог. |
| `test/*.test.ts` | Юнит-тесты `usage.ts` через встроенный runner Node 24. |

## Подключение

Плагин зарегистрирован в `~/.config/opencode/opencode.jsonc` как
`"./plugins/opencode-go-usage"`. Это даёт стабильный server ID `opencode-go-usage`;
TUI-часть использует отдельный ID `opencode-go-usage.tui`. Для полного отключения
нужны оба ID.

## Поток данных

```text
TUI (tui.tsx)
  → context.client.rpc(GoUsageRpc).get({ force })
  → сервер (server.ts)
  → ctx.integration.connection.active("opencode")
  → ctx.integration.connection.resolve(connection)
  → resolveUsageCredential(...)  (service.ts)
  → createUsageService(...).get(force)  (service.ts)
  → fetchUsage({ token, orgID })  (usage.ts)
  → https://opencode.ai/zen/go/v1/usage (fallback /inference/go/v1/usage)
  → parseUsage → UsageSnapshot
  → кэш 60 000 мс по cacheKey (connection + orgID)
  → RPC output
  → футер / диалог
```

## Инварианты

- `percent` из API — использованный процент. Футер и диалог показывают остаток
  `100 - percent`; в диалоге дополнительно указано использованное значение.
- Токен и заголовок `Authorization` никогда не логируются и не возвращаются в RPC.
- Поддерживаются credential типов `oauth` (`value.access`) и `key` (`value.key`);
  `external` даёт `not_connected`.
- `x-opencode-org-id` берётся из `credential.metadata.orgID`, если он есть.
- 401 → `auth_failed`, 403 → `not_subscribed`, остальные HTTP/сетевые ошибки →
  `request_failed`, неверная схема/JSON → `invalid_response`.
- В папке плагина нет `package.json` и `node_modules`: host резолвит
  `@opencode/plugin`, `solid-js`, `@opentui/*`. Это предотвращает дублирование Solid.
- Кэш и автообновление — 60 секунд. Кэш привязан к `cacheKey` (подключение + orgID),
  а ошибки `auth_failed`/`not_subscribed`/`not_connected` его сбрасывают.
  `/go` передаёт `force: true` и обходит кэш.
- Таймаут запроса — 10 секунд. `TimeoutError`/abort при fetch и при чтении body
  маппится в `request_failed`, а не в `invalid_response`.
- Ошибка RPC не должна ломать TUI: футер всегда рендерит `<text>`, полный текст
  ошибки доступен в `/go`. Короткая подпись футера выбирается по коду ошибки
  (`usageErrorCode` + `footerErrorLabel`), а не по тексту сообщения.

## Проверка

```sh
cd ~/.config/opencode/plugins/opencode-go-usage
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test test/*.test.ts
opencode api post /api/rpc/opencode-go-usage/get --data '{"input":{"force":true}}'
```

`test/service.test.ts` покрывает credential-типы, cache key, TTL, force и сброс кэша
при auth-ошибках без host-зависимостей. Типчек выполняется во временной папке с
`@opencode/plugin@2.1.4`; в самом плагине `node_modules` не создаётся.

## Ограничения

- Не является биллингом: не показывает счета, историю и разбивку по моделям.
- План (Go / Go Plus / Go Teams) из endpoint не известен, поэтому не отображается.
- Рассчитан на активное подключение `opencode`; другие провайдеры не затрагивает.
