import { describe, expect, it } from "vitest"

import { runExtractSearch } from "../../../src/search/index"
import { batteryRepo, extractFiles, tethersNamed } from "../harness"
import { SWIFT_WASM_SKIP } from "./kinds"

const SCALE = 80
const MIDDLE = 40
const middleName = `swScale${String(MIDDLE).padStart(2, "0")}`

const scaleSource = (): string => {
  const chunks: string[] = []
  for (let index = 0; index < SCALE; index += 1) {
    const name = `swScale${String(index).padStart(2, "0")}`
    chunks.push(`// @tether
// @symbol ${name}
func ${name}() {}
`)
  }
  return chunks.join("\n")
}

const scaleDoc = (): string =>
  Array.from({ length: 200 }, (_, index) => `scale sidecar line ${index}`).join("\n")

describe("swift scale", () => {
  if (SWIFT_WASM_SKIP !== undefined) {
    it.skip(SWIFT_WASM_SKIP, () => undefined)
    return
  }

  it("extracts 80 inline tethers and a 200-line sidecar; search/get find the middle symbol", async () => {
    const source = scaleSource()
    const doc = scaleDoc()
    await batteryRepo(
      "tether-battery-swift-scale-",
      {
        "swScale.swift": source,
        "swScale.swift.tether": `doc {\n${doc}\n}\n`,
      },
      async (root) => {
        const extracted = await extractFiles(root, ["swScale.swift", "swScale.swift.tether"])
        const symbols = extracted.tethers.filter((tether) => tether.host.kind === "symbol")
        const sidecar = extracted.tethers.find((tether) => tether.path === "swScale.swift.tether")
        const middle = tethersNamed(extracted.tethers, middleName).find(
          (tether) => tether.host.kind === "symbol" && tether.host.name === middleName,
        )

        expect(extracted.facts).toEqual([])
        expect(symbols).toHaveLength(SCALE)
        expect(sidecar?.host).toEqual({ kind: "file", path: "swScale.swift" })
        expect(sidecar?.doc.split("\n").length).toBeGreaterThanOrEqual(200)
        expect(middle?.host).toEqual({ kind: "symbol", path: "swScale.swift", name: middleName })

        const search = await runExtractSearch({
          dbPath: ":memory:",
          query: middleName,
          mode: "lexical",
          limit: 10,
          source: "tethers",
          tethers: extracted.tethers,
        })
        expect(search.hits.some((hit) => hit.host.kind === "symbol" && hit.host.name === middleName)).toBe(
          true,
        )
      },
    )
  })
})
