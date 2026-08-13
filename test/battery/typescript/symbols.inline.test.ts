import { describe, expect, it } from "vitest"

import { batteryRepo, extractFiles, tethersNamed } from "../harness"
import { TS_KINDS, TS_SKIPPED } from "./kinds"

describe("typescript inline symbols", () => {
  it.each(TS_KINDS)("$kind binds @symbol $name", async ({ name, file, inline }) => {
    await batteryRepo(`tether-ts-inline-${name}-`, { [file]: inline }, async (root) => {
      const result = await extractFiles(root, [file])
      expect(result.facts).toEqual([])
      expect(tethersNamed(result.tethers, name)).toEqual([
        expect.objectContaining({
          path: file,
          host: { kind: "symbol", path: file, name },
          symbols: [name],
        }),
      ])
    })
  })

  it.skip.each(TS_SKIPPED)("$kind — $reason", () => {})
})
