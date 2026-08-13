import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

import { commitAll } from "../../helpers/git-repo"
import { batteryRepo, factsOf, lintRoot } from "../harness"

describe("typescript facts", () => {
  it("ill_formed when @symbol disagrees with the adjacent declaration", async () => {
    await batteryRepo(
      "tether-ts-ill-adj-",
      {
        "src/tsIllAdj.ts": `// @tether
// @symbol tsWrong
function tsIllAdj() {
  return 1
}
`,
      },
      async (root) => {
        const report = await lintRoot(root)
        expect(factsOf(report.facts, "ill_formed")).toContainEqual({
          kind: "ill_formed",
          path: "src/tsIllAdj.ts",
        })
      },
    )
  })

  it("ill_formed when @symbol is on a folder/root tether", async () => {
    await batteryRepo(
      "tether-ts-ill-root-",
      {
        "root.tether": `@symbol tsRootSym
doc {
  bare name on the repo host
}
`,
        "src/tsKeep.ts": `function tsKeep() {
  return 1
}
`,
      },
      async (root) => {
        const report = await lintRoot(root)
        expect(factsOf(report.facts, "ill_formed")).toContainEqual({
          kind: "ill_formed",
          path: "root.tether",
        })
      },
    )
  })

  it("symbol_missing when sidecar @symbol is not in the file", async () => {
    await batteryRepo(
      "tether-ts-sym-miss-",
      {
        "src/tsPresent.ts": `function tsPresent() {
  return 1
}
`,
        "src/tsPresent.ts.tether": `@symbol tsGone
doc {
  gone
}
`,
      },
      async (root) => {
        const report = await lintRoot(root)
        expect(factsOf(report.facts, "symbol_missing")).toContainEqual({
          kind: "symbol_missing",
          path: "src/tsPresent.ts.tether",
        })
      },
    )
  })

  it("symbol_ambiguous when two same-name decls share a sidecar @symbol", async () => {
    await batteryRepo(
      "tether-ts-sym-amb-",
      {
        "src/tsDup.ts": `function tsDup() {
  return 1
}
function tsDup() {
  return 2
}
`,
        "src/tsDup.ts.tether": `@symbol tsDup
doc {
  two decls
}
`,
      },
      async (root) => {
        const report = await lintRoot(root)
        expect(factsOf(report.facts, "symbol_ambiguous")).toContainEqual({
          kind: "symbol_ambiguous",
          path: "src/tsDup.ts.tether",
        })
      },
    )
  })

  it("host_missing when a file sidecar has no sibling", async () => {
    await batteryRepo(
      "tether-ts-host-miss-",
      {
        "src/tsGone.ts.tether": `doc {
  missing host
}
`,
      },
      async (root) => {
        const report = await lintRoot(root)
        expect(factsOf(report.facts, "host_missing")).toContainEqual({
          kind: "host_missing",
          path: "src/tsGone.ts.tether",
        })
      },
    )
  })

  it("host_fingerprint_changed when the host body changes without the tether", async () => {
    await batteryRepo(
      "tether-ts-host-fp-",
      {
        "src/tsHostFp.ts": `export function tsHostFp() {
  return 1
}
`,
        "src/tsHostFp.ts.tether": `@symbol tsHostFp
doc {
  host
}
`,
      },
      async (root) => {
        await writeFile(
          join(root, "src/tsHostFp.ts"),
          `export function tsHostFp() {
  return 42
}
`,
        )
        await commitAll(root, "change tsHostFp body")
        const report = await lintRoot(root)
        expect(factsOf(report.facts, "host_fingerprint_changed")).toContainEqual({
          kind: "host_fingerprint_changed",
          path: "src/tsHostFp.ts.tether",
        })
      },
    )
  })

  it("ref_missing when a file sidecar @ref target is gone", async () => {
    await batteryRepo(
      "tether-ts-ref-miss-",
      {
        "src/tsRefMiss.ts": `function tsRefMiss() {
  return 1
}
`,
        "src/tsRefMiss.ts.tether": `@ref #tsMissingRef
doc {
  missing ref
}
`,
      },
      async (root) => {
        const report = await lintRoot(root)
        expect(factsOf(report.facts, "ref_missing")).toContainEqual({
          kind: "ref_missing",
          path: "src/tsRefMiss.ts.tether",
        })
      },
    )
  })

  it("ref_fingerprint_changed when the referenced symbol body changes", async () => {
    await batteryRepo(
      "tether-ts-ref-fp-",
      {
        "src/tsRefFp.ts": `export function tsRefFp() {
  return 1
}
`,
        "src/tsRefFp.ts.tether": `@ref #tsRefFp
doc {
  ref
}
`,
      },
      async (root) => {
        await writeFile(
          join(root, "src/tsRefFp.ts"),
          `export function tsRefFp() {
  return 42
}
`,
        )
        await commitAll(root, "change tsRefFp body")
        const report = await lintRoot(root)
        expect(factsOf(report.facts, "ref_fingerprint_changed")).toContainEqual({
          kind: "ref_fingerprint_changed",
          path: "src/tsRefFp.ts.tether",
        })
      },
    )
  })

  it("duplicate_id when two file sidecars share @symbol tsShared", async () => {
    await batteryRepo(
      "tether-ts-dup-id-",
      {
        "src/tsDupA.ts": `function tsShared() {
  return 1
}
`,
        "src/tsDupB.ts": `function tsShared() {
  return 2
}
`,
        "src/tsDupA.ts.tether": `@symbol tsShared
doc {
  a
}
`,
        "src/tsDupB.ts.tether": `@symbol tsShared
doc {
  b
}
`,
      },
      async (root) => {
        const report = await lintRoot(root)
        expect(factsOf(report.facts, "duplicate_id")).toEqual(
          expect.arrayContaining([
            { kind: "duplicate_id", path: "src/tsDupA.ts.tether" },
            { kind: "duplicate_id", path: "src/tsDupB.ts.tether" },
          ]),
        )
      },
    )
  })
})
