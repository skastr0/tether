import { describe, expect, it } from "vitest"

import { batteryRepo, extractFiles, tethersNamed } from "../harness"

const CASES = [
  {
    kind: "function_declaration",
    name: "goFn",
    source: `package battery

// @tether
// @symbol goFn
func goFn() {}
`,
  },
  {
    kind: "method_declaration",
    name: "goMethod",
    source: `package battery

type goRecv struct{}

// @tether
// @symbol goMethod
func (r goRecv) goMethod() {}
`,
  },
  {
    kind: "type_spec",
    name: "goType",
    source: `package battery

// @tether
// @symbol goType
type goType struct{}
`,
  },
  {
    kind: "type_alias",
    name: "goAlias",
    source: `package battery

// @tether
// @symbol goAlias
type goAlias = int
`,
  },
  {
    kind: "const_spec",
    name: "goConst",
    source: `package battery

// @tether
// @symbol goConst
const goConst = 1
`,
  },
  {
    kind: "var_spec",
    name: "goVar",
    source: `package battery

// @tether
// @symbol goVar
var goVar = 2
`,
  },
  {
    kind: "field_declaration",
    name: "goField",
    source: `package battery

type goHolder struct {
	// @tether
	// @symbol goField
	goField int
}
`,
  },
  {
    kind: "method_elem",
    name: "goMethodElem",
    source: `package battery

type goIface interface {
	// @tether
	// @symbol goMethodElem
	goMethodElem()
}
`,
  },
] as const

describe("golang inline symbols", () => {
  it.each(CASES)("$kind binds @symbol $name", async ({ name, source }) => {
    await batteryRepo("tether-go-inline-", { "host.go": source }, async (root) => {
      const extracted = await extractFiles(root, ["host.go"])
      const hits = tethersNamed(extracted.tethers, name)
      expect(extracted.facts).toEqual([])
      expect(hits).toHaveLength(1)
      expect(hits[0]?.host).toEqual({ kind: "symbol", path: "host.go", name })
    })
  })
})
