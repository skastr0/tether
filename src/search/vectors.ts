import { createHash } from "node:crypto"
import type { Database } from "bun:sqlite"

import { DEFAULT_EMBEDDING_DIMENSIONS, DEFAULT_EMBEDDING_MODEL } from "./synthetic"
import { tetherEmbedText } from "./text"

export { tetherEmbedText }

export const RRF_K = 60

const VECTOR_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS extract_vector (
  content_hash TEXT PRIMARY KEY,
  model TEXT NOT NULL,
  dims INTEGER NOT NULL,
  vector BLOB NOT NULL
);
`

export const embedTextHash = (text: string): string => createHash("sha256").update(text).digest("hex")

export const encodeF32Vector = (vector: readonly number[]): Uint8Array => {
  const out = new Uint8Array(vector.length * 4)
  const view = new DataView(out.buffer)
  for (let index = 0; index < vector.length; index += 1) {
    const value = vector[index]
    if (value === undefined || !Number.isFinite(value)) {
      throw new Error(`cannot encode non-finite embedding component at index ${index}`)
    }
    view.setFloat32(index * 4, value, true)
  }
  return out
}

export const decodeF32Vector = (blob: Uint8Array, dimensions: number): number[] => {
  const bytes = blob instanceof Uint8Array ? blob : new Uint8Array(blob)
  if (bytes.byteLength !== dimensions * 4) {
    throw new Error(`vector blob has byte length ${bytes.byteLength}; expected ${dimensions * 4}`)
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const vector = new Array<number>(dimensions)
  for (let index = 0; index < dimensions; index += 1) {
    vector[index] = view.getFloat32(index * 4, true)
  }
  return vector
}

export const cosineSimilarity = (left: readonly number[], right: readonly number[]): number => {
  const length = Math.min(left.length, right.length)
  let dot = 0
  let normLeft = 0
  let normRight = 0
  for (let index = 0; index < length; index += 1) {
    const a = left[index] ?? 0
    const b = right[index] ?? 0
    dot += a * b
    normLeft += a * a
    normRight += b * b
  }
  if (normLeft === 0 || normRight === 0) {
    return 0
  }
  return dot / (Math.sqrt(normLeft) * Math.sqrt(normRight))
}

export const rrfScore = (rank: number, k: number = RRF_K): number => 1 / (k + rank + 1)

export const ensureVectorTable = (db: Database): void => {
  db.exec(VECTOR_SCHEMA_SQL)
}

export const cachedVectorHashes = (
  db: Database,
  model: string = DEFAULT_EMBEDDING_MODEL,
  dims: number = DEFAULT_EMBEDDING_DIMENSIONS,
): Set<string> => {
  const rows = db
    .query<{ content_hash: string }, [string, number]>(
      "SELECT content_hash FROM extract_vector WHERE model = ? AND dims = ?",
    )
    .all(model, dims)
  return new Set(rows.map((row) => row.content_hash))
}

export const loadVectorMap = (
  db: Database,
  hashes: readonly string[],
  model: string = DEFAULT_EMBEDDING_MODEL,
  dims: number = DEFAULT_EMBEDDING_DIMENSIONS,
): Map<string, number[]> => {
  const map = new Map<string, number[]>()
  if (hashes.length === 0) {
    return map
  }
  const lookup = db.query<{ vector: Uint8Array }, [string, string, number]>(
    "SELECT vector FROM extract_vector WHERE content_hash = ? AND model = ? AND dims = ?",
  )
  for (const hash of hashes) {
    const row = lookup.get(hash, model, dims)
    if (row !== null) {
      map.set(hash, decodeF32Vector(row.vector, dims))
    }
  }
  return map
}

export const upsertVectors = (
  db: Database,
  rows: readonly { readonly contentHash: string; readonly vector: readonly number[] }[],
  model: string = DEFAULT_EMBEDDING_MODEL,
  dims: number = DEFAULT_EMBEDDING_DIMENSIONS,
): void => {
  const insert = db.prepare(
    "INSERT INTO extract_vector (content_hash, model, dims, vector) VALUES (?, ?, ?, ?) ON CONFLICT(content_hash) DO UPDATE SET model = excluded.model, dims = excluded.dims, vector = excluded.vector",
  )
  const writeAll = db.transaction((items: typeof rows) => {
    for (const item of items) {
      insert.run(item.contentHash, model, dims, encodeF32Vector(item.vector))
    }
  })
  writeAll(rows)
}

export const knnByHash = (
  query: readonly number[],
  candidates: readonly { readonly id: number; readonly hash: string }[],
  vectors: ReadonlyMap<string, readonly number[]>,
  limit: number,
): readonly { readonly id: number; readonly score: number }[] => {
  const scored: { readonly id: number; readonly score: number }[] = []
  for (const candidate of candidates) {
    const vector = vectors.get(candidate.hash)
    if (vector === undefined) {
      continue
    }
    scored.push({ id: candidate.id, score: cosineSimilarity(query, vector) })
  }
  scored.sort((left, right) => right.score - left.score || left.id - right.id)
  return scored.slice(0, limit)
}


