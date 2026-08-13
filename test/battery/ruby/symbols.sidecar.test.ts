import { describe, expect, it } from "vitest"

import { batteryRepo, extractFiles, tethersNamed } from "../harness"

describe("ruby production sidecar", () => {
  it("file tether claims the class in that file", async () => {
    await batteryRepo(
      "tether-rb-file-",
      {
        "pay.rb": `def charge
end

class Ledger
  def post
  end
end
`,
        "pay.rb.tether": `@symbol Ledger
doc {
  Ledger is the write path.
}
`,
      },
      async (root) => {
        const result = await extractFiles(root, ["pay.rb", "pay.rb.tether"])
        expect(result.facts).toEqual([])
        expect(tethersNamed(result.tethers, "Ledger")[0]).toMatchObject({
          path: "pay.rb.tether",
          host: { kind: "file", path: "pay.rb" },
        })
      },
    )
  })
})
