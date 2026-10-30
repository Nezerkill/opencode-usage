export type WindowID = "rolling" | "weekly" | "monthly"
export type WindowStatus = "ok" | "rate-limited"

export interface UsageWindow {
  status: WindowStatus
  percent: number
  resetsAt: string
}

export interface UsageSnapshot {
  fetchedAt: number
  windows: Record<WindowID, UsageWindow>
}

export class UsageParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "UsageParseError"
  }
}

export const WINDOW_IDS = ["rolling", "weekly", "monthly"] as const

export const WINDOW_LABELS: Record<WindowID, string> = {
  rolling: "5 часов",
  weekly: "неделя",
  monthly: "месяц",
}

export const WINDOW_SHORT_LABELS: Record<WindowID, string> = {
  rolling: "5ч",
  weekly: "нед",
  monthly: "мес",
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value))
}

function parseWindow(value: unknown, id: WindowID): UsageWindow {
  if (!isRecord(value)) {
    throw new UsageParseError(`OpenCode Go: окно ${id} отсутствует или имеет неверный формат.`)
  }

  const status = value.status
  if (status !== "ok" && status !== "rate-limited") {
    throw new UsageParseError(`OpenCode Go: окно ${id} содержит неизвестный статус.`)
  }

  const percent = value.percent
  if (typeof percent !== "number" || !Number.isFinite(percent)) {
    throw new UsageParseError(`OpenCode Go: окно ${id} содержит некорректный процент.`)
  }

  const resetsAt = value.resetsAt
  if (typeof resetsAt !== "string" || Number.isNaN(Date.parse(resetsAt))) {
    throw new UsageParseError(`OpenCode Go: окно ${id} содержит некорректное время сброса.`)
  }

  return { status, percent: clampPercent(percent), resetsAt }
}

export function parseUsage(payload: unknown, fetchedAt = Date.now()): UsageSnapshot {
  if (!isRecord(payload) || !isRecord(payload.usage)) {
    throw new UsageParseError("OpenCode Go: в ответе нет объекта usage.")
  }

  const usage = payload.usage
  return {
    fetchedAt,
    windows: {
      rolling: parseWindow(usage.rolling, "rolling"),
      weekly: parseWindow(usage.weekly, "weekly"),
      monthly: parseWindow(usage.monthly, "monthly"),
    },
  }
}

export function remainingPercent(percent: number): number {
  return 100 - clampPercent(percent)
}

export function worstRemaining(snapshot: UsageSnapshot): number {
  return Math.min(...WINDOW_IDS.map((id) => remainingPercent(snapshot.windows[id].percent)))
}

export function toneFor(remaining: number): "good" | "warn" | "bad" {
  if (remaining >= 50) return "good"
  if (remaining >= 20) return "warn"
  return "bad"
}

export function progressBar(remaining: number, width = 10): string {
  const safeWidth = Number.isFinite(width) ? Math.max(0, Math.floor(width)) : 0
  if (safeWidth === 0) return ""
  const filled = Math.round((clampPercent(remaining) / 100) * safeWidth)
  return "█".repeat(filled) + "░".repeat(safeWidth - filled)
}

export function formatReset(resetsAt: string, now = Date.now()): string {
  const reset = Date.parse(resetsAt)
  if (Number.isNaN(reset)) return "сейчас"

  const diff = reset - now
  if (diff < 60_000) return "сейчас"

  const minutes = Math.ceil(diff / 60_000)
  if (minutes < 60) return `${minutes}м`

  const hours = Math.floor(minutes / 60)
  const restMinutes = minutes % 60
  if (hours < 24) {
    return restMinutes === 0 ? `${hours}ч` : `${hours}ч ${restMinutes}м`
  }

  const days = Math.floor(hours / 24)
  const restHours = hours % 24
  return restHours === 0 ? `${days}д` : `${days}д ${restHours}ч`
}

export function footerText(snapshot: UsageSnapshot): string {
  const parts = WINDOW_IDS.map((id) => {
    const remaining = Math.round(remainingPercent(snapshot.windows[id].percent))
    return `${WINDOW_SHORT_LABELS[id]} ${remaining}%`
  })
  return `Go · ${parts.join(" · ")}`
}

export type UsageErrorCode =
  | "not_connected"
  | "not_subscribed"
  | "auth_failed"
  | "request_failed"
  | "invalid_response"

export class UsageError extends Error {
  readonly code: UsageErrorCode
  readonly status?: number

  constructor(code: UsageErrorCode, message: string, status?: number) {
    super(message)
    this.name = "UsageError"
    this.code = code
    this.status = status
  }
}

const USAGE_ERROR_CODES: readonly UsageErrorCode[] = [
  "not_connected",
  "not_subscribed",
  "auth_failed",
  "request_failed",
  "invalid_response",
]

function isUsageErrorCode(value: unknown): value is UsageErrorCode {
  return typeof value === "string" && (USAGE_ERROR_CODES as readonly string[]).includes(value)
}

export function usageErrorCode(error: unknown): UsageErrorCode | undefined {
  if (!isRecord(error)) return undefined
  return isUsageErrorCode(error.type) ? error.type : undefined
}

export function footerErrorLabel(error: { code?: UsageErrorCode; message: string }): string {
  if (error.code === "not_connected" || error.code === "auth_failed") return "нет входа"
  if (error.code === "not_subscribed") return "нет подписки"
  if (error.code) return "ошибка"

  const lower = error.message.toLowerCase()
  if (lower.includes("подписк")) return "нет подписки"
  if (lower.includes("вход") || lower.includes("войдите") || lower.includes("подключен")) {
    return "нет входа"
  }
  return "ошибка"
}

export interface FetchUsageOptions {
  token: string
  orgID?: string
  fetchImpl?: typeof fetch
  now?: () => number
  timeoutMs?: number
}

const USAGE_URLS = [
  "https://opencode.ai/zen/go/v1/usage",
  "https://opencode.ai/inference/go/v1/usage",
] as const

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isTimeoutError(error: unknown): boolean {
  return (
    (error instanceof DOMException &&
      (error.name === "AbortError" || error.name === "TimeoutError")) ||
    (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError"))
  )
}

function timeoutError(timeoutMs: number): UsageError {
  return new UsageError(
    "request_failed",
    `Запрос к OpenCode Go не уложился в ${Math.round(timeoutMs / 1000)} секунд.`,
  )
}

export async function fetchUsage(options: FetchUsageOptions): Promise<UsageSnapshot> {
  const fetchImpl = options.fetchImpl ?? fetch
  const now = options.now ?? Date.now
  const timeoutMs = options.timeoutMs ?? 10_000
  const headers: Record<string, string> = {
    Authorization: `Bearer ${options.token}`,
  }
  if (options.orgID) headers["x-opencode-org-id"] = options.orgID

  for (let index = 0; index < USAGE_URLS.length; index++) {
    const url = USAGE_URLS[index]
    const controller = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, timeoutMs)

    try {
      let response: Response

      try {
        response = await fetchImpl(url, { headers, signal: controller.signal })
      } catch (error) {
        if (error instanceof UsageError) throw error
        if (timedOut || isTimeoutError(error)) throw timeoutError(timeoutMs)
        throw new UsageError(
          "request_failed",
          `Не удалось подключиться к OpenCode Go: ${errorMessage(error)}`,
        )
      }

      if (timedOut) throw timeoutError(timeoutMs)
      if (response.status === 404 && index < USAGE_URLS.length - 1) continue
      if (response.status === 401) {
        throw new UsageError(
          "auth_failed",
          "Вход в OpenCode недействителен. Подключитесь заново через /connect.",
          401,
        )
      }
      if (response.status === 403) {
        throw new UsageError(
          "not_subscribed",
          "У аккаунта нет активной подписки OpenCode Go.",
          403,
        )
      }
      if (!response.ok) {
        throw new UsageError(
          "request_failed",
          `OpenCode Go вернул HTTP ${response.status}.`,
          response.status,
        )
      }

      let payload: unknown
      try {
        payload = await response.json()
      } catch (error) {
        if (timedOut || isTimeoutError(error)) throw timeoutError(timeoutMs)
        throw new UsageError(
          "invalid_response",
          "OpenCode Go вернул неожиданный ответ.",
          response.status,
        )
      }

      try {
        return parseUsage(payload, now())
      } catch (error) {
        if (error instanceof UsageParseError) {
          throw new UsageError(
            "invalid_response",
            "OpenCode Go вернул неожиданный ответ.",
            response.status,
          )
        }
        throw error
      }
    } finally {
      clearTimeout(timer)
    }
  }

  throw new UsageError("request_failed", "OpenCode Go недоступен.")
}
