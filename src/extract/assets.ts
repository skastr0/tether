import { existsSync } from "node:fs"
import { createRequire } from "node:module"
import { basename, dirname, join } from "node:path"

declare const TETHER_COMPILED: boolean

const require = createRequire(import.meta.url)

/** @tether
 * Compiled packages resolve WASM beside the executable, never from the caller's
 * checkout. Source execution resolves the same assets from installed dependencies.
 */
export const resolveWasmAsset = (specifier: string): string =>
{
  if (typeof TETHER_COMPILED !== "undefined" && TETHER_COMPILED) {
    const path = join(dirname(process.execPath), "..", "assets", basename(specifier))
    if (!existsSync(path)) {
      throw new Error(`wasm asset not found: ${specifier}`)
    }
    return path
  }

  return require.resolve(specifier)
}

export const resolveRuntimeWasm = (): string =>
  resolveWasmAsset("web-tree-sitter/tree-sitter.wasm")
