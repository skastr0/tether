import { describe, expect, it } from "vitest"

import { batteryRepo, extractFiles, tethersNamed } from "../harness"

describe("rust production sidecar", () => {
  it("file tether claims the struct in that file", async () => {
    await batteryRepo(
      "tether-rs-file-",
      {
        "pay.rs": `pub fn charge() {}
pub struct Ledger;
impl Ledger {
    pub fn post(&self) {}
}
`,
        "pay.rs.tether": `@symbol Ledger
doc {
  Ledger is the write path.
}
`,
      },
      async (root) => {
        const result = await extractFiles(root, ["pay.rs", "pay.rs.tether"])
        expect(result.facts).toEqual([])
        expect(tethersNamed(result.tethers, "Ledger")[0]).toMatchObject({
          path: "pay.rs.tether",
          host: { kind: "file", path: "pay.rs" },
        })
      },
    )
  })
})
