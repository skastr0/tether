import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { packageNames, registryIntegrity, validateManifest } from "./publish-npm.mjs"

test("release validates exact package set, versions, leaf paths, bytes, and publish order", () => {
  const dir = mkdtempSync(join(tmpdir(), "tether-release-"))
  try {
    const manifest = packageNames.map((name, i) => {
      const bytes = Buffer.from(`test package ${i}`)
      const filename = `${i}.tgz`
      writeFileSync(join(dir, filename), bytes)
      return { name, version: "0.1.0", filename, integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}` }
    })
    assert.deepEqual(validateManifest([...manifest].reverse(), dir).map((p) => p.name), packageNames)
    assert.throws(() => validateManifest(manifest.slice(1), dir))
    assert.throws(() => validateManifest(manifest.map((p, i) => i ? p : { ...p, version: "0.2.0" }), dir))
    assert.throws(() => validateManifest(manifest.map((p, i) => i ? p : { ...p, filename: "../0.tgz" }), dir))
    writeFileSync(join(dir, "0.tgz"), "modified")
    assert.throws(() => validateManifest(manifest, dir), /Modified artifact/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test("only a registry 404 means absent; auth, outage, and malformed responses fail closed", async () => {
  const item = { name: "@skastr0/tether", version: "0.1.0" }
  assert.equal(await registryIntegrity(item, async () => new Response("", { status: 404 })), undefined)
  for (const status of [401, 403, 429, 500]) {
    await assert.rejects(registryIntegrity(item, async () => new Response("", { status })), /do not assume absence/)
  }
  await assert.rejects(registryIntegrity(item, async () => Response.json(item)))
  assert.equal(await registryIntegrity(item, async () => Response.json({ ...item, dist: { integrity: "sha512-test" } })), "sha512-test")
})
