# opencode-go-usage

An OpenCode 2.1.4+ plugin that shows the remaining **OpenCode Go** subscription
limits directly in the TUI.

## What it shows

- In the footer of the home screen and the session screen:
  `Go · 5h 69% · wk 75% · mo 88%`.
  The values are remaining limits, not usage. The color reflects the worst
  window: green at ≥ 50%, yellow at 20–49%, red below 20%.
- The `/go` command (alias: `/golimits`) opens a dialog with all three windows,
  progress bars, used/remaining percentages, reset countdowns, and the last
  update time.

Data refreshes automatically every 60 seconds. Running `/go` again forces a
fresh request.

## Requirements

- OpenCode 2.1.4 or newer.
- An active OpenCode Console login and an OpenCode Go subscription.

No separate API key is required: the plugin uses the active `opencode`
connection.

## Installation

> **You can delegate this to an AI agent.** Any agent that can edit files and
> run shell commands can install the plugin.

Copy this prompt:

```text
Install the OpenCode plugin from https://github.com/Nezerkill/opencode-usage.
Clone it to ~/.config/opencode/plugins/opencode-go-usage, add
"./plugins/opencode-go-usage" to the plugins array in
~/.config/opencode/opencode.jsonc, run opencode reload, then verify with
opencode plugin list. Do not change unrelated configuration.
```

### 1. Clone the plugin

Global install is recommended:

```sh
mkdir -p ~/.config/opencode/plugins
git clone https://github.com/Nezerkill/opencode-usage.git \
  ~/.config/opencode/plugins/opencode-go-usage
```

If you use SSH:

```sh
git clone git@github.com:Nezerkill/opencode-usage.git \
  ~/.config/opencode/plugins/opencode-go-usage
```

If the target directory already exists, use the **Updating** section instead.

The instructions above install the plugin globally. Cloning into
`<project>/.opencode/plugins/opencode-go-usage` makes it project-local instead.

### 2. Register the plugin

Add the plugin directory to `~/.config/opencode/opencode.jsonc` (or
`opencode.json` if that is the file you use):

```jsonc
{
  "plugins": ["./plugins/opencode-go-usage"]
}
```

If the file already has a `plugins` array, add
`"./plugins/opencode-go-usage"` to it. The path is relative to the config file.

### 3. Reload OpenCode

```sh
opencode reload
```

If the plugin does not appear, restart the background service from a separate
terminal:

```sh
opencode service restart
```

### 4. Verify

```sh
opencode plugin list
```

You should see the plugin with a local source:

```text
ID                 VERSION  SOURCE
opencode-go-usage  local    /home/<you>/.config/opencode/plugins/opencode-go-usage/server.ts
```

Then start OpenCode and run `/go` (or use the command palette entry
**OpenCode Go: limits**).

### Windows (PowerShell)

```powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE\.config\opencode\plugins" | Out-Null
git clone https://github.com/Nezerkill/opencode-usage.git "$env:USERPROFILE\.config\opencode\plugins\opencode-go-usage"
```

Then add the same entry to `%USERPROFILE%\.config\opencode\opencode.jsonc` and
run `opencode reload`.

### Custom location

You can clone the repository anywhere and register the absolute path:

```jsonc
{
  "plugins": ["/absolute/path/to/opencode-usage"]
}
```

### Updating

```sh
git -C ~/.config/opencode/plugins/opencode-go-usage pull --ff-only
opencode reload
```

## Data source

`GET https://opencode.ai/zen/go/v1/usage` (fallback:
`https://opencode.ai/inference/go/v1/usage`).

The request uses the Bearer token of the active `opencode` connection and the
`x-opencode-org-id` header when the organization is known. The server-side
cache is 60 seconds.

## Errors

| Footer | What to do |
| --- | --- |
| `Go · no login` | Sign in to OpenCode via `/connect`. |
| `Go · no subscription` | Activate OpenCode Go in the Console. |
| `Go · error` | Open `/go` for the full message; check your network and the log. |

Plugin load log: `~/.local/share/opencode/log/opencode.log`.

## Disabling and uninstalling

The plugin has two IDs: the server part `opencode-go-usage` and the TUI part
`opencode-go-usage.tui`. To disable everything without deleting it, add both to
the `plugins` array in `~/.config/opencode/opencode.jsonc`:

```jsonc
{
  "plugins": ["-opencode-go-usage", "-opencode-go-usage.tui"]
}
```

To uninstall completely, remove `"./plugins/opencode-go-usage"` from the
`plugins` array and delete the directory:

```sh
rm -rf ~/.config/opencode/plugins/opencode-go-usage
opencode reload
```

## Development

The plugin directory has no `package.json` and no `node_modules`: the host
resolves `@opencode/plugin`, `solid-js`, and `@opentui/*` itself.

Tests:

```sh
cd ~/.config/opencode/plugins/opencode-go-usage
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test test/*.test.ts
```

Syntax check:

```sh
npx --yes esbuild@0.25.0 server.ts service.ts rpc.ts usage.ts tui.tsx \
  --bundle --outdir=/tmp/opencode/go-usage-check --format=esm \
  '--external:@opencode/*' --external:solid-js '--external:@opentui/*'
```

Live RPC check:

```sh
opencode api post /api/rpc/opencode-go-usage/get --data '{"input":{"force":true}}'
```
