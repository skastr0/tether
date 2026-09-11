import { createHash } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { basename, dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

declare const TETHER_COMPILED: boolean

const require = createRequire(import.meta.url)

const compiled =
  typeof TETHER_COMPILED !== "undefined" && TETHER_COMPILED

export type GrammarAssetSource = "vendored" | "npm"

export interface ResolvedGrammarFile {
  readonly path: string
  readonly source: GrammarAssetSource
  readonly sha256: string
  readonly specifier: string
}

const fileSha256 = (path: string): string =>
  createHash("sha256").update(readFileSync(path)).digest("hex")

export const defaultVendoredGrammarDir = (): string =>
  compiled
    ? join(dirname(process.execPath), "..", "assets", "vendored")
    : join(dirname(fileURLToPath(import.meta.url)), "..", "..", "grammars")

const vendoredCandidate = (specifier: string, vendoredDir: string): string =>
  join(vendoredDir, basename(specifier))

/** @tether
 * Compiled packages resolve WASM beside the executable, never from the caller's
 * checkout. Grammar wasm prefers a tether-owned vendored file over the npm
 * package, in source execution and compiled packages.
 */
export const resolveWasmAsset = (specifier: string): string => {
  if (compiled) {
    const path = join(dirname(process.execPath), "..", "assets", basename(specifier))
    if (!existsSync(path)) {
      throw new Error(`wasm asset not found: ${specifier}`)
    }
    return path
  }

  return require.resolve(specifier)
}

export const resolveGrammarFile = (
  specifier: string,
  vendoredDir = defaultVendoredGrammarDir(),
): ResolvedGrammarFile => {
  const vendored = vendoredCandidate(specifier, vendoredDir)
  if (existsSync(vendored)) {
    return { path: vendored, source: "vendored", sha256: fileSha256(vendored), specifier }
  }
  const path = resolveWasmAsset(specifier)
  return { path, source: "npm", sha256: fileSha256(path), specifier }
}

export const resolveRuntimeWasm = (): string =>
  resolveWasmAsset("web-tree-sitter/tree-sitter.wasm")
