import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/sucursal", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sucursal")>()),
  sucursalParaLectura: vi.fn(),
  getDepositoDeSucursal: vi.fn(),
}))

import { SUCURSAL_NINGUNA, sucursalParaLectura, getDepositoDeSucursal } from "@/lib/sucursal"
import { depositoPorDefecto } from "@/lib/depositos"

describe("depositoPorDefecto", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("no-admin con sucursal: devuelve el deposito de SU sucursal", async () => {
    vi.mocked(sucursalParaLectura).mockResolvedValue({ sucursalId: "suc-b", verTodas: false })
    vi.mocked(getDepositoDeSucursal).mockResolvedValue("dep-b")

    const id = await depositoPorDefecto({ organizationId: "org-1", role: "VENDEDOR", userSucursalId: "suc-b" })

    expect(id).toBe("dep-b")
    expect(sucursalParaLectura).toHaveBeenCalledWith({ role: "VENDEDOR", userSucursalId: "suc-b" })
    expect(getDepositoDeSucursal).toHaveBeenCalledWith("org-1", "suc-b")
  })

  it("no-admin sin sucursal: null y ni consulta el deposito", async () => {
    vi.mocked(sucursalParaLectura).mockResolvedValue({ sucursalId: SUCURSAL_NINGUNA, verTodas: false })

    const id = await depositoPorDefecto({ organizationId: "org-1", role: "TECNICO", userSucursalId: null })

    expect(id).toBeNull()
    expect(getDepositoDeSucursal).not.toHaveBeenCalled()
  })

  it("ADMIN con una sucursal elegida en la cookie: el deposito de esa sucursal", async () => {
    vi.mocked(sucursalParaLectura).mockResolvedValue({ sucursalId: "suc-cookie", verTodas: false })
    vi.mocked(getDepositoDeSucursal).mockResolvedValue("dep-cookie")

    const id = await depositoPorDefecto({ organizationId: "org-1", role: "ADMIN", userSucursalId: null })

    expect(id).toBe("dep-cookie")
    expect(getDepositoDeSucursal).toHaveBeenCalledWith("org-1", "suc-cookie")
  })

  it("ADMIN viendo todas: null (conserva el comportamiento actual) y no consulta", async () => {
    vi.mocked(sucursalParaLectura).mockResolvedValue({ sucursalId: null, verTodas: true })

    const id = await depositoPorDefecto({ organizationId: "org-1", role: "ADMIN", userSucursalId: null })

    expect(id).toBeNull()
    expect(getDepositoDeSucursal).not.toHaveBeenCalled()
  })

  it("la sucursal no tiene deposito: null", async () => {
    vi.mocked(sucursalParaLectura).mockResolvedValue({ sucursalId: "suc-b", verTodas: false })
    vi.mocked(getDepositoDeSucursal).mockResolvedValue(null)

    expect(
      await depositoPorDefecto({ organizationId: "org-1", role: "VENDEDOR", userSucursalId: "suc-b" })
    ).toBeNull()
  })
})
