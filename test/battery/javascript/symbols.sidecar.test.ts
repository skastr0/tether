import { describe, expect, it } from "vitest"

import { batteryRepo, extractFiles, tethersNamed } from "../harness"

describe("javascript production sidecar", () => {
  it("file tether claims the class in that file", async () => {
    await batteryRepo(
      "tether-js-file-",
      {
        "pay.js": `export function charge() {}
export class Ledger {
  post() {}
}
`,
        "pay.js.tether": `@symbol Ledger
doc {
  This file is the payment ledger. Ledger is the only write path.
}
`,
      },
      async (root) => {
        const result = await extractFiles(root, ["pay.js", "pay.js.tether"])
        expect(result.facts).toEqual([])
        expect(tethersNamed(result.tethers, "Ledger")).toEqual([
          expect.objectContaining({
            path: "pay.js.tether",
            host: { kind: "file", path: "pay.js" },
            symbols: ["Ledger"],
          }),
        ])
      },
    )
  })
})
