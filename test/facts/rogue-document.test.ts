import { readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { Effect } from "effect"
import { describe, expect, it } from "vitest"

import { DEFAULT_MARKDOWN_ALLOWLIST } from "../../src/core/constants"
import { type Fact } from "../../src/extract/types"
import { isRogueDocument, lintRepo } from "../../src/facts/lint"
import { withTempDir } from "../helpers/cli"
import { initGitRepo } from "../helpers/git-repo"

const FIXTURE = resolve(dirname(import.meta.filename), "../fixtures/rogue-document-non-docs")
const allowlist = [...DEFAULT_MARKDOWN_ALLOWLIST]

const readFixture = (rel: string) => readFileSync(join(FIXTURE, rel), "utf8")

const factsOf = (facts: readonly Fact[], kind: Fact["kind"]) => facts.filter((fact) => fact.kind === kind)

const fixtureRepo = {
  "tests/fixtures/parity/empty-input.txt": readFixture("tests/fixtures/parity/empty-input.txt"),
  "tests/fixtures/parity/whitespace-input.txt": readFixture("tests/fixtures/parity/whitespace-input.txt"),
  "tests/fixtures/parity/plain-prose.txt": readFixture("tests/fixtures/parity/plain-prose.txt"),
  "tests/fixtures/parity/long-words.txt": readFixture("tests/fixtures/parity/long-words.txt"),
  "tests/fixtures/parity/punctuation-edge.txt": readFixture("tests/fixtures/parity/punctuation-edge.txt"),
  "tests/fixtures/parity/markdown-formatting.md": readFixture("tests/fixtures/parity/markdown-formatting.md"),
  "scripts/fixtures/agent-consumer/service.test.ts.txt": readFixture(
    "scripts/fixtures/agent-consumer/service.test.ts.txt",
  ),
  "__fixtures__/sample.txt": readFixture("__fixtures__/sample.txt"),
  "empty-root.txt": readFixture("empty-root.txt"),
  "NOTES.md": readFixture("NOTES.md"),
  "docs/guide.md": readFixture("docs/guide.md"),
}

describe("rogue_document non-document fixtures", () => {
  it("does not treat empty, fixture-path, or copied-source files as documents", () => {
    expect(isRogueDocument("empty-root.txt", allowlist, [], "")).toBe(false)
    expect(isRogueDocument("whitespace.txt", allowlist, [], "  \n\t")).toBe(false)
    expect(isRogueDocument("tests/fixtures/parity/plain-prose.txt", allowlist)).toBe(false)
    expect(isRogueDocument("test/fixtures/sample.md", allowlist, [], "# sample\n")).toBe(false)
    expect(isRogueDocument("scripts/fixtures/agent-consumer/service.test.ts.txt", allowlist)).toBe(false)
    expect(isRogueDocument("__fixtures__/sample.txt", allowlist, [], "copied parser input\n")).toBe(false)
    expect(isRogueDocument("src/__fixtures__/nested.md", allowlist, [], "# nested\n")).toBe(false)
    expect(isRogueDocument("copied.ts.txt", allowlist, [], "export const n = 1\n")).toBe(false)
    expect(isRogueDocument("NOTES.md", allowlist, [], "# homeless doctrine\n")).toBe(true)
    expect(isRogueDocument("docs/guide.md", allowlist, [], "# Guide\n")).toBe(true)
    expect(isRogueDocument("docs/README.md", allowlist)).toBe(true)
  })

  it("lints a fixture repository without flagging test inputs", async () => {
    await withTempDir("tether-rogue-fixtures-", async (root) => {
      await initGitRepo(root, fixtureRepo)
      const report = await Effect.runPromise(lintRepo(root))
      const rogue = factsOf(report.facts, "rogue_document").map((fact) => fact.path).sort()
      expect(rogue).toEqual(["NOTES.md", "docs/guide.md"])
      expect(rogue).not.toEqual(expect.arrayContaining([
        "tests/fixtures/parity/empty-input.txt",
        "tests/fixtures/parity/whitespace-input.txt",
        "tests/fixtures/parity/plain-prose.txt",
        "tests/fixtures/parity/long-words.txt",
        "tests/fixtures/parity/punctuation-edge.txt",
        "tests/fixtures/parity/markdown-formatting.md",
        "scripts/fixtures/agent-consumer/service.test.ts.txt",
        "__fixtures__/sample.txt",
        "empty-root.txt",
      ]))
    })
  })
})
