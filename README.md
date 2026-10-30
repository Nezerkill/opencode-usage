# opencode-go-usage

Плагин для OpenCode 2.1.4+, который показывает остаток лимитов подписки **OpenCode Go**
прямо в TUI.

## Что показывает

- В футере главного экрана и сессии: `Go · 5ч 69% · нед 75% · мес 88%`.
  Числа — остаток, не расход. Цвет зависит от худшего окна: зелёный ≥ 50%,
  жёлтый 20–49%, красный < 20%.
- По команде `/go` (алиас `/golimits`) — диалог с тремя окнами, шкалами,
  процентом использовано/осталось, временем сброса и временем обновления.

Данные обновляются автоматически раз в 60 секунд. Повторный `/go` делает
принудительный запрос.

## Требования

- OpenCode 2.1.4 или новее.
- Активный вход в OpenCode Console и подписка OpenCode Go.

Отдельный API-ключ не нужен: плагин использует активное подключение `opencode`.

## Установка

Плагин уже лежит в глобальной папке:

```text
~/.config/opencode/plugins/opencode-go-usage/
```

Он также зарегистрирован в `~/.config/opencode/opencode.jsonc`:

```jsonc
{
  "plugins": ["./plugins/opencode-go-usage"]
}
```

Эта запись даёт стабильный ID `opencode-go-usage` для управления плагином.
Если переносите папку, обновите путь. Если после изменения плагин не появился,
выполните:

```sh
opencode reload
```

Если и это не помогло, перезапустите сервис в отдельном терминале:

```sh
opencode service restart
```

## Источник данных

`GET https://opencode.ai/zen/go/v1/usage` (fallback:
`https://opencode.ai/inference/go/v1/usage`).

Запрос идёт с Bearer-токеном активного подключения `opencode` и заголовком
`x-opencode-org-id`, если организация известна. Серверный кэш — 60 секунд.

## Ошибки

| В футере | Что делать |
| --- | --- |
| `Go · нет входа` | Войдите в OpenCode через `/connect`. |
| `Go · нет подписки` | Активируйте OpenCode Go в Console. |
| `Go · ошибка` | Откройте `/go` для полного текста; проверьте сеть и лог. |

Лог загрузки плагина: `~/.local/share/opencode/log/opencode.log`.

## Отключение

У плагина два ID: серверный `opencode-go-usage` и TUI-часть
`opencode-go-usage.tui`. Чтобы отключить всё, добавьте в массив `plugins` в
`~/.config/opencode/opencode.jsonc` оба:

```jsonc
{
  "plugins": ["-opencode-go-usage", "-opencode-go-usage.tui"]
}
```

Надёжный альтернативный способ — переместить папку плагина из
`~/.config/opencode/plugins/`.

## Разработка

В папке плагина нет `package.json` и `node_modules`: host сам резолвит
`@opencode/plugin`, `solid-js` и `@opentui/*`.

Тесты:

```sh
cd ~/.config/opencode/plugins/opencode-go-usage
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test test/*.test.ts
```

Проверка синтаксиса:

```sh
npx --yes esbuild@0.25.0 server.ts service.ts rpc.ts usage.ts tui.tsx \
  --bundle --outdir=/tmp/opencode/go-usage-check --format=esm \
  '--external:@opencode/*' --external:solid-js '--external:@opentui/*'
```

Проверка RPC на живом сервере:

```sh
opencode api post /api/rpc/opencode-go-usage/get --data '{"input":{"force":true}}'
```
