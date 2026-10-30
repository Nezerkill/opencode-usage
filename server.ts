import { Plugin } from "@opencode/plugin"
import { GoUsageRpc } from "./rpc.ts"
import { createUsageService, resolveUsageCredential } from "./service.ts"
import { UsageError } from "./usage.ts"

export default Plugin.define({
  id: "opencode-go-usage",
  async setup(ctx) {
    const service = createUsageService({
      resolveCredential: () =>
        resolveUsageCredential({
          active: (integrationID) => ctx.integration.connection.active(integrationID),
          resolve: (connection) => ctx.integration.connection.resolve(connection),
        }),
    })

    await ctx.rpc.register(GoUsageRpc, {
      get: async (input, context) => {
        const force =
          typeof input === "object" && input !== null && "force" in input
            ? (input as { force?: unknown }).force === true
            : false

        try {
          return await service.get(force)
        } catch (error) {
          if (error instanceof UsageError) {
            return context.error(error.code, error.message, {})
          }
          return context.error(
            "request_failed",
            "Не удалось получить лимиты OpenCode Go.",
            {},
          )
        }
      },
    })
  },
})
