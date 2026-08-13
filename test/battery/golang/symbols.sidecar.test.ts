import { describe, expect, it } from "vitest"

import { batteryRepo, extractFiles, tethersNamed } from "../harness"

describe("golang production sidecar", () => {
  it("file tether claims the type in that file", async () => {
    await batteryRepo(
      "tether-go-file-",
      {
        "pay.go": `package pay
func Charge() {}
type Ledger struct{}
func (l Ledger) Post() {}
`,
        "pay.go.tether": `@symbol Ledger
doc {
  Ledger is the write path.
}
`,
      },
      async (root) => {
        const result = await extractFiles(root, ["pay.go", "pay.go.tether"])
        expect(result.facts).toEqual([])
        expect(tethersNamed(result.tethers, "Ledger")[0]).toMatchObject({
          path: "pay.go.tether",
          host: { kind: "file", path: "pay.go" },
        })
      },
    )
  })
})
