import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

import { commitAll } from "../../helpers/git-repo"
import { batteryRepo, factsOf, lintRoot } from "../harness"

describe("golang facts", () => {
  it("ill_formed when @symbol disagrees with the adjacent declaration", async () => {
    await batteryRepo(
      "tether-go-ill-adj-",
      {
        "host.go": `package battery

// @tether
// @symbol goWrong
func goFn() {}
`,
      },
      async (root) => {
        const report = await lintRoot(root)
        expect(factsOf(report.facts, "ill_formed")).toContainEqual({
          kind: "ill_formed",
          path: "host.go",
        })
      },
    )
  })

  it("ill_formed when @symbol is on a folder tether", async () => {
    await batteryRepo(
      "tether-go-ill-folder-",
      {
        "pkg/keep.go": "package pkg\n",
        "pkg.tether": `@symbol goFolderId
doc {
  folder ids are not file symbols
}
`,
      },
      async (root) => {
        const report = await lintRoot(root)
        expect(factsOf(report.facts, "ill_formed")).toContainEqual({
          kind: "ill_formed",
          path: "pkg.tether",
        })
      },
    )
  })

  it("symbol_missing when a file sidecar names an absent declaration", async () => {
    await batteryRepo(
      "tether-go-sym-miss-",
      {
        "host.go": `package battery

func goFn() {}
`,
        "host.go.tether": `@symbol goGone
doc {
  gone is not in host.go
}
`,
      },
      async (root) => {
        const report = await lintRoot(root)
        expect(factsOf(report.facts, "symbol_missing")).toContainEqual({
          kind: "symbol_missing",
          path: "host.go.tether",
        })
      },
    )
  })

  it("symbol_ambiguous when a file sidecar names a duplicated declaration", async () => {
    await batteryRepo(
      "tether-go-sym-amb-",
      {
        "host.go": `package battery

func goDup() {}
func goDup() {}
`,
        "host.go.tether": `@symbol goDup
doc {
  two goDup decls
}
`,
      },
      async (root) => {
        const report = await lintRoot(root)
        expect(factsOf(report.facts, "symbol_ambiguous")).toContainEqual({
          kind: "symbol_ambiguous",
          path: "host.go.tether",
        })
      },
    )
  })

  it("host_missing when a file sidecar has no sibling", async () => {
    await batteryRepo(
      "tether-go-host-miss-",
      {
        "gone.go.tether": `doc {
  no gone.go sibling
}
`,
      },
      async (root) => {
        const report = await lintRoot(root)
        expect(factsOf(report.facts, "host_missing")).toContainEqual({
          kind: "host_missing",
          path: "gone.go.tether",
        })
      },
    )
  })

  it("host_fingerprint_changed when the host body changes without the tether", async () => {
    await batteryRepo(
      "tether-go-host-fp-",
      {
        "host.go": `package battery

func goHost() {}
`,
        "host.go.tether": `doc {
  file doctrine
}
`,
      },
      async (root) => {
        await writeFile(join(root, "host.go"), `package battery

func goHost() { _ = 1 }
`)
        await commitAll(root, "change host")
        const report = await lintRoot(root)
        expect(factsOf(report.facts, "host_fingerprint_changed")).toEqual([
          { kind: "host_fingerprint_changed", path: "host.go.tether" },
        ])
      },
    )
  })

  it("ref_missing when a file sidecar refs an absent symbol", async () => {
    await batteryRepo(
      "tether-go-ref-miss-",
      {
        "host.go": `package battery

func goFn() {}
`,
        "host.go.tether": `@ref #goMissing
doc {
  missing target
}
`,
      },
      async (root) => {
        const report = await lintRoot(root)
        expect(factsOf(report.facts, "ref_missing")).toContainEqual({
          kind: "ref_missing",
          path: "host.go.tether",
        })
      },
    )
  })

  it("ref_fingerprint_changed when a referenced symbol body changes", async () => {
    await batteryRepo(
      "tether-go-ref-fp-",
      {
        "host.go": `package battery

func goRef() {}
`,
        "host.go.tether": `@ref #goRef
doc {
  names goRef
}
`,
      },
      async (root) => {
        await writeFile(join(root, "host.go"), `package battery

func goRef() { _ = 1 }
`)
        await commitAll(root, "change goRef")
        const report = await lintRoot(root)
        expect(factsOf(report.facts, "ref_fingerprint_changed")).toEqual([
          { kind: "ref_fingerprint_changed", path: "host.go.tether" },
        ])
      },
    )
  })

  it("duplicate_id when two file sidecars share @symbol goShared", async () => {
    await batteryRepo(
      "tether-go-dup-id-",
      {
        "a.go": `package battery

func goShared() {}
`,
        "a.go.tether": `@symbol goShared
doc {
  first
}
`,
        "b.go": `package battery

func goShared() {}
`,
        "b.go.tether": `@symbol goShared
doc {
  second
}
`,
      },
      async (root) => {
        const report = await lintRoot(root)
        expect(factsOf(report.facts, "duplicate_id")).toEqual([
          { kind: "duplicate_id", path: "a.go.tether" },
          { kind: "duplicate_id", path: "b.go.tether" },
        ])
      },
    )
  })
})
