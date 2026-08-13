import { describe, expect, it } from "vitest"

import { batteryRepo, extractFiles, tethersNamed } from "../harness"

const inline = (name: string, body: string) => `// @tether
// @symbol ${name}
${body}
`

const kinds = [
  {
    kind: "associated_type",
    name: "rsAssoc",
    file: "rsAssoc.rs",
    source: `trait rsAssocHost {
${inline("rsAssoc", "    type rsAssoc;")}
}
`,
  },
  {
    kind: "const_item",
    name: "rsConst",
    file: "rsConst.rs",
    source: inline("rsConst", "const rsConst: i32 = 1;"),
  },
  {
    kind: "enum_item",
    name: "rsEnum",
    file: "rsEnum.rs",
    source: inline("rsEnum", "enum rsEnum { A }"),
  },
  {
    kind: "function_item",
    name: "rsFn",
    file: "rsFn.rs",
    source: inline("rsFn", "fn rsFn() {}"),
  },
  {
    kind: "function_signature_item",
    name: "rsSig",
    file: "rsSig.rs",
    source: `trait rsSigHost {
${inline("rsSig", "    fn rsSig();")}
}
`,
  },
  {
    kind: "macro_definition",
    name: "rsMacro",
    file: "rsMacro.rs",
    source: inline("rsMacro", "macro_rules! rsMacro { () => {}; }"),
  },
  {
    kind: "mod_item",
    name: "rsMod",
    file: "rsMod.rs",
    source: inline("rsMod", "mod rsMod {}"),
  },
  {
    kind: "static_item",
    name: "rsStatic",
    file: "rsStatic.rs",
    source: inline("rsStatic", "static rsStatic: i32 = 1;"),
  },
  {
    kind: "struct_item",
    name: "rsStruct",
    file: "rsStruct.rs",
    source: inline("rsStruct", "struct rsStruct;"),
  },
  {
    kind: "trait_item",
    name: "rsTrait",
    file: "rsTrait.rs",
    source: inline("rsTrait", "trait rsTrait {}"),
  },
  {
    kind: "type_item",
    name: "rsType",
    file: "rsType.rs",
    source: inline("rsType", "type rsType = i32;"),
  },
  {
    kind: "union_item",
    name: "rsUnion",
    file: "rsUnion.rs",
    source: inline("rsUnion", "union rsUnion { a: u32 }"),
  },
  {
    kind: "impl_item",
    name: "rsImpl",
    file: "rsImpl.rs",
    source: inline("rsImpl", "impl rsImpl {}"),
  },
] as const

describe("rust symbols inline", () => {
  for (const entry of kinds) {
    it(`binds @tether @symbol ${entry.name} to ${entry.kind}`, async () => {
      await batteryRepo(`tether-battery-rust-inline-${entry.kind}-`, { [entry.file]: entry.source }, async (root) => {
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
