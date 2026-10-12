import { vi } from "vitest"

/**
 * DataTable's loading skeleton nests <tr> rows inside a <td> (a pre-existing
 * quirk that React reports as two console.error calls). Silences exactly those
 * two messages; anything else still reaches the real console. Pair it with
 * vi.restoreAllMocks() in afterEach.
 */
export function silenceSkeletonNoise() {
  const consoleError = console.error
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    if (!esRuidoDelSkeleton(args)) consoleError(...args)
  })
}

function esRuidoDelSkeleton([formato, ...resto]: unknown[]) {
  if (typeof formato !== "string") return false
  const [a, b] = resto
  return (
    (formato.startsWith("In HTML, %s cannot be a child of <%s>.") && a === "<tr>" && b === "td") ||
    (formato.startsWith("<%s> cannot contain a nested %s.") && a === "td" && b === "<tr>")
  )
}
