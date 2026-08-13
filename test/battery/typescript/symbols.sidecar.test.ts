import { describe, expect, it } from "vitest"

import { batteryRepo, extractFiles, tethersNamed } from "../harness"
import { TS_KINDS, TS_SKIPPED } from "./kinds"

describe("typescript sidecar symbols", () => {
  it.each(TS_KINDS)("$kind file host claims @symbol $name", async ({ kind, name, file, bare }) => {
    const sidecar = `${file}.tether`
    await batteryRepo(
      `tether-ts-sidecar-${name}-`,
      {
        [file]: bare,
        [sidecar]: `@symbol ${name}
doc {
  ${kind}
}
`,
      },
      async (root) => {
        const result = await extractFiles(root, [file, sidecar])
        expect(result.facts).toEqual([])
        expect(tethersNamed(result.tethers, name)).toEqual([
          expect.objectContaining({
            path: sidecar,
            host: { kind: "file", path: file },
            symbols: [name],
          }),
        ])
      },
    )
  })

  it.skip.each(TS_SKIPPED)("$kind — $reason", () => {})
})
