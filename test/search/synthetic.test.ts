import { describe, expect, it } from "vitest"

import {
  DEFAULT_EMBEDDING_DIMENSIONS,
  DEFAULT_EMBEDDING_MODEL,
  makeSyntheticEmbedder,
  SyntheticEmbeddingError,
} from "../../src/search/synthetic"

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })

const embeddingPayload = (vectors: readonly (readonly number[])[]) => ({
  data: vectors.map((embedding, index) => ({ index, embedding })),
})

const unit = (at: number): number[] => {
  const vector = new Array<number>(DEFAULT_EMBEDDING_DIMENSIONS).fill(0)
  vector[at] = 1
  return vector
}

describe("makeSyntheticEmbedder", () => {
  it("POSTs to Synthetic and returns vectors by index", async () => {
    const calls: Array<{ url: string; body: unknown }> = []
    const embedder = makeSyntheticEmbedder({
      apiKey: "test-key",
      fetch: async (input, init) => {
        calls.push({ url: String(input), body: JSON.parse(String(init?.body)) })
        return jsonResponse(200, embeddingPayload([unit(0), unit(1)]))
      },
    })

    const vectors = await embedder.embedMany(["search_document: a", "search_query: b"])

    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe("https://api.synthetic.new/openai/v1/embeddings")
    expect(calls[0]?.body).toEqual({
      model: DEFAULT_EMBEDDING_MODEL,
      input: ["search_document: a", "search_query: b"],
      dimensions: DEFAULT_EMBEDDING_DIMENSIONS,
    })
    expect(vectors[0]?.[0]).toBe(1)
    expect(vectors[1]?.[1]).toBe(1)
  })

  it("retries once on 5xx then succeeds", async () => {
    let attempts = 0
    const embedder = makeSyntheticEmbedder({
      apiKey: "test-key",
      fetch: async () => {
        attempts += 1
        if (attempts === 1) {
          return jsonResponse(503, { error: "busy" })
        }
        return jsonResponse(200, embeddingPayload([unit(3)]))
      },
    })

    const vectors = await embedder.embedMany(["search_query: retry"])
    expect(attempts).toBe(2)
    expect(vectors).toHaveLength(1)
  })

  it("retries once on a malformed body", async () => {
    let attempts = 0
    const embedder = makeSyntheticEmbedder({
      apiKey: "test-key",
      fetch: async () => {
        attempts += 1
        if (attempts === 1) {
          return jsonResponse(200, { data: "nope" })
        }
        return jsonResponse(200, embeddingPayload([unit(2)]))
      },
    })

    await embedder.embedMany(["search_document: flake"])
    expect(attempts).toBe(2)
  })

  it("does not retry auth failures", async () => {
    let attempts = 0
    const embedder = makeSyntheticEmbedder({
      apiKey: "test-key",
      fetch: async () => {
        attempts += 1
        return jsonResponse(401, { error: "unauthorized" })
      },
    })

    await expect(embedder.embedMany(["search_query: x"])).rejects.toBeInstanceOf(SyntheticEmbeddingError)
    expect(attempts).toBe(1)
  })

  it("fails without an API key and never fetches", async () => {
    let attempts = 0
    const embedder = makeSyntheticEmbedder({
      apiKey: "",
      fetch: async () => {
        attempts += 1
        return jsonResponse(200, embeddingPayload([unit(0)]))
      },
    })

    await expect(embedder.embedMany(["search_query: x"])).rejects.toMatchObject({
      _tag: "SyntheticEmbeddingError",
      message: "SYNTHETIC_API_KEY is required for Synthetic embeddings",
    })
    expect(attempts).toBe(0)
  })
})
