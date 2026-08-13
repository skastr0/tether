import { join } from "node:path"
import { describe, expect, it } from "vitest"

import { tetherMatchesPath, tetherMatchesSymbol } from "../../../src/commands/get"
import { runExtractSearch } from "../../../src/search/index"
import { batteryRepo, extractFiles, tethersNamed } from "../harness"

const DECL_COUNT = 80
const MIDDLE = 40
const MIDDLE_NAME = `goScale${String(MIDDLE).padStart(2, "0")}`
const NEEDLE = "golang scale needle forty"

const scaleSource = (): string => {
  const lines = ["package battery", ""]
  for (let index = 0; index < DECL_COUNT; index += 1) {
    const name = `goScale${String(index).padStart(2, "0")}`
    const body = index === MIDDLE ? NEEDLE : `golang scale filler ${index}`
    lines.push("// @tether")
    lines.push(`// @symbol ${name}`)
    lines.push("// doc {")
    lines.push(`//   ${body}`)
    lines.push("// }")
    lines.push(`func ${name}() {}`)
    lines.push("")
  }
  return lines.join("\n")
}

const scaleSidecar = (): string => {
  const lines = Array.from({ length: 200 }, (_, index) => `scale sidecar line ${index + 1}`)
  return `doc {\n${lines.join("\n")}\n}\n`
}

describe("golang scale", () => {
  it(
    "extracts 80 inline tethers and a 200-line sidecar; search/get find the middle symbol",
    async () => {
      const files = {
        "scale.go": scaleSource(),
        "scale.go.tether": scaleSidecar(),
      }

      await batteryRepo("tether-go-scale-", files, async (root) => {
        const extracted = await extractFiles(root, ["scale.go", "scale.go.tether"])
        const inlines = extracted.tethers.filter((tether) => tether.host.kind === "symbol")
        const sidecar = extracted.tethers.filter((tether) => tether.host.kind === "file")

        expect(extracted.facts).toEqual([])
        expect(inlines).toHaveLength(DECL_COUNT)
        expect(sidecar).toHaveLength(1)
        expect(sidecar[0]?.doc.split("\n").length).toBeGreaterThanOrEqual(200)
        expect(inlines.every((tether) => tether.host.kind === "symbol" && tether.host.name.startsWith("goScale"))).toBe(
          true,
        )

        const got = extracted.tethers.filter(
          (tether) => tetherMatchesPath(tether, "scale.go") && tetherMatchesSymbol(tether, MIDDLE_NAME),
        )
        expect(tethersNamed(extracted.tethers, MIDDLE_NAME)).toHaveLength(1)
        expect(got).toHaveLength(1)
        expect(got[0]?.host).toEqual({ kind: "symbol", path: "scale.go", name: MIDDLE_NAME })
        expect(got[0]?.doc).toContain(NEEDLE)

        const search = await runExtractSearch({
          dbPath: join(root, "search.sqlite"),
          query: NEEDLE,
          mode: "lexical",
          limit: 10,
          source: "tethers",
          tethers: extracted.tethers,
        })
        expect(search.hits.some((hit) => hit.symbols.includes(MIDDLE_NAME))).toBe(true)
      })
    },
    30_000,
  )
})
