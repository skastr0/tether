import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const fixtures = dirname(fileURLToPath(import.meta.url))

const cases = [
  { file: "javascript/adjacency.js", symbol: "greetJs", fn: /export function greetJs\(/ },
  { file: "typescript/adjacency.ts", symbol: "greetTs", fn: /export function greetTs\(/ },
  { file: "python/bind.py", symbol: "greetPy", fn: /def greetPy\(/ },
  { file: "ruby/adjacency.rb", symbol: "greetRb", fn: /def greetRb\(/ },
  { file: "rust/sample.rs", symbol: "greetRs", fn: /pub fn greetRs\(/ },
  { file: "golang/sample.go", symbol: "greetGo", fn: /func greetGo\(/ },
] as const

describe("demo fixture symbols", () => {
  it("uses a unique @symbol and matching function name per language", () => {
    const symbols: string[] = []
    for (const entry of cases) {
      const source = readFileSync(join(fixtures, entry.file), "utf8")
      const match = /^[^\n]*@symbol (\S+)/m.exec(source)
      expect(match?.[1], entry.file).toBe(entry.symbol)
      expect(source, entry.file).toMatch(entry.fn)
      symbols.push(entry.symbol)
    }
    expect(new Set(symbols).size).toBe(symbols.length)
  })
})
