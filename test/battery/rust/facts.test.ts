import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

import { batteryRepo, factsOf, lintRoot } from "../harness"

describe("rust facts", () => {
  it("ill_formed when @symbol disagrees with the adjacent declaration", async () => {
    await batteryRepo(
      "tether-battery-rust-ill-adj-",
      {
        "rsIllAdj.rs": `// @tether
// @symbol rsWrong
fn rsIllAdj() {}
`,
      },
      async (root) => {
        const report = await lintRoot(root)
        expect(factsOf(report.facts, "ill_formed")).toContainEqual({
          kind: "ill_formed",
          path: "rsIllAdj.rs",
        })
      },
    )
  })

  it("ill_formed when @symbol is on a folder tether", async () => {
    await batteryRepo(
      "tether-battery-rust-ill-folder-",
      {
        "src/rsKeep.rs": "fn rsKeep() {}\n",
        "src.tether": "@symbol rsFolder\n",
      },
      async (root) => {
        const report = await lintRoot(root)
        expect(factsOf(report.facts, "ill_formed")).toContainEqual({
          kind: "ill_formed",
          path: "src.tether",
        })
      },
    )
  })

  it("symbol_missing when sidecar @symbol is not in the file", async () => {
    await batteryRepo(
      "tether-battery-rust-symbol-missing-",
      {
        "rsGone.rs": "fn rsPresent() {}\n",
        "rsGone.rs.tether": "@symbol rsGoneMissing\n",
      },
      async (root) => {
        const report = await lintRoot(root)
        expect(factsOf(report.facts, "symbol_missing")).toContainEqual({
          kind: "symbol_missing",
          path: "rsGone.rs.tether",
        })
      },
    )
  })

  it("symbol_ambiguous when two same-name decls match sidecar @symbol", async () => {
    await batteryRepo(
      "tether-battery-rust-symbol-ambiguous-",
      {
        "rsDup.rs": `fn rsDup() {}

mod rsDupHost {
    fn rsDup() {}
}
`,
        "rsDup.rs.tether": "@symbol rsDup\n",
      },
      async (root) => {
        const report = await lintRoot(root)
        expect(factsOf(report.facts, "symbol_ambiguous")).toContainEqual({
          kind: "symbol_ambiguous",
          path: "rsDup.rs.tether",
        })
      },
    )
  })

  it("host_missing when the sidecar has no sibling file", async () => {
    await batteryRepo(
      "tether-battery-rust-host-missing-",
      {
        "gone.rs.tether": "doc {\n  missing host\n}\n",
      },
      async (root) => {
        const report = await lintRoot(root)
        expect(factsOf(report.facts, "host_missing")).toContainEqual({
          kind: "host_missing",
          path: "gone.rs.tether",
        })
      },
    )
  })

  it("host_fingerprint_changed when the host body changes without touching the tether", async () => {
    await batteryRepo(
      "tether-battery-rust-host-fp-",
      {
        "rsFp.rs": `fn rsFpHost() {
    let _x = 1;
}
`,
        "rsFp.rs.tether": "doc {\n  file host\n}\n",
      },
      async (root) => {
        await writeFile(
          join(root, "rsFp.rs"),
          `fn rsFpHost() {
    let _x = 2;
}
`,
        )
        const report = await lintRoot(root)
        expect(factsOf(report.facts, "host_fingerprint_changed")).toContainEqual({
          kind: "host_fingerprint_changed",
          path: "rsFp.rs.tether",
        })
      },
    )
  })

  it("ref_missing when sidecar @ref names a missing symbol", async () => {
    await batteryRepo(
      "tether-battery-rust-ref-missing-",
      {
        "rsRef.rs": `fn rsRefHost() {}
`,
        "rsRef.rs.tether": "@ref #rsMissingRef\n",
      },
      async (root) => {
        const report = await lintRoot(root)
        expect(factsOf(report.facts, "ref_missing")).toContainEqual({
          kind: "ref_missing",
          path: "rsRef.rs.tether",
        })
      },
    )
  })

  it("ref_fingerprint_changed when the referenced symbol body changes", async () => {
    await batteryRepo(
      "tether-battery-rust-ref-fp-",
      {
        "rsRefFp.rs": `fn rsRefFpHost() {
    let _x = 1;
}
`,
        "rsRefFp.rs.tether": "@ref #rsRefFpHost\n",
      },
      async (root) => {
        await writeFile(
          join(root, "rsRefFp.rs"),
          `fn rsRefFpHost() {
    let _x = 99;
}
`,
        )
        const report = await lintRoot(root)
        expect(factsOf(report.facts, "ref_fingerprint_changed")).toContainEqual({
          kind: "ref_fingerprint_changed",
          path: "rsRefFp.rs.tether",
        })
      },
    )
  })

  it("duplicate_id when two file sidecars claim the same @symbol", async () => {
    await batteryRepo(
      "tether-battery-rust-dup-id-",
      {
        "a.rs": "fn rsShared() {}\n",
        "a.rs.tether": "@symbol rsShared\n",
        "b.rs": "fn rsShared() {}\n",
        "b.rs.tether": "@symbol rsShared\n",
      },
      async (root) => {
        const report = await lintRoot(root)
        expect(factsOf(report.facts, "duplicate_id")).toEqual(
          expect.arrayContaining([
            { kind: "duplicate_id", path: "a.rs.tether" },
            { kind: "duplicate_id", path: "b.rs.tether" },
          ]),
        )
      },
    )
  })
})
