import test from "node:test"
import assert from "node:assert/strict"
import { UsageError, parseUsage } from "../usage.ts"
import { createUsageService, resolveUsageCredential } from "../service.ts"

const connection = { id: "cred_1" }

function snapshot(percent: number) {
  return parseUsage({
    usage: {
      rolling: { status: "ok", percent, resetsAt: "2026-10-31T02:48:27.000Z" },
      weekly: { status: "ok", percent, resetsAt: "2026-11-02T00:00:00.000Z" },
      monthly: { status: "ok", percent, resetsAt: "2026-11-29T21:47:14.000Z" },
    },
  })
}

function source(credential: unknown, error?: unknown) {
  return {
    active: async () => connection,
    resolve: async () => {
      if (error) throw error
      return credential as never
    },
  }
}

test("resolveUsageCredential handles oauth, key, and external credentials", async () => {
  assert.deepEqual(
    await resolveUsageCredential(
      source({ type: "oauth", access: "access-token", metadata: { orgID: "org_1" } }),
    ),
    { token: "access-token", orgID: "org_1", cacheKey: "cred_1:org_1" },
  )

  assert.deepEqual(await resolveUsageCredential(source({ type: "key", key: "api-key" })), {
    token: "api-key",
    orgID: undefined,
    cacheKey: "cred_1:",
  })

  await assert.rejects(
    () => resolveUsageCredential(source({ type: "external", methodID: "cli", metadata: {} })),
    (error) => error instanceof UsageError && error.code === "not_connected",
  )
})

test("resolveUsageCredential maps missing connection and resolve failures", async () => {
  await assert.rejects(
    () =>
      resolveUsageCredential({
        active: async () => undefined,
        resolve: async () => undefined,
      }),
    (error) => error instanceof UsageError && error.code === "not_connected",
  )

  await assert.rejects(
    () => resolveUsageCredential(source(undefined)),
    (error) => error instanceof UsageError && error.code === "not_connected",
  )

  await assert.rejects(
    () => resolveUsageCredential(source(undefined, new Error("refresh failed"))),
    (error) => error instanceof UsageError && error.code === "auth_failed",
  )

  await assert.rejects(
    () => resolveUsageCredential(source(undefined, new Error("network down"))),
    (error) => error instanceof UsageError && error.code === "not_connected",
  )
})

test("usage service caches per credential key, expires, and force bypasses", async () => {
  let calls = 0
  let credential = { token: "a", orgID: "org_1", cacheKey: "cred_1:org_1" }
  let now = 1000

  const service = createUsageService({
    resolveCredential: async () => credential,
    fetchUsageImpl: async () => {
      calls++
      return snapshot(calls)
    },
    now: () => now,
    cacheMs: 60_000,
  })

  await service.get(false)
  assert.equal(calls, 1)

  await service.get(false)
  assert.equal(calls, 1)

  await service.get(true)
  assert.equal(calls, 2)

  now = 62_000
  await service.get(false)
  assert.equal(calls, 3)

  credential = { ...credential, cacheKey: "cred_2:org_1" }
  await service.get(false)
  assert.equal(calls, 4)
})

test("usage service passes token and org to fetchUsage", async () => {
  let received: unknown
  const service = createUsageService({
    resolveCredential: async () => ({ token: "tok", orgID: "org_1", cacheKey: "cred_1:org_1" }),
    fetchUsageImpl: async (options) => {
      received = options
      return snapshot(1)
    },
  })

  await service.get(true)
  assert.deepEqual(received, { token: "tok", orgID: "org_1" })
})

test("usage service clears cache on auth errors", async () => {
  let calls = 0
  let fail = true
  const service = createUsageService({
    resolveCredential: async () => ({ token: "a", orgID: "org_1", cacheKey: "cred_1:org_1" }),
    fetchUsageImpl: async () => {
      calls++
      if (fail) throw new UsageError("auth_failed", "expired")
      return snapshot(5)
    },
    now: () => 1000,
  })

  await assert.rejects(
    () => service.get(false),
    (error) => error instanceof UsageError && error.code === "auth_failed",
  )

  fail = false
  await service.get(false)
  assert.equal(calls, 2)
})

test("usage service invalidate forces the next fetch", async () => {
  let calls = 0
  const service = createUsageService({
    resolveCredential: async () => ({ token: "a", orgID: "org_1", cacheKey: "cred_1:org_1" }),
    fetchUsageImpl: async () => {
      calls++
      return snapshot(1)
    },
  })

  await service.get(false)
  service.invalidate()
  await service.get(false)
  assert.equal(calls, 2)
})
