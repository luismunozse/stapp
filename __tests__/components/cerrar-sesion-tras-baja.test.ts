import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const signOut = vi.fn()
const isNativePlatform = vi.fn()
const clearPWATokens = vi.fn()

vi.mock("next-auth/react", () => ({ signOut: (...a: unknown[]) => signOut(...a) }))
vi.mock("@/lib/capacitor", () => ({ isNativePlatform: () => isNativePlatform() }))
vi.mock("@/components/auth/session-refresher", () => ({ clearPWATokens: () => clearPWATokens() }))

import { cerrarSesionTrasBaja } from "@/components/perfil/cerrar-sesion-tras-baja"

describe("cerrarSesionTrasBaja", () => {
  const originalLocation = window.location
  let location: { href: string }

  beforeEach(() => {
    vi.clearAllMocks()
    signOut.mockResolvedValue(undefined)
    clearPWATokens.mockResolvedValue(undefined)
    isNativePlatform.mockReturnValue(false)
    location = { href: "" }
    Object.defineProperty(window, "location", { value: location, writable: true, configurable: true })
  })

  afterEach(() => {
    Object.defineProperty(window, "location", { value: originalLocation, writable: true, configurable: true })
    localStorage.clear()
  })

  it("web: cierra sesión y manda a la landing", async () => {
    await cerrarSesionTrasBaja()
    expect(clearPWATokens).toHaveBeenCalled()
    expect(signOut).toHaveBeenCalledWith({ redirect: false })
    expect(location.href).toMatch(/^https:\/\/[^/]+\/$/)
  })

  it("nativo: limpia el slug guardado y vuelve a /app-entry", async () => {
    isNativePlatform.mockReturnValue(true)
    localStorage.setItem("stapp-tenant-slug", "taller")
    await cerrarSesionTrasBaja()
    expect(localStorage.getItem("stapp-tenant-slug")).toBeNull()
    expect(location.href).toMatch(/^https:\/\/[^/]+\/app-entry$/)
  })

  it("si signOut falla igual redirige (el tenant borrado puede dar 403)", async () => {
    signOut.mockRejectedValue(new Error("403"))
    await expect(cerrarSesionTrasBaja()).resolves.toBeUndefined()
    expect(location.href).toMatch(/^https:\/\/[^/]+\/$/)
  })

  it("si signOut falla en nativo igual limpia el slug y redirige a /app-entry", async () => {
    isNativePlatform.mockReturnValue(true)
    localStorage.setItem("stapp-tenant-slug", "taller")
    signOut.mockRejectedValue(new Error("403"))
    await cerrarSesionTrasBaja()
    expect(localStorage.getItem("stapp-tenant-slug")).toBeNull()
    expect(location.href).toMatch(/\/app-entry$/)
  })

  it("si clearPWATokens falla igual cierra sesión y redirige", async () => {
    clearPWATokens.mockRejectedValue(new Error("x"))
    await cerrarSesionTrasBaja()
    expect(signOut).toHaveBeenCalled()
    expect(location.href).toMatch(/^https:\/\//)
  })
})
