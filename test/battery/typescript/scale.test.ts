import { describe, expect, it } from "vitest"

import { batteryRepo, extractFiles, tethersNamed } from "../harness"

describe("typescript production module", () => {
  it("extracts a module with functions, a class, methods, and a sidecar", async () => {
    await batteryRepo(
      "tether-ts-mod-",
      {
        "pay.ts": `export function charge(id: string) {
  return id
}

// @tether
// @symbol Ledger
export class Ledger {
  // @tether
  // @symbol post
  post(row: string) {
    return row
  }

  settle() {
    return 1
  }
}
`,
        "pay.ts.tether": `@symbol Ledger
doc {
  Payment module. Ledger is the only writer.
}
`,
      },
      async (root) => {
        const result = await extractFiles(root, ["pay.ts", "pay.ts.tether"])
        expect(result.facts).toEqual([])
        expect(tethersNamed(result.tethers, "post")[0]?.host).toMatchObject({ kind: "symbol", name: "post" })
        expect(tethersNamed(result.tethers, "Ledger").some((tether) => tether.path === "pay.ts.tether")).toBe(true)
      },
    )
  })
})
