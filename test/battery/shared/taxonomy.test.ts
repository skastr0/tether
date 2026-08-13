import { describe, expect, it } from "vitest"

import { batteryRepo, factsOf, lintRoot } from "../harness"

describe("shared fact taxonomy", () => {
  it("emits rogue_document for a tracked markdown file that is not allowlisted", async () => {
    await batteryRepo("tether-battery-rogue-", { "NOTES.md": "# homeless\n" }, async (root) => {
      const report = await lintRoot(root)
      expect(factsOf(report.facts, "rogue_document")).toContainEqual({
        kind: "rogue_document",
        path: "NOTES.md",
      })
      expect(report.failed).toBe(true)
    })
  })

  it("does not treat SKILL.md or AGENTS.md as rogue", async () => {
    await batteryRepo(
      "tether-battery-honorary-",
      {
        "AGENTS.md": "# steer\n",
        "skills/demo/SKILL.md": "# skill\n",
      },
      async (root) => {
        const report = await lintRoot(root)
        expect(factsOf(report.facts, "rogue_document")).toEqual([])
      },
    )
  })

  it("emits public_surface_stale when @public exists and the README fence is empty", async () => {
    await batteryRepo(
      "tether-battery-public-",
      {
        "root.tether": "@public\ndoc {\nPublic contract.\n}\n",
        "README.md": "# demo\n\n<!-- tether:public -->\n<!-- /tether:public -->\n",
      },
      async (root) => {
        const report = await lintRoot(root)
        expect(factsOf(report.facts, "public_surface_stale").length).toBeGreaterThan(0)
      },
    )
  })
})
