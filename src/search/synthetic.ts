import { Schema } from "effect"

export const SYNTHETIC_EMBEDDINGS_URL = "https://api.synthetic.new/openai/v1/embeddings"
export const DEFAULT_SYNTHETIC_BASE_URL = "https://api.synthetic.new/openai/v1"
export const DEFAULT_EMBEDDING_MODEL = "hf:nomic-ai/nomic-embed-text-v1.5"
export const DEFAULT_EMBEDDING_DIMENSIONS = 768
export const DOCUMENT_PREFIX = "search_document: "
export const QUERY_PREFIX = "search_query: "

// 3s timeout + one retry for truncated/malformed body, timeout, and 5xx.
const DEFAULT_SYNTHETIC_REQUEST_TIMEOUT_MS = 3_000
const SYNTHETIC_REQUEST_ATTEMPTS = 2

export class SyntheticEmbeddingError extends Schema.TaggedError<SyntheticEmbeddingError>()(
  "SyntheticEmbeddingError",
  {
    operation: Schema.String,
    message: Schema.String,
    status: Schema.optional(Schema.Number),
    cause: Schema.optional(Schema.Unknown),
  },
) {}

export interface Embedder {
  readonly embedMany: (values: readonly string[]) => Promise<readonly (readonly number[])[]>
}

export type SyntheticFetch = (input: string, init?: RequestInit) => Promise<Response>

export interface SyntheticEmbeddingClientOptions {
  readonly apiKey?: string
  readonly baseUrl?: string
  readonly fetch?: SyntheticFetch
  readonly timeoutMs?: number
  readonly model?: string
  readonly dimensions?: number
}

interface SyntheticEmbeddingData {
  readonly index: number
  readonly embedding: readonly number[]
}

interface SyntheticEmbeddingResponse {
  readonly data?: readonly SyntheticEmbeddingData[]
}

export const syntheticApiKeyFromEnv = (env: NodeJS.ProcessEnv = process.env): string | undefined => {
  const raw = env.SYNTHETIC_API_KEY?.trim()
  return raw === undefined || raw.length === 0 ? undefined : raw
}

export const resolveSyntheticApiKey = (
  override?: string,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined => {
  if (override !== undefined) {
    const trimmed = override.trim()
    return trimmed.length === 0 ? undefined : trimmed
  }
  return syntheticApiKeyFromEnv(env)
}

const syntheticRequestTimeoutMs = (override?: number): number => {
  if (override !== undefined && Number.isInteger(override) && override > 0) {
    return override
  }
  const raw = process.env.SYNTHETIC_EMBEDDING_TIMEOUT_MS?.trim()
  if (raw === undefined || raw.length === 0) {
    return DEFAULT_SYNTHETIC_REQUEST_TIMEOUT_MS
  }
  const parsed = Number(raw)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_SYNTHETIC_REQUEST_TIMEOUT_MS
}

const fetchWithTimeout = async (
  fetcher: SyntheticFetch,
  input: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> => {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetcher(input, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timeout)
  }
}

const vectorFromUnknown = (value: unknown): readonly number[] | undefined =>
  Array.isArray(value) && value.every((item) => typeof item === "number") ? value : undefined

const dataFromUnknown = (value: unknown): readonly SyntheticEmbeddingData[] | undefined => {
  if (typeof value !== "object" || value === null || !("data" in value)) {
    return undefined
  }
  const data = (value as SyntheticEmbeddingResponse).data
  if (!Array.isArray(data)) {
    return undefined
  }
  const parsed: SyntheticEmbeddingData[] = []
  for (const item of data) {
    if (typeof item !== "object" || item === null) {
      return undefined
    }
    const index = (item as { index?: unknown }).index
    const embedding = vectorFromUnknown((item as { embedding?: unknown }).embedding)
    if (typeof index !== "number" || embedding === undefined) {
      return undefined
    }
    parsed.push({ index, embedding })
  }
  return parsed
}

const validateResponseIndexes = (data: readonly SyntheticEmbeddingData[], expectedLength: number): void => {
  const seen = new Set<number>()
  for (const item of data) {
    if (!Number.isInteger(item.index) || item.index < 0 || item.index >= expectedLength || seen.has(item.index)) {
      throw new SyntheticEmbeddingError({
        operation: "synthetic.embeddings.decode",
        message: `Synthetic embeddings response included invalid index ${item.index}`,
      })
    }
    seen.add(item.index)
  }
}

const isRetryableSyntheticFailure = (cause: unknown): boolean => {
  if (cause instanceof SyntheticEmbeddingError) {
    if (cause.operation === "synthetic.embeddings.decode") {
      return true
    }
    return cause.status === 429 || (cause.status !== undefined && cause.status >= 500)
  }
  return true
}

const embedManyOnce = async (
  options: SyntheticEmbeddingClientOptions,
  values: readonly string[],
  apiKey: string,
): Promise<readonly (readonly number[])[]> => {
  const baseUrl = options.baseUrl ?? process.env.SYNTHETIC_OPENAI_BASE_URL?.trim() ?? DEFAULT_SYNTHETIC_BASE_URL
  const model = options.model ?? DEFAULT_EMBEDDING_MODEL
  const dimensions = options.dimensions ?? DEFAULT_EMBEDDING_DIMENSIONS
  const response = await fetchWithTimeout(
    options.fetch ?? fetch,
    `${baseUrl.replace(/\/$/, "")}/embeddings`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        input: [...values],
        dimensions,
      }),
    },
    syntheticRequestTimeoutMs(options.timeoutMs),
  )

  let body: unknown
  try {
    body = await response.json()
  } catch (cause) {
    throw new SyntheticEmbeddingError({
      operation: "synthetic.embeddings.decode",
      message: "Synthetic embeddings response was not JSON",
      status: response.status,
      cause,
    })
  }

  if (!response.ok) {
    const message =
      typeof body === "object" && body !== null && "error" in body
        ? JSON.stringify((body as { error: unknown }).error)
        : `Synthetic embeddings request failed with HTTP ${response.status}`
    throw new SyntheticEmbeddingError({
      operation: "synthetic.embeddings",
      message,
      status: response.status,
    })
  }

  const data = dataFromUnknown(body)
  if (data === undefined) {
    throw new SyntheticEmbeddingError({
      operation: "synthetic.embeddings.decode",
      message: "Synthetic embeddings response did not match expected shape",
    })
  }
  validateResponseIndexes(data, values.length)

  const vectors = new Array<readonly number[]>(values.length)
  for (const item of data) {
    if (item.embedding.length !== dimensions) {
      throw new SyntheticEmbeddingError({
        operation: "synthetic.embeddings.decode",
        message: `Synthetic embedding at index ${item.index} has dimension ${item.embedding.length}; expected ${dimensions}`,
      })
    }
    vectors[item.index] = item.embedding
  }
  if (vectors.some((vector) => vector === undefined)) {
    throw new SyntheticEmbeddingError({
      operation: "synthetic.embeddings.decode",
      message: "Synthetic embeddings response omitted one or more input indexes",
    })
  }
  return vectors
}

export const makeSyntheticEmbedder = (options: SyntheticEmbeddingClientOptions = {}): Embedder => ({
  embedMany: async (values) => {
    if (values.length === 0) {
      return []
    }
    const apiKey = resolveSyntheticApiKey(options.apiKey)
    if (apiKey === undefined) {
      throw new SyntheticEmbeddingError({
        operation: "synthetic.embeddings",
        message: "SYNTHETIC_API_KEY is required for Synthetic embeddings",
      })
    }

    let lastFailure: unknown
    for (let attempt = 1; attempt <= SYNTHETIC_REQUEST_ATTEMPTS; attempt += 1) {
      try {
        return await embedManyOnce(options, values, apiKey)
      } catch (cause) {
        lastFailure = cause
        if (attempt < SYNTHETIC_REQUEST_ATTEMPTS && isRetryableSyntheticFailure(cause)) {
          continue
        }
        throw cause
      }
    }
    throw lastFailure
  },
})
