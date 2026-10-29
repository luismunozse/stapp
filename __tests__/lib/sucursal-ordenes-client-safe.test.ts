// @vitest-environment node
/**
 * The order form (a client component) imports lib/sucursal-ordenes, so the module
 * must not pull in server-only code: Turbopack fails the build when next/headers
 * reaches the client graph.
 */
import { describe, it, expect, vi } from "vitest"

vi.mock("next/headers", () => {
  throw new Error("lib/sucursal-ordenes must not load next/headers")
})
vi.mock("@/lib/supabase", () => {
  throw new Error("lib/sucursal-ordenes must not load the Supabase client")
})

describe("lib/sucursal-ordenes", () => {
  it("loads without server-only modules", async () => {
    await expect(import("@/lib/sucursal-ordenes")).resolves.toHaveProperty("tecnicoOfrecido")
  })
})
