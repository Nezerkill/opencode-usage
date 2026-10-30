import test from "node:test"
import assert from "node:assert/strict"
import {
  UsageParseError,
  footerErrorLabel,
  footerText,
  formatReset,
  parseUsage,
  progressBar,
  remainingPercent,
  toneFor,
  usageErrorCode,
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

test("formatReset treats past timestamps as now", () => {
  const now = Date.parse("2026-10-31T00:00:00.000Z")
  assert.equal(formatReset("2026-10-30T23:00:00.000Z", now), "сейчас")
})

test("usageErrorCode reads the RPC error type", () => {
  assert.equal(usageErrorCode({ type: "not_subscribed", message: "x" }), "not_subscribed")
  assert.equal(usageErrorCode({ type: "auth_failed", message: "x" }), "auth_failed")
  assert.equal(usageErrorCode({ type: "rpc.internal", message: "x" }), undefined)
  assert.equal(usageErrorCode("nope"), undefined)
})

test("footerErrorLabel prefers the RPC error code over message text", () => {
  assert.equal(
    footerErrorLabel({ code: "not_subscribed", message: "network подключение" }),
    "нет подписки",
  )
  assert.equal(footerErrorLabel({ code: "auth_failed", message: "что угодно" }), "нет входа")
  assert.equal(footerErrorLabel({ code: "request_failed", message: "подписка" }), "ошибка")
  assert.equal(footerErrorLabel({ message: "Нет активного подключения OpenCode" }), "нет входа")
})
