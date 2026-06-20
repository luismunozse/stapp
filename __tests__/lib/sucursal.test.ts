/**
 * Tests: resolveSucursalLectura — branch-scoping logic.
 *
 * Scenarios:
 *  SL-1 — non-admin with null userSucursalId: must return SUCURSAL_NINGUNA (fail-closed, not leak)
 *  SL-2 — non-admin with a real branch id: returns that id, verTodas false
 *  SL-3 — ADMIN without cookie / "todas" cookie: returns { sucursalId: null, verTodas: true }
 *  SL-4 — ADMIN with specific cookie id: returns that id, verTodas false
 */
import { describe, it, expect } from "vitest"
import { resolveSucursalLectura, SUCURSAL_NINGUNA } from "@/lib/sucursal"

describe("resolveSucursalLectura", () => {
  it("SL-1 — TECNICO with null sucursalId returns SUCURSAL_NINGUNA (fail-closed, not data-leak)", () => {
    const result = resolveSucursalLectura({
      role: "TECNICO",
      userSucursalId: null,
      cookieSucursalId: null,
    })
    expect(result).toEqual({ sucursalId: SUCURSAL_NINGUNA, verTodas: false })
  })

  it("SL-1b — VENDEDOR with null sucursalId also returns SUCURSAL_NINGUNA", () => {
    const result = resolveSucursalLectura({
      role: "VENDEDOR",
      userSucursalId: null,
      cookieSucursalId: null,
    })
    expect(result).toEqual({ sucursalId: SUCURSAL_NINGUNA, verTodas: false })
  })

  it("SL-2 — non-admin with a real sucursalId: returns that id, verTodas false", () => {
    const result = resolveSucursalLectura({
      role: "TECNICO",
      userSucursalId: "suc-real",
      cookieSucursalId: null,
    })
    expect(result).toEqual({ sucursalId: "suc-real", verTodas: false })
  })

  it("SL-3a — ADMIN with no cookie: verTodas true, sucursalId null", () => {
    const result = resolveSucursalLectura({
      role: "ADMIN",
      userSucursalId: null,
      cookieSucursalId: null,
    })
    expect(result).toEqual({ sucursalId: null, verTodas: true })
  })

  it('SL-3b — ADMIN with "todas" cookie: verTodas true, sucursalId null', () => {
    const result = resolveSucursalLectura({
      role: "ADMIN",
      userSucursalId: null,
      cookieSucursalId: "todas",
    })
    expect(result).toEqual({ sucursalId: null, verTodas: true })
  })

  it("SL-4 — ADMIN with specific cookie id: returns that id, verTodas false", () => {
    const result = resolveSucursalLectura({
      role: "ADMIN",
      userSucursalId: null,
      cookieSucursalId: "suc-cookie",
    })
    expect(result).toEqual({ sucursalId: "suc-cookie", verTodas: false })
  })
})
