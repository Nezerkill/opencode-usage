import { Plugin, usePlugin } from "@opencode/plugin/tui"
import { For, createSignal } from "solid-js"
import { GoUsageRpc } from "./rpc.ts"
import {
  WINDOW_IDS,
  WINDOW_LABELS,
  footerErrorLabel,
  footerText,
  formatReset,
  progressBar,
  remainingPercent,
  toneFor,
  usageErrorCode,
  worstRemaining,
  type UsageErrorCode,
  type UsageSnapshot,
} from "./usage.ts"

type FooterState =
  | { kind: "loading" }
  | { kind: "ready"; snapshot: UsageSnapshot }
  | { kind: "error"; code?: UsageErrorCode; message: string }

function errorMessage(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof (error as { message?: unknown }).message === "string" &&
    (error as { message: string }).message.length > 0
  ) {
    return (error as { message: string }).message
  }
  return "Could not fetch OpenCode Go limits."
}

function footerLabel(state: FooterState): string {
  if (state.kind === "loading") return "Go · loading…"
  if (state.kind === "error") {
    return `Go · ${footerErrorLabel({ code: state.code, message: state.message })}`
  }
  return footerText(state.snapshot)
}

function formatClock(timestamp: number): string {
  const date = new Date(timestamp)
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`
}

function UsageView(props: { snapshot: UsageSnapshot }) {
  const context = usePlugin()

  return (
    <box flexDirection="column" padding={1}>
      <text fg={context.theme.text.base}>OpenCode Go · limits</text>
      <For each={WINDOW_IDS}>
        {(id) => {
          const window = props.snapshot.windows[id]
          const remaining = remainingPercent(window.percent)
          const tone = toneFor(remaining)
          const color =
            tone === "good"
              ? context.theme.text.feedback.success.base
              : tone === "warn"
                ? context.theme.text.feedback.warning.base
                : context.theme.text.feedback.error.base

          return (
            <box flexDirection="column" marginTop={1}>
              <text fg={context.theme.text.base}>
                {WINDOW_LABELS[id]} · {Math.round(remaining)}% left
              </text>
              <text fg={color}>
                {progressBar(remaining)}{" "}
                {window.status === "rate-limited" ? "limit reached" : "ok"}
              </text>
              <text fg={context.theme.text.muted}>
                used {Math.round(window.percent)}% · reset:{" "}
                {formatReset(window.resetsAt, Date.now())}
              </text>
            </box>
          )
        }}
      </For>
      <box marginTop={1}>
        <text fg={context.theme.text.muted}>
          Updated {formatClock(props.snapshot.fetchedAt)} · /go to refresh
        </text>
      </box>
    </box>
  )
}

export default Plugin.define({
  id: "opencode-go-usage.tui",
  setup(context) {
    const [state, setState] = createSignal<FooterState>({ kind: "loading" })
    const rpc = context.client.rpc(GoUsageRpc)
    let inFlight: Promise<UsageSnapshot | undefined> | undefined

    async function refresh(force: boolean): Promise<UsageSnapshot | undefined> {
      if (inFlight && !force) return inFlight

      const request = (async () => {
        try {
          const snapshot = (await rpc.get({ force })) as UsageSnapshot
          setState({ kind: "ready", snapshot })
          return snapshot
        } catch (error) {
          setState({
            kind: "error",
            code: usageErrorCode(error),
            message: errorMessage(error),
          })
          return undefined
        }
      })()

      inFlight = request
      try {
        return await request
      } finally {
        if (inFlight === request) inFlight = undefined
      }
    }

    function footerColor() {
      const current = state()
      if (current.kind === "error") return context.theme.text.feedback.error.base
      if (current.kind !== "ready") return context.theme.text.muted

      const tone = toneFor(worstRemaining(current.snapshot))
      if (tone === "good") return context.theme.text.feedback.success.base
      if (tone === "warn") return context.theme.text.feedback.warning.base
      return context.theme.text.feedback.error.base
    }

    function Footer() {
      return <text fg={footerColor()}>{footerLabel(state())}</text>
    }

    const stopHome = context.ui.slot({
      append: "home.footer.status",
      render: () => <Footer />,
    })
    const stopPrompt = context.ui.slot({
      append: "prompt.footer.status",
      render: () => <Footer />,
    })

    context.keymap.layer(() => ({
      mode: "global",
      priority: 10,
      commands: [
        {
          id: "opencode-go-usage.show",
          title: "OpenCode Go: limits",
          group: "OpenCode Go",
          palette: true,
          slash: { name: "go", aliases: ["golimits"] },
          run: async () => {
            const snapshot = await refresh(true)
            if (!snapshot) {
              const current = state()
              await context.ui.dialog.alert({
                title: "OpenCode Go",
                message:
                  current.kind === "error"
                    ? current.message
                    : "Could not fetch OpenCode Go limits.",
              })
              return
            }

            context.ui.dialog.set({ size: "medium", centered: true })
            context.ui.dialog.show(() => <UsageView snapshot={snapshot} />)
          },
        },
      ],
    }))

    void refresh(false)
    const timer = setInterval(() => void refresh(false), 60_000)

    return () => {
      clearInterval(timer)
      stopHome()
      stopPrompt()
    }
  },
})
