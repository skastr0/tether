import { describe, expect, it } from "vitest"

import { batteryRepo, extractFiles, tethersNamed } from "../harness"

describe("tsx production inline", () => {
  it("binds a function component", async () => {
    await batteryRepo(
      "tether-tsx-fn-",
      {
        "Pay.tsx": `// @tether
// @symbol PayButton
export function PayButton() {
  return <button />
}
`,
      },
      async (root) => {
        const result = await extractFiles(root, ["Pay.tsx"])
        expect(result.facts).toEqual([])
        expect(tethersNamed(result.tethers, "PayButton")[0]?.host).toEqual({
          kind: "symbol",
          path: "Pay.tsx",
          name: "PayButton",
        })
      },
    )
  })
})
