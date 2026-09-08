import { describe, expect, it } from "vitest"

import type { Fact, Host, Ref, Tether } from "../../src/extract/types"
import { factsOnChangedPaths } from "../../src/facts/affected"

const tether = (path: string, host: Host, refs: readonly Ref[] = []): Tether => ({
  path,
  host,
  refs,
  symbols: [],
  public: false,
  doc: "",
  examples: [],
})

const fact = (path: string, kind: Fact["kind"] = "host_fingerprint_changed"): Fact => ({
  path,
  kind,
})

describe("factsOnChangedPaths", () => {
  it("selects enclosing folder and repository hosts, but not unrelated hosts or prefixes", () => {
    const tethers = [
      tether("src.tether", { kind: "folder", path: "src" }),
      tether("root.tether", { kind: "repository", path: "." }),
      tether("src2.tether", { kind: "folder", path: "src2" }),
      tether("other.tether", { kind: "folder", path: "other" }),
    ]
    const facts = tethers.map((entry) => fact(entry.path))
    expect(factsOnChangedPaths(facts, tethers, new Set(["src/nested/file.ts"])))
      .toEqual(facts.slice(0, 2))
    expect(factsOnChangedPaths(facts, tethers, new Set(["src2/file.ts"])))
      .toEqual([facts[1], facts[2]])
  })

  it.each<Host>([
    { kind: "file", path: "src/code.ts" },
    { kind: "symbol", path: "src/code.ts", name: "run" },
  ])("selects an exact $kind host or its doctrine source", (host) => {
    const tethers = [tether("src/code.ts.tether", host)]
    const facts = [fact("src/code.ts.tether")]
    for (const path of ["src/code.ts", "src/code.ts.tether"]) {
      expect(factsOnChangedPaths(facts, tethers, new Set([path]))).toEqual(facts)
    }
    expect(factsOnChangedPaths(facts, tethers, new Set(["src/code.ts/child"]))).toEqual([])
  })

  it.each([
    { ref: { raw: "target.ts", path: "target.ts" }, changed: "target.ts" },
    { ref: { raw: "target.ts#run", path: "target.ts", name: "run" }, changed: "target.ts" },
    { ref: { raw: "lib", path: "lib" }, changed: "lib/nested/target.ts" },
    { ref: { raw: ".", path: "." }, changed: "anywhere/file.ts" },
  ])("selects incoming refs to $ref.raw", ({ ref, changed }) => {
    const tethers = [tether("owner.ts.tether", { kind: "file", path: "owner.ts" }, [ref])]
    const facts = [fact("owner.ts.tether", "ref_missing")]
    expect(factsOnChangedPaths(facts, tethers, new Set([changed]))).toEqual(facts)
  })

  it("excludes ref path prefixes that are not descendants", () => {
    const tethers = [tether("owner.ts.tether", { kind: "file", path: "owner.ts" }, [
      { raw: "src", path: "src" },
    ])]
    expect(factsOnChangedPaths([fact("owner.ts.tether")], tethers, new Set(["src2/code.ts"])))
      .toEqual([])
  })

  it("unions every tether sharing a source and retains its facts once in input order", () => {
    const tethers = [
      tether("owner.ts", { kind: "symbol", path: "owner.ts", name: "first" }, [
        { raw: "target.ts", path: "target.ts" },
      ]),
      tether("owner.ts", { kind: "symbol", path: "owner.ts", name: "second" }),
    ]
    const facts = [fact("owner.ts", "ref_missing"), fact("owner.ts", "symbol_missing")]
    expect(factsOnChangedPaths(facts, tethers, new Set(["target.ts"]))).toEqual(facts)
    expect(factsOnChangedPaths(facts, [...tethers].reverse(), new Set(["target.ts"]))).toEqual(facts)
  })

  it("retains direct rogue facts without a tether and excludes unaffected facts", () => {
    const facts = [fact("notes.md", "rogue_document"), fact("other.md", "rogue_document")]
    expect(factsOnChangedPaths(facts, [], new Set(["notes.md"]))).toEqual([facts[0]])
    expect(factsOnChangedPaths(facts, [], new Set())).toEqual([])
  })

  it.each(["deleted.tether", "deleted.ts", "deleted.tsx", "deleted.js", "deleted.rs", "deleted.go", "deleted.rb", "deleted.py"])(
    "retains public-surface facts for deleted potential doctrine source %s only",
    (path) => {
      const facts = [fact("README.md", "public_surface_stale"), fact("README.md", "ill_formed"), fact("other.tether")]
      expect(factsOnChangedPaths(facts, [], new Set([path]))).toEqual([facts[0]])
    },
  )

  it("does not retain public-surface facts for unrelated non-source changes", () => {
    const facts = [fact("README.md", "public_surface_stale")]
    expect(factsOnChangedPaths(facts, [], new Set(["image.png", "notes.md"]))).toEqual([])
    expect(factsOnChangedPaths(facts, [], new Set(["README.md"]))).toEqual(facts)
  })

  it("retains all facts when repository config changes", () => {
    const facts = [fact("other.tether"), fact("notes.md", "rogue_document")]
    expect(factsOnChangedPaths(facts, [], new Set([".tether.json"]))).toEqual(facts)
    expect(factsOnChangedPaths(facts, [], new Set(["nested/.tether.json"]))).toEqual([])
  })
})
