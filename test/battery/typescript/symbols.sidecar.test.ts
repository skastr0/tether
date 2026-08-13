import { describe, expect, it } from "vitest"

import { batteryRepo, extractFiles, tethersNamed } from "../harness"

describe("typescript production sidecar", () => {
  it("file tether talks about the classes in that file", async () => {
    await batteryRepo(
      "tether-ts-file-",
      {
        "pay.ts": `export function charge() {}
export class Ledger {
  post() {}
}
export interface Charge {
  id: string
}
`,
        "pay.ts.tether": `@symbol Ledger
@symbol Charge
doc {
  Ledger is the write path. Charge is the public shape.
}
`,
      },
      async (root) => {
        const result = await extractFiles(root, ["pay.ts", "pay.ts.tether"])
        expect(result.facts).toEqual([])
        expect(tethersNamed(result.tethers, "Ledger")[0]).toMatchObject({
          path: "pay.ts.tether",
          host: { kind: "file", path: "pay.ts" },
          symbols: ["Ledger", "Charge"],
        })
      },
    )
  })
})
