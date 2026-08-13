import { describe, expect, it } from "vitest"

import { batteryRepo, extractFiles, tethersNamed } from "../harness"

const kinds = [
  { kind: "method", name: "rbMeth", file: "rbMeth.rb", source: "def rbMeth\n  1\nend\n" },
  { kind: "singleton_method", name: "rbSing", file: "rbSing.rb", source: "def self.rbSing\n  1\nend\n" },
  { kind: "class", name: "RbClass", file: "RbClass.rb", source: "class RbClass\nend\n" },
  { kind: "module", name: "RbMod", file: "RbMod.rb", source: "module RbMod\nend\n" },
  {
    kind: "singleton_class",
    name: "rbSclassObj",
    file: "rbSclassObj.rb",
    source: "class << rbSclassObj\nend\n",
  },
  { kind: "alias", name: "rbAlNew", file: "rbAlNew.rb", source: "alias rbAlNew rbAlOld\n" },
] as const

describe("ruby symbols sidecar", () => {
  for (const entry of kinds) {
    it(`claims @symbol ${entry.name} on file host for ${entry.kind}`, async () => {
      const sidecar = `${entry.file}.tether`
      await batteryRepo(
        `tether-battery-ruby-sidecar-${entry.kind}-`,
        {
          [entry.file]: entry.source,
          [sidecar]: `@symbol ${entry.name}\n`,
        },
        async (root) => {
          const extracted = await extractFiles(root, [entry.file, sidecar])
          const hits = tethersNamed(extracted.tethers, entry.name)
          expect(extracted.facts).toEqual([])
          expect(hits).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                path: sidecar,
                host: { kind: "file", path: entry.file },
                symbols: [entry.name],
              }),
            ]),
          )
        },
      )
    })
  }
})
