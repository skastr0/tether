import { describe, expect, it } from "vitest"

import { batteryRepo, extractFiles, tethersNamed } from "../harness"

const sidecar = (name: string) => `@symbol ${name}
doc {
  file claim on ${name}
}
`

describe("python sidecar symbols", () => {
  it("function_definition file host claims @symbol pyFn", async () => {
    await batteryRepo(
      "tether-py-side-fn-",
      {
        "mod.py": `def pyFn():
    return 1
`,
        "mod.py.tether": sidecar("pyFn"),
      },
      async (root) => {
        const { tethers, facts } = await extractFiles(root, ["mod.py", "mod.py.tether"])
        expect(facts).toEqual([])
        expect(tethersNamed(tethers, "pyFn")).toEqual([
          expect.objectContaining({
            path: "mod.py.tether",
            host: { kind: "file", path: "mod.py" },
            symbols: ["pyFn"],
          }),
        ])
      },
    )
  })

  it("class_definition file host claims @symbol pyClass", async () => {
    await batteryRepo(
      "tether-py-side-class-",
      {
        "mod.py": `class pyClass:
    pass
`,
        "mod.py.tether": sidecar("pyClass"),
      },
      async (root) => {
        const { tethers, facts } = await extractFiles(root, ["mod.py", "mod.py.tether"])
        expect(facts).toEqual([])
        expect(tethersNamed(tethers, "pyClass")[0]?.host).toEqual({ kind: "file", path: "mod.py" })
      },
    )
  })

  it("type_alias_statement file host claims @symbol pyAlias", async () => {
    await batteryRepo(
      "tether-py-side-alias-",
      {
        "mod.py": `type pyAlias = int
`,
        "mod.py.tether": sidecar("pyAlias"),
      },
      async (root) => {
        const { tethers, facts } = await extractFiles(root, ["mod.py", "mod.py.tether"])
        expect(facts).toEqual([])
        expect(tethersNamed(tethers, "pyAlias")[0]?.host).toEqual({ kind: "file", path: "mod.py" })
      },
    )
  })

  it("assignment file host claims @symbol pyConst", async () => {
    await batteryRepo(
      "tether-py-side-assign-",
      {
        "mod.py": `pyConst = 1
`,
        "mod.py.tether": sidecar("pyConst"),
      },
      async (root) => {
        const { tethers, facts } = await extractFiles(root, ["mod.py", "mod.py.tether"])
        expect(facts).toEqual([])
        expect(tethersNamed(tethers, "pyConst")[0]?.host).toEqual({ kind: "file", path: "mod.py" })
      },
    )
  })
})
