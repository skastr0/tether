import { describe, expect, it } from "vitest"

import { batteryRepo, extractFiles, tethersNamed } from "../harness"

describe("rust production module", () => {
  it("extracts fn, struct, method, and a sidecar", async () => {
    await batteryRepo(
      "tether-rs-mod-",
      {
        "pay.rs": `pub fn charge() {}

// @tether
// @symbol Ledger
pub struct Ledger;

impl Ledger {
    // @tether
    // @symbol post
    pub fn post(&self) {}
}
`,
        "pay.rs.tether": `@symbol Ledger
doc {
  Payment module.
}
`,
      },
      async (root) => {
        const result = await extractFiles(root, ["pay.rs", "pay.rs.tether"])
        expect(result.facts).toEqual([])
        expect(tethersNamed(result.tethers, "post")[0]?.host).toMatchObject({ kind: "symbol", name: "post" })
        expect(tethersNamed(result.tethers, "Ledger").some((tether) => tether.path === "pay.rs.tether")).toBe(true)
      },
    )
  })
})
