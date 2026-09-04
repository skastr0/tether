import { describe, expect, it } from "vitest"

import { batteryRepo, extractFiles, tethersNamed } from "../harness"

describe("rust production inline", () => {
  it("binds a function", async () => {
    await batteryRepo(
      "tether-rs-fn-",
      {
        "pay.rs": `// @tether
// @symbol charge
pub fn charge() -> u32 { 1 }
`,
      },
      async (root) => {
        const result = await extractFiles(root, ["pay.rs"])
        expect(result.facts).toEqual([])
        expect(tethersNamed(result.tethers, "charge")[0]?.host).toMatchObject({ kind: "symbol", name: "charge" })
      },
    )
  })

  it("binds a struct", async () => {
    await batteryRepo(
      "tether-rs-struct-",
      {
        "pay.rs": `// @tether
// @symbol Ledger
pub struct Ledger;
`,
      },
      async (root) => {
        const result = await extractFiles(root, ["pay.rs"])
        expect(tethersNamed(result.tethers, "Ledger")[0]?.host).toMatchObject({ kind: "symbol", name: "Ledger" })
      },
    )
  })

  it("binds a method", async () => {
    await batteryRepo(
      "tether-rs-method-",
      {
        "pay.rs": `pub struct Ledger;
impl Ledger {
    // @tether
    // @symbol post
    pub fn post(&self) {}
}
`,
      },
      async (root) => {
        const result = await extractFiles(root, ["pay.rs"])
        expect(tethersNamed(result.tethers, "post")[0]?.host).toMatchObject({ kind: "symbol", name: "post" })
      },
    )
  })
})
