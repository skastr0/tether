import { describe, expect, it } from "vitest"

import { batteryRepo, extractFiles, tethersNamed } from "../harness"

describe("python production sidecar", () => {
  it("file tether claims the class in that file", async () => {
    await batteryRepo(
      "tether-py-file-",
      {
        "pay.py": `def charge():
    return 1

class Ledger:
    def post(self):
        return 1
`,
        "pay.py.tether": `@symbol Ledger
doc {
  Ledger is the write path for this module.
}
`,
      },
      async (root) => {
        const result = await extractFiles(root, ["pay.py", "pay.py.tether"])
        expect(result.facts).toEqual([])
        expect(tethersNamed(result.tethers, "Ledger")[0]).toMatchObject({
          path: "pay.py.tether",
          host: { kind: "file", path: "pay.py" },
        })
      },
    )
  })
})
