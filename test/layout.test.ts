import test from "node:test"
import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"

const root = new URL("../", import.meta.url)

test("plugin root has exactly one server entrypoint: server.ts", () => {
  assert.equal(existsSync(fileURLToPath(new URL("server.ts", root))), true)
  assert.equal(existsSync(fileURLToPath(new URL("index.ts", root))), false)
})
