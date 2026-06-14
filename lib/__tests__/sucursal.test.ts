import { describe, it, expect } from "vitest"
import { resolveSucursalLectura, resolveSucursalEscritura } from "@/lib/sucursal"

describe("resolveSucursalLectura", () => {
  it("TECNICO se filtra por su sucursal fija", () => {
    const r = resolveSucursalLectura({ role: "TECNICO", userSucursalId: "suc-1", cookieSucursalId: null })
    expect(r).toEqual({ sucursalId: "suc-1", verTodas: false })
  })

  it("VENDEDOR se filtra por su sucursal fija (ignora cookie)", () => {
    const r = resolveSucursalLectura({ role: "VENDEDOR", userSucursalId: "suc-2", cookieSucursalId: "suc-9" })
    expect(r).toEqual({ sucursalId: "suc-2", verTodas: false })
  })

  it("ADMIN sin cookie => ve todas (sin filtro)", () => {
    const r = resolveSucursalLectura({ role: "ADMIN", userSucursalId: null, cookieSucursalId: null })
    expect(r).toEqual({ sucursalId: null, verTodas: true })
  })

  it("ADMIN con cookie de sucursal => filtra por esa", () => {
    const r = resolveSucursalLectura({ role: "ADMIN", userSucursalId: null, cookieSucursalId: "suc-3" })
    expect(r).toEqual({ sucursalId: "suc-3", verTodas: false })
  })

  it("ADMIN con cookie 'todas' => ve todas", () => {
    const r = resolveSucursalLectura({ role: "ADMIN", userSucursalId: null, cookieSucursalId: "todas" })
    expect(r).toEqual({ sucursalId: null, verTodas: true })
  })
})

describe("resolveSucursalEscritura", () => {
  it("TECNICO escribe en su sucursal fija", () => {
    const r = resolveSucursalEscritura({ role: "TECNICO", userSucursalId: "suc-1", cookieSucursalId: null, principalId: "suc-p" })
    expect(r).toBe("suc-1")
  })

  it("ADMIN sin cookie escribe en la principal (Casa Central)", () => {
    const r = resolveSucursalEscritura({ role: "ADMIN", userSucursalId: null, cookieSucursalId: null, principalId: "suc-p" })
    expect(r).toBe("suc-p")
  })

  it("ADMIN con cookie de sucursal escribe en esa", () => {
    const r = resolveSucursalEscritura({ role: "ADMIN", userSucursalId: null, cookieSucursalId: "suc-3", principalId: "suc-p" })
    expect(r).toBe("suc-3")
  })

  it("ADMIN con cookie 'todas' cae a la principal para escribir", () => {
    const r = resolveSucursalEscritura({ role: "ADMIN", userSucursalId: null, cookieSucursalId: "todas", principalId: "suc-p" })
    expect(r).toBe("suc-p")
  })
})
