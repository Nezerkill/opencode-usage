import { UsageError, fetchUsage, type UsageSnapshot } from "./usage.ts"

export interface CredentialValueLike {
  type: string
  access?: string
  key?: string
  metadata?: Record<string, unknown>
}

export interface UsageCredential {
  token: string
  orgID?: string
  cacheKey: string
}

export interface CredentialSource<Connection> {
  active(integrationID: string): Promise<Connection | undefined>
  resolve(connection: Connection): Promise<CredentialValueLike | undefined>
}

function connectionKey(connection: unknown): string {
  if (typeof connection === "object" && connection !== null) {
    const record = connection as Record<string, unknown>
    if (typeof record.id === "string") return record.id
    if (typeof record.name === "string") return `env:${record.name}`
  }
  return "connection"
}

function credentialFailure(error: unknown): UsageError {
  const message = error instanceof Error ? error.message : String(error)
  const lower = message.toLowerCase()

  if (
    lower.includes("auth") ||
    lower.includes("unauthor") ||
    lower.includes("refresh") ||
    lower.includes("token") ||
    lower.includes("401")
  ) {
    return new UsageError(
      "auth_failed",
      "Could not refresh the OpenCode login. Reconnect via /connect.",
    )
  }

  return new UsageError(
    "not_connected",
    "Could not read the OpenCode credentials. Reconnect via /connect.",
  )
}

export async function resolveUsageCredential<Connection>(
  source: CredentialSource<Connection>,
  integrationID = "opencode",
): Promise<UsageCredential> {
  let connection: Connection | undefined

  try {
    connection = await source.active(integrationID)
  } catch (error) {
    throw credentialFailure(error)
  }

  if (!connection) {
    throw new UsageError(
      "not_connected",
      "No active OpenCode connection. Sign in via /connect.",
    )
  }

  let credential: CredentialValueLike | undefined
  try {
    credential = await source.resolve(connection)
  } catch (error) {
    throw credentialFailure(error)
  }

  if (!credential) {
    throw new UsageError(
      "not_connected",
      "Could not read the OpenCode credentials. Sign in via /connect.",
    )
  }

  const token =
    credential.type === "oauth"
      ? credential.access
      : credential.type === "key"
        ? credential.key
        : undefined

  if (!token) {
    throw new UsageError(
      "not_connected",
      "This OpenCode connection type is not supported. Use an OpenCode Console login.",
    )
  }

  const orgID =
    credential.metadata && typeof credential.metadata.orgID === "string"
      ? credential.metadata.orgID
      : undefined

  return {
    token,
    orgID,
    cacheKey: `${connectionKey(connection)}:${orgID ?? ""}`,
  }
}

export interface UsageServiceOptions {
  resolveCredential: () => Promise<UsageCredential>
  fetchUsageImpl?: typeof fetchUsage
  now?: () => number
  cacheMs?: number
}

export interface UsageService {
  get(force: boolean): Promise<UsageSnapshot>
  invalidate(): void
}

export function createUsageService(options: UsageServiceOptions): UsageService {
  let cache: { key: string; snapshot: UsageSnapshot; expiresAt: number } | undefined
  const now = options.now ?? Date.now
  const fetchImpl = options.fetchUsageImpl ?? fetchUsage
  const cacheMs = options.cacheMs ?? 60_000

  return {
    async get(force) {
      const credential = await options.resolveCredential()
      const timestamp = now()

      if (
        !force &&
        cache &&
        cache.key === credential.cacheKey &&
        cache.expiresAt > timestamp
      ) {
        return cache.snapshot
      }

      try {
        const snapshot = await fetchImpl({
          token: credential.token,
          orgID: credential.orgID,
        })
        cache = {
          key: credential.cacheKey,
          snapshot,
          expiresAt: now() + cacheMs,
        }
        return snapshot
      } catch (error) {
        if (
          error instanceof UsageError &&
          (error.code === "auth_failed" ||
            error.code === "not_subscribed" ||
            error.code === "not_connected")
        ) {
          cache = undefined
        }
        throw error
      }
    },

    invalidate() {
      cache = undefined
    },
  }
}
