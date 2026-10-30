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

test("fetchUsage maps a real timeout abort to request_failed", async () => {
  await assert.rejects(
    () =>
      fetchUsage({
        token: "t",
        timeoutMs: 5,
        fetchImpl: (_url, init) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              reject(new DOMException("timed out", "TimeoutError"))
            })
          }),
      }),
    (error) =>
      error instanceof UsageError &&
      error.code === "request_failed" &&
      error.message.includes("не уложился"),
  )
})

test("fetchUsage maps a TimeoutError from fetch to request_failed", async () => {
  await assert.rejects(
    () =>
      fetchUsage({
        token: "t",
        fetchImpl: async () => {
          throw new DOMException("timed out", "TimeoutError")
        },
      }),
    (error) =>
      error instanceof UsageError &&
      error.code === "request_failed" &&
      error.message.includes("не уложился"),
  )
})

test("fetchUsage maps a body-read timeout to request_failed", async () => {
  const hanging = {
    status: 200,
    ok: true,
    json: async () => {
      throw new DOMException("timed out", "TimeoutError")
    },
  } as unknown as Response

  await assert.rejects(
    () => fetchUsage({ token: "t", fetchImpl: async () => hanging }),
    (error) =>
      error instanceof UsageError &&
      error.code === "request_failed" &&
      error.message.includes("не уложился"),
  )
})
