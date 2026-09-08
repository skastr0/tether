import { languageForPath } from "../extract/parser"
import type { Fact, Tether } from "../extract/types"

const containsPath = (parent: string, path: string): boolean =>
  parent === "." || path === parent || path.startsWith(`${parent}/`)

export const factsOnChangedPaths = (
  facts: readonly Fact[],
  tethers: readonly Tether[],
  changed: ReadonlySet<string>,
): readonly Fact[] => {
  if (changed.has(".tether.json")) {
    return facts
  }

  const affectedSources = new Set<string>()
  for (const tether of tethers) {
    const { host } = tether
    const affected = changed.has(tether.path) || [...changed].some((path) => {
      const hostChanged = host.kind === "file" || host.kind === "symbol"
        ? path === host.path
        : containsPath(host.path, path)
      return hostChanged || tether.refs.some((ref) => containsPath(ref.path, path))
    })
    if (affected) {
      affectedSources.add(tether.path)
    }
  }

  // Deleted doctrine sources are absent from the current extract, but can change the public compile.
  const publicSourceChanged = [...changed].some((path) =>
    path.endsWith(".tether") || languageForPath(path) !== undefined,
  )
  return facts.filter((entry) =>
    changed.has(entry.path) ||
    affectedSources.has(entry.path) ||
    (entry.kind === "public_surface_stale" && publicSourceChanged),
  )
}
