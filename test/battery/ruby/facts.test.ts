import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

import { batteryRepo, factsOf, lintRoot } from "../harness"

describe("ruby facts", () => {
  it("ill_formed when @symbol disagrees with the adjacent declaration", async () => {
    await batteryRepo(
      "tether-battery-ruby-ill-adj-",
      {
        "rbIllAdj.rb": `# @tether
# @symbol rbWrong
def rbIllAdj
  1
end
`,
      },
      async (root) => {
        const report = await lintRoot(root)
        expect(factsOf(report.facts, "ill_formed")).toContainEqual({
          kind: "ill_formed",
          path: "rbIllAdj.rb",
        })
      },
    )
  })

  it("ill_formed when @symbol is on a folder tether", async () => {
    await batteryRepo(
      "tether-battery-ruby-ill-folder-",
      {
        "lib/rbKeep.rb": "def rbKeep\n  1\nend\n",
        "lib.tether": "@symbol rbFolder\n",
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
      "tether-battery-ruby-symbol-missing-",
      {
        "rbGone.rb": "def rbPresent\n  1\nend\n",
        "rbGone.rb.tether": "@symbol rbGoneMissing\n",
      },
      async (root) => {
        const report = await lintRoot(root)
        expect(factsOf(report.facts, "symbol_missing")).toContainEqual({
          kind: "symbol_missing",
          path: "rbGone.rb.tether",
        })
      },
    )
  })

  it("symbol_ambiguous when two same-name decls match sidecar @symbol", async () => {
    await batteryRepo(
      "tether-battery-ruby-symbol-ambiguous-",
      {
        "rbDup.rb": `def rbDup
  1
end

class RbDupHost
  def rbDup
    2
  end
end
`,
        "rbDup.rb.tether": "@symbol rbDup\n",
      },
      async (root) => {
        const report = await lintRoot(root)
        expect(factsOf(report.facts, "symbol_ambiguous")).toContainEqual({
          kind: "symbol_ambiguous",
          path: "rbDup.rb.tether",
        })
      },
    )
  })

  it("host_missing when the sidecar has no sibling file", async () => {
    await batteryRepo(
      "tether-battery-ruby-host-missing-",
      {
        "gone.rb.tether": "doc {\n  missing host\n}\n",
      },
      async (root) => {
        const report = await lintRoot(root)
        expect(factsOf(report.facts, "host_missing")).toContainEqual({
          kind: "host_missing",
          path: "gone.rb.tether",
        })
      },
    )
  })

  it("host_fingerprint_changed when the host body changes without touching the tether", async () => {
    await batteryRepo(
      "tether-battery-ruby-host-fp-",
      {
        "rbFp.rb": `def rbFpHost
  1
end
`,
        "rbFp.rb.tether": "doc {\n  file host\n}\n",
      },
      async (root) => {
        await writeFile(
          join(root, "rbFp.rb"),
          `def rbFpHost
  2
end
`,
        )
        const report = await lintRoot(root)
        expect(factsOf(report.facts, "host_fingerprint_changed")).toContainEqual({
          kind: "host_fingerprint_changed",
          path: "rbFp.rb.tether",
        })
      },
    )
  })

  it("ref_missing when sidecar @ref names a missing symbol", async () => {
    await batteryRepo(
      "tether-battery-ruby-ref-missing-",
      {
        "rbRef.rb": `def rbRefHost
  1
end
`,
        "rbRef.rb.tether": "@ref #rbMissingRef\n",
      },
      async (root) => {
        const report = await lintRoot(root)
        expect(factsOf(report.facts, "ref_missing")).toContainEqual({
          kind: "ref_missing",
          path: "rbRef.rb.tether",
        })
      },
    )
  })

  it("ref_fingerprint_changed when the referenced symbol body changes", async () => {
    await batteryRepo(
      "tether-battery-ruby-ref-fp-",
      {
        "rbRefFp.rb": `def rbRefFpHost
  1
end
`,
        "rbRefFp.rb.tether": "@ref #rbRefFpHost\n",
      },
      async (root) => {
        await writeFile(
          join(root, "rbRefFp.rb"),
          `def rbRefFpHost
  99
end
`,
        )
        const report = await lintRoot(root)
        expect(factsOf(report.facts, "ref_fingerprint_changed")).toContainEqual({
          kind: "ref_fingerprint_changed",
          path: "rbRefFp.rb.tether",
        })
      },
    )
  })

  it("duplicate_id when two file sidecars claim the same @symbol", async () => {
    await batteryRepo(
      "tether-battery-ruby-dup-id-",
      {
        "a.rb": "def rbShared\n  1\nend\n",
        "a.rb.tether": "@symbol rbShared\n",
        "b.rb": "def rbShared\n  1\nend\n",
        "b.rb.tether": "@symbol rbShared\n",
      },
      async (root) => {
        const report = await lintRoot(root)
        expect(factsOf(report.facts, "duplicate_id")).toEqual(
          expect.arrayContaining([
            { kind: "duplicate_id", path: "a.rb.tether" },
            { kind: "duplicate_id", path: "b.rb.tether" },
          ]),
        )
      },
    )
  })
})
