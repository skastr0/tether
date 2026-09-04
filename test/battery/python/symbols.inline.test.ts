import { describe, expect, it } from "vitest"

import { batteryRepo, extractFiles, tethersNamed } from "../harness"

describe("python production inline", () => {
  it("binds a function", async () => {
    await batteryRepo(
      "tether-py-fn-",
      {
        "pay.py": `# @tether
# @symbol charge
def charge():
    return 1
`,
      },
      async (root) => {
        const result = await extractFiles(root, ["pay.py"])
        expect(result.facts).toEqual([])
        expect(tethersNamed(result.tethers, "charge")[0]?.host).toMatchObject({ kind: "symbol", name: "charge" })
      },
    )
  })

  it("binds a class", async () => {
    await batteryRepo(
      "tether-py-class-",
      {
        "pay.py": `# @tether
# @symbol Ledger
class Ledger:
    pass
`,
      },
      async (root) => {
        const result = await extractFiles(root, ["pay.py"])
        expect(tethersNamed(result.tethers, "Ledger")[0]?.host).toMatchObject({ kind: "symbol", name: "Ledger" })
      },
    )
  })

  it("binds a method", async () => {
    await batteryRepo(
      "tether-py-method-",
      {
        "pay.py": `class Ledger:
    # @tether
    # @symbol post
    def post(self):
        return 1
`,
      },
      async (root) => {
        const result = await extractFiles(root, ["pay.py"])
        expect(tethersNamed(result.tethers, "post")[0]?.host).toMatchObject({ kind: "symbol", name: "post" })
      },
    )
  })
})
