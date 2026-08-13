import { describe, expect, it } from "vitest"

import { batteryRepo, extractFiles, tethersNamed } from "../harness"

const kinds = [
  {
    kind: "associated_type",
    name: "rsAssoc",
    file: "rsAssoc.rs",
    source: `trait rsAssocHost {
    type rsAssoc;
}
`,
  },
  { kind: "const_item", name: "rsConst", file: "rsConst.rs", source: "const rsConst: i32 = 1;\n" },
  { kind: "enum_item", name: "rsEnum", file: "rsEnum.rs", source: "enum rsEnum { A }\n" },
  { kind: "function_item", name: "rsFn", file: "rsFn.rs", source: "fn rsFn() {}\n" },
  {
    kind: "function_signature_item",
    name: "rsSig",
    file: "rsSig.rs",
    source: `trait rsSigHost {
    fn rsSig();
}
`,
  },
  {
    kind: "macro_definition",
    name: "rsMacro",
    file: "rsMacro.rs",
    source: "macro_rules! rsMacro { () => {}; }\n",
  },
  { kind: "mod_item", name: "rsMod", file: "rsMod.rs", source: "mod rsMod {}\n" },
  { kind: "static_item", name: "rsStatic", file: "rsStatic.rs", source: "static rsStatic: i32 = 1;\n" },
  { kind: "struct_item", name: "rsStruct", file: "rsStruct.rs", source: "struct rsStruct;\n" },
  { kind: "trait_item", name: "rsTrait", file: "rsTrait.rs", source: "trait rsTrait {}\n" },
  { kind: "type_item", name: "rsType", file: "rsType.rs", source: "type rsType = i32;\n" },
  { kind: "union_item", name: "rsUnion", file: "rsUnion.rs", source: "union rsUnion { a: u32 }\n" },
  { kind: "impl_item", name: "rsImpl", file: "rsImpl.rs", source: "impl rsImpl {}\n" },
] as const

describe("rust symbols sidecar", () => {
  for (const entry of kinds) {
    it(`claims @symbol ${entry.name} on file host for ${entry.kind}`, async () => {
      const sidecar = `${entry.file}.tether`
      await batteryRepo(
        `tether-battery-rust-sidecar-${entry.kind}-`,
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
