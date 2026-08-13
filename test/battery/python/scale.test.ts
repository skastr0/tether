import { describe, expect, it } from "vitest"

import { runExtractSearch } from "../../../src/search/index"
import { batteryRepo, extractFiles, tethersNamed } from "../harness"

const SCALE_COUNT = 80
const MIDDLE = 40
const middleName = `pyScale${String(MIDDLE).padStart(2, "0")}`

const scaleSource = Array.from({ length: SCALE_COUNT }, (_, index) => {
  const name = `pyScale${String(index).padStart(2, "0")}`
  return `# @tether
# @symbol ${name}
# Scale slot ${name} needle.
def ${name}():
    return ${index}
`
}).join("\n")

const sidecarDoc = Array.from(
  { length: 200 },
  (_, index) => `scale sidecar line ${index + 1} for ${middleName}.`,
).join("\n")

describe("python scale", () => {
  it("extracts 80 inline tethers and a 200-line sidecar; search/get find the middle symbol", async () => {
    await batteryRepo(
      "tether-py-scale-",
      {
        "scale.py": scaleSource,
        "scale.py.tether": `doc {
${sidecarDoc}
}
`,
      },
      async (root) => {
        const extracted = await extractFiles(root, ["scale.py", "scale.py.tether"])
        expect(extracted.facts).toEqual([])

        const inlines = extracted.tethers.filter(
          (tether) => tether.path === "scale.py" && tether.host.kind === "symbol",
        )
        expect(inlines).toHaveLength(SCALE_COUNT)

        const sidecar = extracted.tethers.find((tether) => tether.path === "scale.py.tether")
        expect(sidecar?.host).toEqual({ kind: "file", path: "scale.py" })
        expect(sidecar?.doc.split("\n").length).toBeGreaterThanOrEqual(200)

        const got = tethersNamed(extracted.tethers, middleName)
        expect(got).toEqual([
          expect.objectContaining({
            path: "scale.py",
            host: { kind: "symbol", path: "scale.py", name: middleName },
            symbols: [middleName],
          }),
        ])

        const search = await runExtractSearch({
          dbPath: ":memory:",
          query: middleName,
          mode: "lexical",
          limit: 10,
          source: "tethers",
          tethers: extracted.tethers,
        })
        expect(
          search.hits.some(
            (hit) =>
              hit.symbols.includes(middleName) || (hit.host.kind === "symbol" && hit.host.name === middleName),
          ),
        ).toBe(true)
      },
    )
  })
})
