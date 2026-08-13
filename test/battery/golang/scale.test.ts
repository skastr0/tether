import { describe, expect, it } from "vitest"

import { batteryRepo, extractFiles, tethersNamed } from "../harness"

describe("golang production module", () => {
  it("extracts func, type, method, and a sidecar", async () => {
    await batteryRepo(
      "tether-go-mod-",
      {
        "pay.go": `package pay
func Charge() {}

// @tether
// @symbol Ledger
type Ledger struct{}

// @tether
// @symbol Post
func (l Ledger) Post() {}
`,
        "pay.go.tether": `@symbol Ledger
doc {
  Payment module.
}
`,
      },
      async (root) => {
        const result = await extractFiles(root, ["pay.go", "pay.go.tether"])
        expect(result.facts).toEqual([])
        expect(tethersNamed(result.tethers, "Post")[0]?.host.name).toBe("Post")
        expect(tethersNamed(result.tethers, "Ledger").some((tether) => tether.path === "pay.go.tether")).toBe(true)
      },
    )
  })
})
