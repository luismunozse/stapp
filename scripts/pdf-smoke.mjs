// scripts/pdf-smoke.mjs
// Boots the production build and renders every react-pdf document.
//
// Why this exists: neither test layer can see a bundle-level failure. Vitest
// never compiles with Next; Playwright compiles with Next but points at
// `npm run dev` (playwright.config.ts). React error #31 went between the two
// and shipped every PDF route broken. This closes that gap.
import { spawn, spawnSync } from "node:child_process"
import net from "node:net"

const PORT = process.env.PDF_SMOKE_PORT || "3977"
const URL = `http://127.0.0.1:${PORT}/api/public/pdf-smoke`
const MIN_BYTES = 1000
const BOOT_TIMEOUT_MS = 90_000

// A `taskkill`/`.kill()` at the end of *this* run only ever cleans up *this*
// run's server. If an earlier run crashed before reaching its own shutdown
// (or was killed hard enough to skip it), its `next start` can still be
// listening. Silently talking to that stale server would validate a build
// that isn't the one we just produced — refuse loudly instead of guessing.
function isPortFree(port) {
  return new Promise((resolve) => {
    const tester = net.createServer()
    tester.once("error", () => resolve(false))
    tester.once("listening", () => tester.close(() => resolve(true)))
    tester.listen(port, "127.0.0.1")
  })
}

if (!(await isPortFree(PORT))) {
  console.error(
    `\n✗ pdf-smoke: port ${PORT} is already in use. A server from a previous run may still ` +
      `be holding it, which would make this run silently validate a stale build. Find and stop ` +
      `whatever is listening on ${PORT} (or set PDF_SMOKE_PORT to a free port) and retry.`
  )
  process.exit(1)
}

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

// If the server process dies (or never starts) before the poll loop below
// gets a successful response, that is the real failure — not the 90s
// timeout it would otherwise surface. `stdio: "inherit"` already printed
// the server's own crash output above; this just makes sure the script
// stops waiting and blames the right thing.
let serverDied = null
server.on("error", (err) => {
  serverDied = `the server process could not be started: ${err.message}`
})
server.on("exit", (code, signal) => {
  if (!shutDown) {
    serverDied = `the server process exited before it answered (code ${code}${
      signal ? `, signal ${signal}` : ""
    }) — see the server output above for the real error`
  }
})

const deadline = Date.now() + BOOT_TIMEOUT_MS
let body = null

while (Date.now() < deadline) {
  if (serverDied) fail(serverDied)

  let res
  try {
    res = await fetch(URL)
  } catch {
    // Connection-level failure (ECONNREFUSED and friends) — the server
    // simply isn't up yet. `next start` needs a few seconds. A response
    // that DID arrive is handled below, separately, so a crash page can
    // never be mistaken for "not up yet".
    if (serverDied) fail(serverDied)
    await new Promise((r) => setTimeout(r, 1000))
    continue
  }

  const text = await res.text()
  try {
    body = JSON.parse(text)
  } catch {
    // The server answered but the body isn't JSON — exactly what a
    // framework crash page looks like. Surface it now instead of letting
    // the loop keep polling until it times out.
    fail(
      `the server responded with status ${res.status} but the body was not valid JSON ` +
        `(likely a crash page):\n${text.slice(0, 500)}`
    )
  }

  if (res.status === 404) fail("the route 404'd — PDF_SMOKE did not reach the server process")
  if (!res.ok) {
    console.error(body)
    fail(`the server returned ${res.status}: ${body?.error ?? "unknown error"}`)
  }
  break
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
