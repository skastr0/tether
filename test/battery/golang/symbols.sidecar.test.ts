import { describe, expect, it } from "vitest"

import { batteryRepo, extractFiles, tethersNamed } from "../harness"

const CASES = [
  {
    kind: "function_declaration",
    name: "goFn",
    source: `package battery

func goFn() {}
`,
  },
  {
    kind: "method_declaration",
    name: "goMethod",
    source: `package battery

type goRecv struct{}

func (r goRecv) goMethod() {}
`,
  },
  {
    kind: "type_spec",
    name: "goType",
    source: `package battery

type goType struct{}
`,
  },
  {
    kind: "type_alias",
    name: "goAlias",
    source: `package battery

type goAlias = int
`,
  },
  {
    kind: "const_spec",
    name: "goConst",
    source: `package battery

const goConst = 1
`,
  },
  {
    kind: "var_spec",
    name: "goVar",
    source: `package battery

var goVar = 2
`,
  },
  {
    kind: "field_declaration",
    name: "goField",
    source: `package battery

type goHolder struct {
	goField int
}
`,
  },
  {
    kind: "method_elem",
    name: "goMethodElem",
    source: `package battery

type goIface interface {
	goMethodElem()
}
`,
  },
] as const

describe("golang sidecar symbols", () => {
  it.each(CASES)("$kind file sidecar claims @symbol $name", async ({ name, source }) => {
    await batteryRepo(
      "tether-go-sidecar-",
      {
        "host.go": source,
        "host.go.tether": `@symbol ${name}
doc {
  sidecar claim for ${name}
}
`,
      },
      async (root) => {
        const extracted = await extractFiles(root, ["host.go", "host.go.tether"])
        const hits = tethersNamed(extracted.tethers, name)
        expect(extracted.facts).toEqual([])
        expect(hits).toHaveLength(1)
        expect(hits[0]?.host).toEqual({ kind: "file", path: "host.go" })
        expect(hits[0]?.symbols).toEqual([name])
      },
    )
  })
})
