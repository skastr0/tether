import { describe, expect, it } from "vitest"

import { batteryRepo, extractFiles, tethersNamed } from "../harness"

const inline = (name: string, body: string) => `# @tether
# @symbol ${name}
${body}
`

const kinds = [
  { kind: "method", name: "rbMeth", file: "rbMeth.rb", source: inline("rbMeth", "def rbMeth\n  1\nend") },
  {
    kind: "singleton_method",
    name: "rbSing",
    file: "rbSing.rb",
    source: inline("rbSing", "def self.rbSing\n  1\nend"),
  },
  { kind: "class", name: "RbClass", file: "RbClass.rb", source: inline("RbClass", "class RbClass\nend") },
  { kind: "module", name: "RbMod", file: "RbMod.rb", source: inline("RbMod", "module RbMod\nend") },
  {
    kind: "singleton_class",
    name: "rbSclassObj",
    file: "rbSclassObj.rb",
    source: inline("rbSclassObj", "class << rbSclassObj\nend"),
  },
  { kind: "alias", name: "rbAlNew", file: "rbAlNew.rb", source: inline("rbAlNew", "alias rbAlNew rbAlOld") },
] as const

describe("ruby symbols inline", () => {
  for (const entry of kinds) {
    it(`binds @tether @symbol ${entry.name} to ${entry.kind}`, async () => {
      await batteryRepo(`tether-battery-ruby-inline-${entry.kind}-`, { [entry.file]: entry.source }, async (root) => {
        const extracted = await extractFiles(root, [entry.file])
        const hits = tethersNamed(extracted.tethers, entry.name)
        expect(extracted.facts).toEqual([])
        expect(hits).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              path: entry.file,
              host: { kind: "symbol", path: entry.file, name: entry.name },
              symbols: [entry.name],
            }),
          ]),
        )
      })
    })
  }
})
