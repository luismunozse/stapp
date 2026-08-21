import { describe, it, expect } from "vitest"
import { isMissingColumnError } from "@/lib/db-errors"

describe("isMissingColumnError", () => {
  it("matches PGRST204 (write-payload schema-cache miss)", () => {
    expect(isMissingColumnError({ code: "PGRST204" })).toBe(true)
  })

  it("matches 42703 (Postgres undefined_column, e.g. SELECT/RETURNING side)", () => {
    expect(isMissingColumnError({ code: "42703", message: "column organizations.cuit does not exist" })).toBe(true)
  })

  it("matches by message text even without a recognized code", () => {
    expect(isMissingColumnError({ code: "", message: "column organizations.cuit does not exist" })).toBe(true)
    expect(isMissingColumnError({ message: "schema cache miss for column x" })).toBe(true)
  })

  it("does not match an error with neither a matching code nor a matching message", () => {
    expect(isMissingColumnError({ code: "23505", message: "duplicate key value" })).toBe(false)
  })

  it("also matches a 'does not exist' message from a different cause (e.g. function-missing) by design", () => {
    // The "does not exist"/"schema cache" substring checks are intentionally
    // broad — same precedent as the codebase's existing isFunctionMissingError/
    // isTableMissingError helpers (e.g. app/api/ventas/[id]/pagos/route.ts).
    // This is a known false-positive surface, not a bug: callers are expected
    // to only use this helper on a query where the only plausible failure is
    // a missing column, not a mixed error channel (e.g. don't reuse it to
    // classify an RPC call that could also fail with "function ... does not
    // exist").
    expect(isMissingColumnError({ code: "42883", message: "function foo does not exist" })).toBe(true)
  })

  it("handles null/undefined/non-object input safely", () => {
    expect(isMissingColumnError(null)).toBe(false)
    expect(isMissingColumnError(undefined)).toBe(false)
    expect(isMissingColumnError("some string")).toBe(false)
  })
})
