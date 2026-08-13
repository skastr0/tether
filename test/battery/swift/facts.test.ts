import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

import { batteryRepo, factsOf, lintRoot } from "../harness"
import { SWIFT_WASM_SKIP } from "./kinds"

describe("swift facts", () => {
  if (SWIFT_WASM_SKIP !== undefined) {
    it.skip(SWIFT_WASM_SKIP, () => undefined)
    return
  }

  it("ill_formed when @symbol disagrees with the adjacent declaration", async () => {
    await batteryRepo(
      "tether-battery-swift-ill-adj-",
      {
        "swIllAdj.swift": `// @tether
// @symbol swWrong
func swIllAdj() {}
`,
      },
      async (root) => {
        const report = await lintRoot(root)
        expect(factsOf(report.facts, "ill_formed")).toContainEqual({
          kind: "ill_formed",
          path: "swIllAdj.swift",
        })
      },
    )
  })

  it("ill_formed when @symbol is on a folder tether", async () => {
    await batteryRepo(
      "tether-battery-swift-ill-folder-",
      {
        "lib/swKeep.swift": "func swKeep() {}\n",
        "lib.tether": "@symbol swFolder\n",
      },
      async (root) => {
        const report = await lintRoot(root)
        expect(factsOf(report.facts, "ill_formed")).toContainEqual({
          kind: "ill_formed",
          path: "lib.tether",
        })
      },
    )
  })

  it("symbol_missing when sidecar @symbol is not in the file", async () => {
    await batteryRepo(
      "tether-battery-swift-symbol-missing-",
      {
        "swGone.swift": "func swPresent() {}\n",
        "swGone.swift.tether": "@symbol swGoneMissing\n",
      },
      async (root) => {
        const report = await lintRoot(root)
        expect(factsOf(report.facts, "symbol_missing")).toContainEqual({
          kind: "symbol_missing",
          path: "swGone.swift.tether",
        })
      },
    )
  })

  it("symbol_ambiguous when two same-name decls match sidecar @symbol", async () => {
    await batteryRepo(
      "tether-battery-swift-symbol-ambiguous-",
      {
        "swDup.swift": `func swDup() {}

class SwDupHost {
    func swDup() {}
}
`,
        "swDup.swift.tether": "@symbol swDup\n",
      },
      async (root) => {
        const report = await lintRoot(root)
        expect(factsOf(report.facts, "symbol_ambiguous")).toContainEqual({
          kind: "symbol_ambiguous",
          path: "swDup.swift.tether",
        })
      },
    )
  })

  it("host_missing when the sidecar has no sibling file", async () => {
    await batteryRepo(
      "tether-battery-swift-host-missing-",
      {
        "gone.swift.tether": "doc {\n  missing host\n}\n",
      },
      async (root) => {
        const report = await lintRoot(root)
        expect(factsOf(report.facts, "host_missing")).toContainEqual({
          kind: "host_missing",
          path: "gone.swift.tether",
        })
      },
    )
  })

  it("host_fingerprint_changed when the host body changes without touching the tether", async () => {
    await batteryRepo(
      "tether-battery-swift-host-fp-",
      {
        "swFp.swift": `func swFpHost() {
    let swFpA = 1
}
`,
        "swFp.swift.tether": "doc {\n  file host\n}\n",
      },
      async (root) => {
        await writeFile(
          join(root, "swFp.swift"),
          `func swFpHost() {
    let swFpB = 2
}
`,
        )
        const report = await lintRoot(root)
        expect(factsOf(report.facts, "host_fingerprint_changed")).toContainEqual({
          kind: "host_fingerprint_changed",
          path: "swFp.swift.tether",
        })
      },
    )
  })

  it("ref_missing when sidecar @ref names a missing symbol", async () => {
    await batteryRepo(
      "tether-battery-swift-ref-missing-",
      {
        "swRef.swift": `func swRefHost() {}
`,
        "swRef.swift.tether": "@ref #swMissingRef\n",
      },
      async (root) => {
        const report = await lintRoot(root)
        expect(factsOf(report.facts, "ref_missing")).toContainEqual({
          kind: "ref_missing",
          path: "swRef.swift.tether",
        })
      },
    )
  })

  it("ref_fingerprint_changed when the referenced symbol body changes", async () => {
    await batteryRepo(
      "tether-battery-swift-ref-fp-",
      {
        "swRefFp.swift": `func swRefFpHost() {
    let swRefFpA = 1
}
`,
        "swRefFp.swift.tether": "@ref #swRefFpHost\n",
      },
      async (root) => {
        await writeFile(
          join(root, "swRefFp.swift"),
          `func swRefFpHost() {
    let swRefFpB = 99
}
`,
        )
        const report = await lintRoot(root)
        expect(factsOf(report.facts, "ref_fingerprint_changed")).toContainEqual({
          kind: "ref_fingerprint_changed",
          path: "swRefFp.swift.tether",
        })
      },
    )
  })

  it("duplicate_id when two file sidecars claim the same @symbol", async () => {
    await batteryRepo(
      "tether-battery-swift-dup-id-",
      {
        "a.swift": "func swShared() {}\n",
        "a.swift.tether": "@symbol swShared\n",
        "b.swift": "func swShared() {}\n",
        "b.swift.tether": "@symbol swShared\n",
      },
      async (root) => {
        const report = await lintRoot(root)
        expect(factsOf(report.facts, "duplicate_id")).toEqual(
          expect.arrayContaining([
            { kind: "duplicate_id", path: "a.swift.tether" },
            { kind: "duplicate_id", path: "b.swift.tether" },
          ]),
        )
      },
    )
  })
})
