import { describe, expect, it } from "vitest"

import { batteryRepo, extractFiles, tethersNamed } from "../harness"

describe("javascript production inline", () => {
  it("binds a function", async () => {
    await batteryRepo(
      "tether-js-fn-",
      {
        "pay.js": `// @tether
// @symbol charge
export function charge() {
  return 1
}
`,
      },
      async (root) => {
        const result = await extractFiles(root, ["pay.js"])
        expect(result.facts).toEqual([])
        expect(tethersNamed(result.tethers, "charge")[0]?.host).toEqual({
          kind: "symbol",
          path: "pay.js",
          name: "charge",
        })
      },
    )
  })

  it("binds a class", async () => {
    await batteryRepo(
      "tether-js-class-",
      {
        "pay.js": `// @tether
// @symbol Ledger
export class Ledger {}
`,
      },
      async (root) => {
        const result = await extractFiles(root, ["pay.js"])
        expect(tethersNamed(result.tethers, "Ledger")[0]?.host).toEqual({
          kind: "symbol",
          path: "pay.js",
          name: "Ledger",
        })
      },
    )
  })

  it("binds a method", async () => {
    await batteryRepo(
      "tether-js-method-",
      {
        "pay.js": `export class Ledger {
  // @tether
  // @symbol post
  post() {
    return 1
  }
}
`,
      },
      async (root) => {
        const result = await extractFiles(root, ["pay.js"])
        expect(tethersNamed(result.tethers, "post")[0]?.host).toEqual({
          kind: "symbol",
          path: "pay.js",
          name: "post",
        })
      },
    )
  })
})
