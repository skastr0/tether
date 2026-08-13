import { describe, expect, it } from "vitest"

import { batteryRepo, extractFiles, tethersNamed } from "../harness"

const inline = (name: string, body: string) => `# @tether
# @symbol ${name}
${body}
`

describe("python inline symbols", () => {
  it("function_definition binds @symbol pyFn", async () => {
    await batteryRepo(
      "tether-py-inline-fn-",
      {
        "mod.py": inline(
          "pyFn",
          `def pyFn():
    return 1
`,
        ),
      },
      async (root) => {
        const { tethers, facts } = await extractFiles(root, ["mod.py"])
        expect(facts).toEqual([])
        expect(tethersNamed(tethers, "pyFn")).toEqual([
          expect.objectContaining({
            path: "mod.py",
            host: { kind: "symbol", path: "mod.py", name: "pyFn" },
            symbols: ["pyFn"],
          }),
        ])
      },
    )
  })

  it("class_definition binds @symbol pyClass", async () => {
    await batteryRepo(
      "tether-py-inline-class-",
      {
        "mod.py": inline(
          "pyClass",
          `class pyClass:
    pass
`,
        ),
      },
      async (root) => {
        const { tethers, facts } = await extractFiles(root, ["mod.py"])
        expect(facts).toEqual([])
        expect(tethersNamed(tethers, "pyClass")[0]?.host).toEqual({
          kind: "symbol",
          path: "mod.py",
          name: "pyClass",
        })
      },
    )
  })

  it("type_alias_statement binds @symbol pyAlias", async () => {
    await batteryRepo(
      "tether-py-inline-alias-",
      {
        "mod.py": inline(
          "pyAlias",
          `type pyAlias = int
`,
        ),
      },
      async (root) => {
        const { tethers, facts } = await extractFiles(root, ["mod.py"])
        expect(facts).toEqual([])
        expect(tethersNamed(tethers, "pyAlias")[0]?.host).toEqual({
          kind: "symbol",
          path: "mod.py",
          name: "pyAlias",
        })
      },
    )
  })

  it("assignment binds @symbol pyConst", async () => {
    await batteryRepo(
      "tether-py-inline-assign-",
      {
        "mod.py": inline(
          "pyConst",
          `pyConst = 1
`,
        ),
      },
      async (root) => {
        const { tethers, facts } = await extractFiles(root, ["mod.py"])
        expect(facts).toEqual([])
        expect(tethersNamed(tethers, "pyConst")[0]?.host).toEqual({
          kind: "symbol",
          path: "mod.py",
          name: "pyConst",
        })
      },
    )
  })
})
