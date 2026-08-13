import { describe, expect, it } from "vitest"

import { batteryRepo, extractFiles, tethersNamed } from "../harness"

const TSX_CASES = [
  {
    kind: "function_declaration",
    name: "tsxFn",
    file: "src/tsxFn.tsx",
    source: `// @tether
// @symbol tsxFn
export function tsxFn() {
  return <div />
}
`,
  },
  {
    kind: "class_declaration",
    name: "tsxClass",
    file: "src/tsxClass.tsx",
    source: `// @tether
// @symbol tsxClass
export class tsxClass {
  render() {
    return <div />
  }
}
`,
  },
  {
    kind: "method_definition",
    name: "tsxMethod",
    file: "src/tsxMethod.tsx",
    source: `export class tsxMethodHost {
  // @tether
  // @symbol tsxMethod
  tsxMethod() {
    return <span />
  }
}
`,
  },
] as const

describe("tsx inline symbols", () => {
  it.each(TSX_CASES)("$kind binds @symbol $name via tree-sitter-tsx", async ({ name, file, source }) => {
    await batteryRepo(`tether-tsx-inline-${name}-`, { [file]: source }, async (root) => {
      const result = await extractFiles(root, [file])
      expect(result.facts).toEqual([])
      expect(tethersNamed(result.tethers, name)).toEqual([
        expect.objectContaining({
          path: file,
          host: { kind: "symbol", path: file, name },
          symbols: [name],
        }),
      ])
    })
  })
})
