import { describe, expect, it } from "vitest"

import { batteryRepo, extractFiles, tethersNamed } from "../harness"

describe("ruby production inline", () => {
  it("binds a method", async () => {
    await batteryRepo(
      "tether-rb-fn-",
      {
        "pay.rb": `# @tether
# @symbol charge
def charge
  1
end
`,
      },
      async (root) => {
        const result = await extractFiles(root, ["pay.rb"])
        expect(result.facts).toEqual([])
        expect(tethersNamed(result.tethers, "charge")[0]?.host.name).toBe("charge")
      },
    )
  })

  it("binds a class", async () => {
    await batteryRepo(
      "tether-rb-class-",
      {
        "pay.rb": `# @tether
# @symbol Ledger
class Ledger
end
`,
      },
      async (root) => {
        const result = await extractFiles(root, ["pay.rb"])
        expect(tethersNamed(result.tethers, "Ledger")[0]?.host.name).toBe("Ledger")
      },
    )
  })

  it("binds a class method", async () => {
    await batteryRepo(
      "tether-rb-method-",
      {
        "pay.rb": `class Ledger
  # @tether
  # @symbol post
  def post
    1
  end
end
`,
      },
      async (root) => {
        const result = await extractFiles(root, ["pay.rb"])
        expect(tethersNamed(result.tethers, "post")[0]?.host.name).toBe("post")
      },
    )
  })
})
