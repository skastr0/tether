import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

import { commitAll } from "../../helpers/git-repo"
import { batteryRepo, factsOf, lintRoot } from "../harness"

describe("javascript facts", () => {
  it("ill_formed when @symbol disagrees with the adjacent declaration", async () => {
    await batteryRepo(
      "tether-js-ill-adj-",
      {
        "src/jsIllAdj.js": `// @tether
// @symbol jsWrong
function jsIllAdj() {
  return 1
}
`,
      },
      async (root) => {
        const report = await lintRoot(root)
        expect(factsOf(report.facts, "ill_formed")).toContainEqual({
          kind: "ill_formed",
          path: "src/jsIllAdj.js",
        })
      },
    )
  })

  it("ill_formed when @symbol is on a folder/root tether", async () => {
    await batteryRepo(
      "tether-js-ill-root-",
      {
        "root.tether": `@symbol jsRootSym
doc {
  bare name on the repo host
}
`,
        "src/jsKeep.js": `function jsKeep() {
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
      "tether-js-sym-miss-",
      {
        "src/jsPresent.js": `function jsPresent() {
  return 1
}
`,
        "src/jsPresent.js.tether": `@symbol jsGone
doc {
  gone
}
`,
      },
      async (root) => {
        const report = await lintRoot(root)
        expect(factsOf(report.facts, "symbol_missing")).toContainEqual({
          kind: "symbol_missing",
          path: "src/jsPresent.js.tether",
        })
      },
    )
  })

  it("symbol_ambiguous when two same-name decls share a sidecar @symbol", async () => {
    await batteryRepo(
      "tether-js-sym-amb-",
      {
        "src/jsDup.js": `function jsDup() {
  return 1
}
function jsDup() {
  return 2
}
`,
        "src/jsDup.js.tether": `@symbol jsDup
doc {
  two decls
}
`,
      },
      async (root) => {
        const report = await lintRoot(root)
        expect(factsOf(report.facts, "symbol_ambiguous")).toContainEqual({
          kind: "symbol_ambiguous",
          path: "src/jsDup.js.tether",
        })
      },
    )
  })

  it("host_missing when a file sidecar has no sibling", async () => {
    await batteryRepo(
      "tether-js-host-miss-",
      {
        "src/jsGone.js.tether": `doc {
  missing host
}
`,
      },
      async (root) => {
        const report = await lintRoot(root)
        expect(factsOf(report.facts, "host_missing")).toContainEqual({
          kind: "host_missing",
          path: "src/jsGone.js.tether",
        })
      },
    )
  })

  it("host_fingerprint_changed when the host body changes without the tether", async () => {
    await batteryRepo(
      "tether-js-host-fp-",
      {
        "src/jsHostFp.js": `export function jsHostFp() {
  return 1
}
`,
        "src/jsHostFp.js.tether": `@symbol jsHostFp
doc {
  host
}
`,
      },
      async (root) => {
        await writeFile(
          join(root, "src/jsHostFp.js"),
          `export function jsHostFp() {
  return 42
}
`,
        )
        await commitAll(root, "change jsHostFp body")
        const report = await lintRoot(root)
        expect(factsOf(report.facts, "host_fingerprint_changed")).toContainEqual({
          kind: "host_fingerprint_changed",
          path: "src/jsHostFp.js.tether",
        })
      },
    )
  })

  it("ref_missing when a file sidecar @ref target is gone", async () => {
    await batteryRepo(
      "tether-js-ref-miss-",
      {
        "src/jsRefMiss.js": `function jsRefMiss() {
  return 1
}
`,
        "src/jsRefMiss.js.tether": `@ref #jsMissingRef
doc {
  missing ref
}
`,
      },
      async (root) => {
        const report = await lintRoot(root)
        expect(factsOf(report.facts, "ref_missing")).toContainEqual({
          kind: "ref_missing",
          path: "src/jsRefMiss.js.tether",
        })
      },
    )
  })

  it("ref_fingerprint_changed when the referenced symbol body changes", async () => {
    await batteryRepo(
      "tether-js-ref-fp-",
      {
        "src/jsRefFp.js": `export function jsRefFp() {
  return 1
}
`,
        "src/jsRefFp.js.tether": `@ref #jsRefFp
doc {
  ref
}
`,
      },
      async (root) => {
        await writeFile(
          join(root, "src/jsRefFp.js"),
          `export function jsRefFp() {
  return 42
}
`,
        )
        await commitAll(root, "change jsRefFp body")
        const report = await lintRoot(root)
        expect(factsOf(report.facts, "ref_fingerprint_changed")).toContainEqual({
          kind: "ref_fingerprint_changed",
          path: "src/jsRefFp.js.tether",
        })
      },
    )
  })

  it("duplicate_id when two file sidecars share @symbol jsShared", async () => {
    await batteryRepo(
      "tether-js-dup-id-",
      {
        "src/jsDupA.js": `function jsShared() {
  return 1
}
`,
        "src/jsDupB.js": `function jsShared() {
  return 2
}
`,
        "src/jsDupA.js.tether": `@symbol jsShared
doc {
  a
}
`,
        "src/jsDupB.js.tether": `@symbol jsShared
doc {
  b
}
`,
      },
      async (root) => {
        const report = await lintRoot(root)
        expect(factsOf(report.facts, "duplicate_id")).toEqual(
          expect.arrayContaining([
            { kind: "duplicate_id", path: "src/jsDupA.js.tether" },
            { kind: "duplicate_id", path: "src/jsDupB.js.tether" },
          ]),
        )
      },
    )
  })
})
