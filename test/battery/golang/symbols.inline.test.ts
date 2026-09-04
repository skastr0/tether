import { describe, expect, it } from "vitest"

import { batteryRepo, extractFiles, tethersNamed } from "../harness"

describe("golang production inline", () => {
  it("binds a function", async () => {
    await batteryRepo(
      "tether-go-fn-",
      {
        "pay.go": `package pay
// @tether
// @symbol Charge
func Charge() {}
`,
      },
      async (root) => {
        const result = await extractFiles(root, ["pay.go"])
        expect(result.facts).toEqual([])
        expect(tethersNamed(result.tethers, "Charge")[0]?.host).toMatchObject({ kind: "symbol", name: "Charge" })
      },
    )
  })

  it("binds a type", async () => {
    await batteryRepo(
      "tether-go-type-",
      {
        "pay.go": `package pay
// @tether
// @symbol Ledger
type Ledger struct{}
`,
      },
      async (root) => {
        const result = await extractFiles(root, ["pay.go"])
        expect(tethersNamed(result.tethers, "Ledger")[0]?.host).toMatchObject({ kind: "symbol", name: "Ledger" })
      },
    )
  })

  it("binds a method", async () => {
    await batteryRepo(
      "tether-go-method-",
      {
        "pay.go": `package pay
type Ledger struct{}
// @tether
// @symbol Post
func (l Ledger) Post() {}
`,
      },
      async (root) => {
        const result = await extractFiles(root, ["pay.go"])
        expect(tethersNamed(result.tethers, "Post")[0]?.host).toMatchObject({ kind: "symbol", name: "Post" })
      },
    )
  })
})
