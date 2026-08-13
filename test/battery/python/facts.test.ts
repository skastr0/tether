import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

import { commitAll } from "../../helpers/git-repo"
import { batteryRepo, factsOf, lintRoot } from "../harness"

describe("python facts", () => {
  it("ill_formed when @symbol disagrees with the adjacent declaration", async () => {
    await batteryRepo(
      "tether-py-ill-adj-",
      {
        "mod.py": `# @tether
# @symbol pyWrong
def pyAdj():
    return 1
`,
      },
      async (root) => {
        const report = await lintRoot(root)
        expect(factsOf(report.facts, "ill_formed")).toContainEqual({
          kind: "ill_formed",
          path: "mod.py",
        })
      },
    )
  })

  it("ill_formed when @symbol is on a folder tether", async () => {
    await batteryRepo(
      "tether-py-ill-folder-",
      {
        "src/keep.py": `def pyKeep():
    return 1
`,
        "src.tether": `@symbol pyFolder
doc {
  folder claim is illegal
}
`,
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

  it("symbol_missing when a file sidecar names a declaration that is gone", async () => {
    await batteryRepo(
      "tether-py-sym-miss-",
      {
        "host.py": `def pyHere():
    return 1
`,
        "host.py.tether": `@symbol pyGone
doc {
  names a missing symbol
}
`,
      },
      async (root) => {
        const report = await lintRoot(root)
        expect(factsOf(report.facts, "symbol_missing")).toContainEqual({
          kind: "symbol_missing",
          path: "host.py.tether",
        })
      },
    )
  })

  it("symbol_ambiguous when two same-name decls share a sidecar @symbol", async () => {
    await batteryRepo(
      "tether-py-sym-amb-",
      {
        "dup.py": `def pyDup():
    return 1

def pyDup():
    return 2
`,
        "dup.py.tether": `@symbol pyDup
doc {
  two pyDup in one file
}
`,
      },
      async (root) => {
        const report = await lintRoot(root)
        expect(factsOf(report.facts, "symbol_ambiguous")).toContainEqual({
          kind: "symbol_ambiguous",
          path: "dup.py.tether",
        })
      },
    )
  })

  it("host_missing when gone.py.tether has no sibling file", async () => {
    await batteryRepo(
      "tether-py-host-miss-",
      {
        "gone.py.tether": `doc {
  leftover sidecar
}
`,
      },
      async (root) => {
        const report = await lintRoot(root)
        expect(factsOf(report.facts, "host_missing")).toContainEqual({
          kind: "host_missing",
          path: "gone.py.tether",
        })
      },
    )
  })

  it("host_fingerprint_changed when the host body changes and the tether does not", async () => {
    await batteryRepo(
      "tether-py-host-fp-",
      {
        "fp.py": `def pyFp():
    return 1
`,
        "fp.py.tether": `doc {
  file doctrine
}
`,
      },
      async (root) => {
        await writeFile(
          join(root, "fp.py"),
          `def pyFp():
    return 2
`,
        )
        await commitAll(root, "change pyFp body")

        const report = await lintRoot(root)
        expect(factsOf(report.facts, "host_fingerprint_changed")).toEqual([
          { kind: "host_fingerprint_changed", path: "fp.py.tether" },
        ])
      },
    )
  })

  it("ref_missing when a file sidecar @ref names a missing symbol", async () => {
    await batteryRepo(
      "tether-py-ref-miss-",
      {
        "miss.py": `def pyHere():
    return 1
`,
        "miss.py.tether": `@ref #pyMissing
doc {
  missing ref
}
`,
      },
      async (root) => {
        const report = await lintRoot(root)
        expect(factsOf(report.facts, "ref_missing")).toContainEqual({
          kind: "ref_missing",
          path: "miss.py.tether",
        })
      },
    )
  })

  it("ref_fingerprint_changed when the referenced symbol body changes", async () => {
    await batteryRepo(
      "tether-py-ref-fp-",
      {
        "ref.py": `def pyRef():
    return 1
`,
        "ref.py.tether": `@ref #pyRef
doc {
  names pyRef
}
`,
      },
      async (root) => {
        await writeFile(
          join(root, "ref.py"),
          `def pyRef():
    return 2
`,
        )
        await commitAll(root, "change pyRef body")

        const report = await lintRoot(root)
        expect(factsOf(report.facts, "ref_fingerprint_changed")).toEqual([
          { kind: "ref_fingerprint_changed", path: "ref.py.tether" },
        ])
      },
    )
  })

  it("duplicate_id when two file sidecars both @symbol Shared", async () => {
    await batteryRepo(
      "tether-py-dup-id-",
      {
        "a.py": `def pyA():
    return 1
`,
        "a.py.tether": `@symbol Shared
doc {
  one
}
`,
        "b.py": `def pyB():
    return 1
`,
        "b.py.tether": `@symbol Shared
doc {
  two
}
`,
      },
      async (root) => {
        const report = await lintRoot(root)
        expect(factsOf(report.facts, "duplicate_id")).toEqual([
          { kind: "duplicate_id", path: "a.py.tether" },
          { kind: "duplicate_id", path: "b.py.tether" },
        ])
      },
    )
  })
})
