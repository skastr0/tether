import { describe, expect, it } from "vitest"

import { batteryRepo, extractFiles, tethersNamed } from "../harness"
import { SWIFT_KINDS, SWIFT_SKIPPED, SWIFT_WASM_SKIP } from "./kinds"

describe("swift symbols inline", () => {
  for (const entry of SWIFT_SKIPPED) {
    it.skip(`${entry.kind} — ${entry.reason}`, () => undefined)
  }

  for (const entry of SWIFT_KINDS) {
    const title =
      SWIFT_WASM_SKIP === undefined
        ? `${entry.kind} binds @symbol ${entry.name}`
        : `${entry.kind} — ${SWIFT_WASM_SKIP}`
    const run = SWIFT_WASM_SKIP === undefined ? it : it.skip
    run(title, async () => {
      await batteryRepo(`tether-battery-swift-inline-${entry.kind}-`, { [entry.file]: entry.inline }, async (root) => {
        const extracted = await extractFiles(root, [entry.file])
        const hits = tethersNamed(extracted.tethers, entry.name)
        expect(extracted.facts).toEqual([])
        expect(hits).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              path: entry.file,
              host: { kind: "symbol", path: entry.file, name: entry.name },
              symbols: [entry.name],
            }),
          ]),
        )
      })
    })
  }
})
