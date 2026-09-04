import { describe, expect, it } from "vitest"

import { batteryRepo, extractFiles, tethersNamed } from "../harness"

describe("python production module", () => {
  it("extracts functions, a class, a method, and a sidecar", async () => {
    await batteryRepo(
      "tether-py-mod-",
      {
        "pay.py": `def charge(id):
    return id

# @tether
# @symbol Ledger
class Ledger:
    # @tether
    # @symbol post
    def post(self, row):
        return row
`,
        "pay.py.tether": `@symbol Ledger
doc {
  Payment module.
}
`,
      },
      async (root) => {
        const result = await extractFiles(root, ["pay.py", "pay.py.tether"])
        expect(result.facts).toEqual([])
        expect(tethersNamed(result.tethers, "post")[0]?.host).toMatchObject({ kind: "symbol", name: "post" })
        expect(tethersNamed(result.tethers, "Ledger").some((tether) => tether.path === "pay.py.tether")).toBe(true)
      },
    )
  })
})
