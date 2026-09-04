import { createRequire } from "node:module"
import { basename, dirname, join } from "node:path"

declare const TETHER_COMPILED: boolean

const require = createRequire(import.meta.url)

/** @tether
 * Compiled packages resolve WASM beside the executable, never from the caller's
 * checkout. Source execution resolves the same assets from installed dependencies.
 */
export const resolveWasmAsset = (specifier: string): string =>
  typeof TETHER_COMPILED !== "undefined" && TETHER_COMPILED
    ? join(dirname(process.execPath), "..", "assets", basename(specifier))
    : require.resolve(specifier)

export const resolveRuntimeWasm = (): string =>
  resolveWasmAsset("web-tree-sitter/tree-sitter.wasm")
