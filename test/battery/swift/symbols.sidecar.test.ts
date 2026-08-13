import { describe, expect, it } from "vitest"

import { batteryRepo, extractFiles, tethersNamed } from "../harness"
import { SWIFT_KINDS, SWIFT_SKIPPED, SWIFT_WASM_SKIP } from "./kinds"

describe("swift symbols sidecar", () => {
  for (const entry of SWIFT_SKIPPED) {
    it.skip(`${entry.kind} — ${entry.reason}`, () => undefined)
  }

  for (const entry of SWIFT_KINDS) {
    const title =
      SWIFT_WASM_SKIP === undefined
        ? `claims @symbol ${entry.name} on file host for ${entry.kind}`
        : `${entry.kind} — ${SWIFT_WASM_SKIP}`
    const run = SWIFT_WASM_SKIP === undefined ? it : it.skip
    run(title, async () => {
      const sidecar = `${entry.file}.tether`
      await batteryRepo(
        `tether-battery-swift-sidecar-${entry.kind}-`,
        {
          [entry.file]: entry.bare,
          [sidecar]: `@symbol ${entry.name}\n`,
        },
        async (root) => {
          const extracted = await extractFiles(root, [entry.file, sidecar])
          const hits = tethersNamed(extracted.tethers, entry.name)
          expect(extracted.facts).toEqual([])
          expect(hits).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                path: sidecar,
                host: { kind: "file", path: entry.file },
                symbols: [entry.name],
              }),
            ]),
          )
        },
      )
    })
  }
})
