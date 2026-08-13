import { describe, expect, it } from "vitest"

import { runExtractSearch } from "../../../src/search/index"
import { batteryRepo, extractFiles, tethersNamed } from "../harness"

const SCALE = 80
const MIDDLE = 40
const middleName = `rbScale${String(MIDDLE).padStart(2, "0")}`

const scaleSource = (): string => {
  const chunks: string[] = []
  for (let index = 0; index < SCALE; index += 1) {
    const name = `rbScale${String(index).padStart(2, "0")}`
    chunks.push(`# @tether
# @symbol ${name}
def ${name}
  ${index}
end
`)
  }
  return chunks.join("\n")
}

const scaleDoc = (): string =>
  Array.from({ length: 200 }, (_, index) => `scale sidecar line ${index}`).join("\n")

describe("ruby scale", () => {
  it("extracts 80 inline tethers and a 200-line sidecar; search/get find the middle symbol", async () => {
    const source = scaleSource()
    const doc = scaleDoc()
    await batteryRepo(
      "tether-battery-ruby-scale-",
      {
        "rbScale.rb": source,
        "rbScale.rb.tether": `doc {\n${doc}\n}\n`,
      },
      async (root) => {
        const extracted = await extractFiles(root, ["rbScale.rb", "rbScale.rb.tether"])
        const symbols = extracted.tethers.filter((tether) => tether.host.kind === "symbol")
        const sidecar = extracted.tethers.find((tether) => tether.path === "rbScale.rb.tether")
        const middle = tethersNamed(extracted.tethers, middleName).find(
          (tether) => tether.host.kind === "symbol" && tether.host.name === middleName,
        )

        expect(extracted.facts).toEqual([])
        expect(symbols).toHaveLength(SCALE)
        expect(sidecar?.host).toEqual({ kind: "file", path: "rbScale.rb" })
        expect(sidecar?.doc.split("\n").length).toBeGreaterThanOrEqual(200)
        expect(middle?.host).toEqual({ kind: "symbol", path: "rbScale.rb", name: middleName })

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
