// scripts/pdf-smoke.mjs
// Boots the production build and renders every react-pdf document.
//
// Why this exists: neither test layer can see a bundle-level failure. Vitest
// never compiles with Next; Playwright compiles with Next but points at
// `npm run dev` (playwright.config.ts). React error #31 went between the two
// and shipped every PDF route broken. This closes that gap.
import { spawn, spawnSync } from "node:child_process"

const PORT = process.env.PDF_SMOKE_PORT || "3977"
const URL = `http://127.0.0.1:${PORT}/api/public/pdf-smoke`
const MIN_BYTES = 1000
const BOOT_TIMEOUT_MS = 90_000

const server = spawn("npx", ["next", "start", "-p", PORT], {
  env: { ...process.env, PDF_SMOKE: "1" },
  stdio: ["ignore", "inherit", "inherit"],
  shell: process.platform === "win32",
})

// On Windows, `shell: true` wraps the child in a cmd.exe process, so
// `next start` runs as a grandchild. server.kill() only kills the cmd.exe
// wrapper, leaving the real server orphaned and holding the port — a later
// run of this script would then silently talk to that stale server instead
// of the fresh build. `taskkill /t` kills the whole process tree instead.
let shutDown = false
const shutdown = () => {
  if (shutDown || server.killed) return
  shutDown = true
  if (process.platform === "win32" && server.pid) {
    spawnSync("taskkill", ["/pid", String(server.pid), "/t", "/f"])
  } else {
    server.kill()
  }
}
process.on("exit", shutdown)

const fail = (msg) => {
  console.error(`\n✗ pdf-smoke: ${msg}`)
  shutdown()
  process.exit(1)
}

const deadline = Date.now() + BOOT_TIMEOUT_MS
let body = null

while (Date.now() < deadline) {
  try {
    const res = await fetch(URL)
    body = await res.json()
    if (res.status === 404) fail("the route 404'd — PDF_SMOKE did not reach the server process")
    if (!res.ok) {
      console.error(body)
      fail(`the server returned ${res.status}: ${body?.error ?? "unknown error"}`)
    }
    break
  } catch {
    // Server not up yet. `next start` needs a few seconds.
    await new Promise((r) => setTimeout(r, 1000))
  }
}

if (!body) fail(`the server never answered within ${BOOT_TIMEOUT_MS / 1000}s`)

const documentos = body.documentos ?? {}
const nombres = Object.keys(documentos)
if (nombres.length === 0) fail("the route rendered no documents at all")

for (const [nombre, bytes] of Object.entries(documentos)) {
  if (typeof bytes !== "number" || bytes < MIN_BYTES) {
    fail(`${nombre} rendered ${bytes} bytes, expected more than ${MIN_BYTES}`)
  }
  console.log(`  ✓ ${nombre}: ${bytes} bytes`)
}

console.log(`\n✓ pdf-smoke: ${nombres.length} documentos renderizados en un build de produccion`)
shutdown()
process.exit(0)
