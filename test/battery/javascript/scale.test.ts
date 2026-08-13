import { describe, expect, it } from "vitest"

import { runExtractSearch } from "../../../src/search/index"
import { batteryRepo, extractFiles, tethersNamed } from "../harness"

const SCALE_COUNT = 80
const MIDDLE = 40
const MIDDLE_NAME = `jsScale${String(MIDDLE).padStart(2, "0")}`

const scaleSource = Array.from({ length: SCALE_COUNT }, (_, index) => {
  const name = `jsScale${String(index).padStart(2, "0")}`
  return `// @tether
// @symbol ${name}
// Scale slot ${name} needle.
function ${name}() {
  return ${index}
}
`
}).join("\n")

const sidecarDoc = Array.from(
  { length: 200 },
  (_, index) => `scale sidecar line ${index + 1} for ${MIDDLE_NAME}.`,
).join("\n")

describe("javascript scale", () => {
  it("extracts 80 inline symbols and a 200-line sidecar; search/get find the middle", async () => {
    await batteryRepo(
      "tether-js-scale-",
      {
        "src/jsScale.js": scaleSource,
        "src/jsScale.js.tether": `doc {
${sidecarDoc}
}
`,
      },
      async (root) => {
        const result = await extractFiles(root, ["src/jsScale.js", "src/jsScale.js.tether"])
        expect(result.facts).toEqual([])

        const inlines = result.tethers.filter(
          (tether) => tether.path === "src/jsScale.js" && tether.host.kind === "symbol",
        )
        expect(inlines).toHaveLength(SCALE_COUNT)

        const sidecar = result.tethers.find((tether) => tether.path === "src/jsScale.js.tether")
        expect(sidecar?.host).toEqual({ kind: "file", path: "src/jsScale.js" })
        expect(sidecar?.doc.split("\n").length).toBeGreaterThanOrEqual(200)

        const got = tethersNamed(result.tethers, MIDDLE_NAME)
        expect(got).toEqual([
          expect.objectContaining({
            path: "src/jsScale.js",
            host: { kind: "symbol", path: "src/jsScale.js", name: MIDDLE_NAME },
            symbols: [MIDDLE_NAME],
          }),
        ])

        const search = await runExtractSearch({
          dbPath: ":memory:",
          query: MIDDLE_NAME,
          mode: "lexical",
          limit: 10,
          source: "tethers",
          tethers: result.tethers,
        })
        expect(
          search.hits.some(
            (hit) =>
              hit.symbols.includes(MIDDLE_NAME) ||
              (hit.host.kind === "symbol" && hit.host.name === MIDDLE_NAME),
          ),
        ).toBe(true)
      },
    )
  })
})
