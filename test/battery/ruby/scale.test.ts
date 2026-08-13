import { describe, expect, it } from "vitest"

import { batteryRepo, extractFiles, tethersNamed } from "../harness"

describe("ruby production module", () => {
  it("extracts method, class, instance method, and a sidecar", async () => {
    await batteryRepo(
      "tether-rb-mod-",
      {
        "pay.rb": `def charge
end

# @tether
# @symbol Ledger
class Ledger
  # @tether
  # @symbol post
  def post
    1
  end
end
`,
        "pay.rb.tether": `@symbol Ledger
doc {
  Payment module.
}
`,
      },
      async (root) => {
        const result = await extractFiles(root, ["pay.rb", "pay.rb.tether"])
        expect(result.facts).toEqual([])
        expect(tethersNamed(result.tethers, "post")[0]?.host.name).toBe("post")
        expect(tethersNamed(result.tethers, "Ledger").some((tether) => tether.path === "pay.rb.tether")).toBe(true)
      },
    )
  })
})
