import { describe, expect, it } from "vitest"

import { batteryRepo, extractFiles, tethersNamed } from "../harness"

const module = `export function charge(id) {
  return id
}

export function refund(id) {
  return id
}

// @tether
// @symbol Ledger
export class Ledger {
  // @tether
  // @symbol post
  post(row) {
    return row
  }

  settle() {
    return 1
  }
}
`

describe("javascript production module", () => {
  it("extracts inline type/method plus a file sidecar", async () => {
    await batteryRepo(
      "tether-js-mod-",
      {
        "pay.js": module,
        "pay.js.tether": `@symbol Ledger
@symbol charge
doc {
  Payment entry. Ledger posts; charge is the public function.
}
`,
      },
      async (root) => {
        const result = await extractFiles(root, ["pay.js", "pay.js.tether"])
        expect(result.facts).toEqual([])
        expect(tethersNamed(result.tethers, "Ledger").length).toBeGreaterThan(0)
        expect(tethersNamed(result.tethers, "post")[0]?.host).toEqual({
          kind: "symbol",
          path: "pay.js",
          name: "post",
        })
        expect(tethersNamed(result.tethers, "charge").some((tether) => tether.path === "pay.js.tether")).toBe(true)
      },
    )
  })
})
