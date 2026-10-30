import { Rpc } from "@opencode/plugin/rpc"

const windowSchema = {
  type: "object",
  properties: {
    status: { type: "string", enum: ["ok", "rate-limited"] },
    percent: { type: "number", minimum: 0, maximum: 100 },
    resetsAt: { type: "string" },
  },
  required: ["status", "percent", "resetsAt"],
  additionalProperties: false,
} as const

const errorSchema = {
  type: "object",
  properties: {},
  additionalProperties: false,
} as const

export const GoUsageRpc = Rpc.define({
  id: "opencode-go-usage",
  methods: {
    get: {
      input: {
        type: "object",
        properties: { force: { type: "boolean" } },
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: {
          fetchedAt: { type: "number" },
          windows: {
            type: "object",
            properties: {
              rolling: windowSchema,
              weekly: windowSchema,
              monthly: windowSchema,
            },
            required: ["rolling", "weekly", "monthly"],
            additionalProperties: false,
          },
        },
        required: ["fetchedAt", "windows"],
        additionalProperties: false,
      },
      errors: {
        not_connected: errorSchema,
        not_subscribed: errorSchema,
        auth_failed: errorSchema,
        request_failed: errorSchema,
        invalid_response: errorSchema,
      },
    },
  },
  events: {},
})
