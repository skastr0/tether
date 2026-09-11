import { describe, expect, it } from "vitest"

import { asFileSnap, snapLanguageSource } from "../../src/extract/observations"

const TAGGED_OBJECT_TYPE = "const rows = sql<{ a: string }>`SELECT 1`;\n"

describe("snapLanguageSource", () => {
  it("returns a syntax_error position for an object-literal type argument on a tagged template", async () => {
    const result = await snapLanguageSource(TAGGED_OBJECT_TYPE, "typescript")
    expect(result).toMatchObject({
      status: "syntax_error",
      position: {
        line: expect.any(Number),
        column: expect.any(Number),
        kind: expect.stringMatching(/^(ERROR|MISSING)$/),
      },
    })
    expect(asFileSnap(result)).toBeUndefined()
    if (result?.status === "syntax_error") {
      expect(result.position.line).toBeGreaterThan(0)
      expect(result.position.column).toBeGreaterThanOrEqual(0)
    }
  })

  it("returns a parsed snap for a named type argument on a tagged template", async () => {
    const result = await snapLanguageSource("type Row = { a: string }\nconst rows = sql<Row>`SELECT 1`;\n", "typescript")
    expect(result?.status).toBe("ok")
    expect(asFileSnap(result)?.decls.map((decl) => decl.name)).toEqual(expect.arrayContaining(["Row", "rows"]))
  })
})
