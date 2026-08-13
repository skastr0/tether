import { describe, expect, it } from "vitest"

import { DEFAULT_EMBEDDING_DIMENSIONS } from "../../src/search/synthetic"
import {
  cosineSimilarity,
  decodeF32Vector,
  embedTextHash,
  encodeF32Vector,
  knnByHash,
  rrfScore,
  tetherEmbedText,
} from "../../src/search/vectors"

const axis = (index: number): number[] => {
  const vector = new Array<number>(DEFAULT_EMBEDDING_DIMENSIONS).fill(0)
  vector[index] = 1
  return vector
}

describe("vector helpers", () => {
  it("hashes embed text from doc, symbols, and refs", () => {
    const text = tetherEmbedText({
      doc: "Refresh session state",
      symbols: ["refreshSession"],
      refs: [{ raw: "session.ts#Session", path: "src/session.ts", name: "Session" }],
    })
    expect(text).toContain("Refresh session state")
    expect(text).toContain("refreshSession")
    expect(text).toContain("src/session.ts")
    expect(embedTextHash(text)).toHaveLength(64)
    expect(embedTextHash(text)).toBe(embedTextHash(text))
  })

  it("round-trips f32 little-endian vectors", () => {
    const decoded = decodeF32Vector(encodeF32Vector(axis(4)), DEFAULT_EMBEDDING_DIMENSIONS)
    expect(decoded[4]).toBeCloseTo(1)
    expect(decoded[0]).toBeCloseTo(0)
  })

  it("ranks cosine neighbors and scores RRF by rank", () => {
    const ranked = knnByHash(
      axis(0),
      [
        { id: 1, hash: "a" },
        { id: 2, hash: "b" },
        { id: 3, hash: "missing" },
      ],
      new Map([
        ["a", axis(1)],
        ["b", axis(0)],
      ]),
      2,
    )

    expect(ranked.map((item) => item.id)).toEqual([2, 1])
    expect(ranked[0]?.score).toBeCloseTo(1)
    expect(rrfScore(0)).toBeCloseTo(1 / 61)
    expect(cosineSimilarity(axis(0), axis(0))).toBeCloseTo(1)
  })
})
