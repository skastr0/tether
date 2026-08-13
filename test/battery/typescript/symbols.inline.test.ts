import { describe, expect, it } from "vitest"

import { batteryRepo, extractFiles, tethersNamed } from "../harness"

describe("typescript production inline", () => {
  it("binds a function", async () => {
    await batteryRepo(
      "tether-ts-fn-",
      {
        "pay.ts": `// @tether
// @symbol charge
export function charge(): number {
  return 1
}
`,
      },
      async (root) => {
        const result = await extractFiles(root, ["pay.ts"])
        expect(result.facts).toEqual([])
        expect(tethersNamed(result.tethers, "charge")[0]?.host).toEqual({
          kind: "symbol",
          path: "pay.ts",
          name: "charge",
        })
      },
    )
  })

  it("binds a class", async () => {
    await batteryRepo(
      "tether-ts-class-",
      {
        "pay.ts": `// @tether
// @symbol Ledger
export class Ledger {}
`,
      },
      async (root) => {
        const result = await extractFiles(root, ["pay.ts"])
        expect(tethersNamed(result.tethers, "Ledger")[0]?.host).toEqual({
          kind: "symbol",
          path: "pay.ts",
          name: "Ledger",
        })
      },
    )
  })

  it("binds an interface", async () => {
    await batteryRepo(
      "tether-ts-iface-",
      {
        "pay.ts": `// @tether
// @symbol Charge
export interface Charge {
  id: string
}
`,
      },
      async (root) => {
        const result = await extractFiles(root, ["pay.ts"])
        expect(tethersNamed(result.tethers, "Charge")[0]?.host).toEqual({
          kind: "symbol",
          path: "pay.ts",
          name: "Charge",
        })
      },
    )
  })

  it("binds a method", async () => {
    await batteryRepo(
      "tether-ts-method-",
      {
        "pay.ts": `export class Ledger {
  // @tether
  // @symbol post
  post(): number {
    return 1
  }
}
`,
      },
      async (root) => {
        const result = await extractFiles(root, ["pay.ts"])
        expect(tethersNamed(result.tethers, "post")[0]?.host).toEqual({
          kind: "symbol",
          path: "pay.ts",
          name: "post",
        })
      },
    )
  })
})
