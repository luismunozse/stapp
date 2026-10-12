import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  ORDEN_PRACTICA_ERROR,
  PRACTICA_NUMERO_ORDEN,
  PRACTICA_PROBLEMAS_GENERICOS,
} from "@/lib/onboarding/practica-shared"

describe("practica-shared", () => {
  it("pins the values PR 2 and PR 3 rely on", () => {
    expect(PRACTICA_NUMERO_ORDEN).toBe(0)
    expect(PRACTICA_PROBLEMAS_GENERICOS).toEqual(["No enciende", "Funciona con fallas", "Hace ruido", "Mantenimiento"])
    expect(ORDEN_PRACTICA_ERROR).toEqual({ error: "Es una orden de práctica", code: "ORDEN_PRACTICA" })
  })

  it("stays client-safe: no server imports", () => {
    const src = readFileSync(join(process.cwd(), "lib/onboarding/practica-shared.ts"), "utf8")
    expect(src).not.toMatch(/from\s+["'][^"']*supabase/)
    expect(src).not.toMatch(/from\s+["']next\/server["']/)
  })
})
