import { describe, expect, it } from "vitest"

import { asFileSnap, snapLanguageSource } from "../../src/extract/observations"

describe("snapLanguageSource", () => {
  it("returns a parsed snap for an object-literal type argument on a tagged template", async () => {
    const result = await snapLanguageSource("const rows = sql<{ a: string }>`SELECT 1`;\n", "typescript")
    expect(result?.status).toBe("ok")
    expect(asFileSnap(result)?.decls.map((decl) => decl.name)).toEqual(expect.arrayContaining(["rows"]))
  })

  it("returns a parsed snap for a named type argument on a tagged template", async () => {
    const result = await snapLanguageSource("type Row = { a: string }\nconst rows = sql<Row>`SELECT 1`;\n", "typescript")
    expect(result?.status).toBe("ok")
    expect(asFileSnap(result)?.decls.map((decl) => decl.name)).toEqual(expect.arrayContaining(["Row", "rows"]))
  })

  it("returns a syntax_error position for an unclosed declaration", async () => {
    const result = await snapLanguageSource("export function broken( {\n", "typescript")
    expect(result).toMatchObject({
      status: "syntax_error",
      position: {
        line: expect.any(Number),
        column: expect.any(Number),
        kind: expect.stringMatching(/^(ERROR|MISSING)$/),
      },
    })
    expect(asFileSnap(result)).toBeUndefined()
  })
})
