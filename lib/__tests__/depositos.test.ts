import { describe, it, expect, vi, beforeEach } from "vitest"
import { supabaseAdmin } from "@/lib/supabase"
import { SUCURSAL_NINGUNA } from "@/lib/sucursal"
import {
  DEPOSITO_INVALIDO,
  depositoPermitido,
  sucursalRequeridaParaDeposito,
  depositoUsableDesde,
} from "@/lib/depositos"

function chainCon(resultado: { data: unknown; error: unknown }) {
  const chain: any = {}
  for (const m of ["select", "eq", "is"]) chain[m] = vi.fn().mockReturnValue(chain)
  chain.maybeSingle = vi.fn().mockResolvedValue(resultado)
  vi.mocked(supabaseAdmin.from).mockReturnValue(chain as any)
  return chain
}

const base = { depositoId: "dep-1", organizationId: "org-1" }

describe("DEPOSITO_INVALIDO", () => {
  it("es el mensaje generico unico", () => {
    expect(DEPOSITO_INVALIDO).toBe("El depósito elegido no es válido")
  })
})

describe("sucursalRequeridaParaDeposito (regla pura)", () => {
  it("ADMIN no queda atado a ninguna sucursal", () => {
    expect(
      sucursalRequeridaParaDeposito({ role: "ADMIN", userSucursalId: "suc-1", alcance: "sucursal" })
    ).toBeNull()
  })

  it("no-admin queda atado a su sucursal", () => {
    expect(
      sucursalRequeridaParaDeposito({ role: "VENDEDOR", userSucursalId: "suc-1", alcance: "sucursal" })
    ).toBe("suc-1")
  })

  it("no-admin sin sucursal cae al sentinel (fail-closed)", () => {
    expect(
      sucursalRequeridaParaDeposito({ role: "TECNICO", userSucursalId: null, alcance: "sucursal" })
    ).toBe(SUCURSAL_NINGUNA)
  })

  it("alcance organizacion no exige sucursal ni al no-admin", () => {
    expect(
      sucursalRequeridaParaDeposito({ role: "VENDEDOR", userSucursalId: "suc-1", alcance: "organizacion" })
    ).toBeNull()
  })
})

describe("depositoUsableDesde (misma regla sobre una fila ya leida)", () => {
  const fila = { activo: true, deleted_at: null, sucursal_id: "suc-1" }

  it("ADMIN usa cualquier deposito activo de la org", () => {
    expect(
      depositoUsableDesde({ ...fila, sucursal_id: "suc-2" }, { role: "ADMIN", userSucursalId: null, alcance: "sucursal" })
    ).toBe(true)
  })

  it("no-admin solo el de su sucursal", () => {
    const ctx = { role: "VENDEDOR", userSucursalId: "suc-1", alcance: "sucursal" as const }
    expect(depositoUsableDesde(fila, ctx)).toBe(true)
    expect(depositoUsableDesde({ ...fila, sucursal_id: "suc-2" }, ctx)).toBe(false)
  })

  it("no-admin sin sucursal no puede usar ninguno", () => {
    expect(
      depositoUsableDesde(fila, { role: "TECNICO", userSucursalId: null, alcance: "sucursal" })
    ).toBe(false)
  })

  it("un deposito inactivo o borrado nunca es usable", () => {
    const ctx = { role: "ADMIN", userSucursalId: null, alcance: "organizacion" as const }
    expect(depositoUsableDesde({ ...fila, activo: false }, ctx)).toBe(false)
    expect(depositoUsableDesde({ ...fila, deleted_at: "2026-01-01" }, ctx)).toBe(false)
  })
})

describe("depositoPermitido", () => {
  beforeEach(() => vi.clearAllMocks())

  it("ADMIN: filtra por org/activo/no borrado y NO por sucursal", async () => {
    const chain = chainCon({ data: { id: "dep-1" }, error: null })

    const ok = await depositoPermitido({ ...base, role: "ADMIN", userSucursalId: "suc-1" })

    expect(ok).toBe(true)
    expect(supabaseAdmin.from).toHaveBeenCalledWith("depositos")
    expect(chain.eq).toHaveBeenCalledWith("id", "dep-1")
    expect(chain.eq).toHaveBeenCalledWith("organization_id", "org-1")
    expect(chain.eq).toHaveBeenCalledWith("activo", true)
    expect(chain.is).toHaveBeenCalledWith("deleted_at", null)
    expect(chain.eq.mock.calls.some((c: unknown[]) => c[0] === "sucursal_id")).toBe(false)
  })

  it("no-admin: agrega el filtro por su sucursal", async () => {
    const chain = chainCon({ data: { id: "dep-1" }, error: null })

    const ok = await depositoPermitido({ ...base, role: "VENDEDOR", userSucursalId: "suc-1" })

    expect(ok).toBe(true)
    expect(chain.eq).toHaveBeenCalledWith("sucursal_id", "suc-1")
  })

  it("no-admin sin sucursal: filtra por el sentinel", async () => {
    const chain = chainCon({ data: null, error: null })

    const ok = await depositoPermitido({ ...base, role: "TECNICO", userSucursalId: null })

    expect(ok).toBe(false)
    expect(chain.eq).toHaveBeenCalledWith("sucursal_id", SUCURSAL_NINGUNA)
  })

  it("alcance organizacion: sin filtro de sucursal ni para el no-admin", async () => {
    const chain = chainCon({ data: { id: "dep-1" }, error: null })

    const ok = await depositoPermitido({
      ...base,
      role: "VENDEDOR",
      userSucursalId: "suc-1",
      alcance: "organizacion",
    })

    expect(ok).toBe(true)
    expect(chain.eq.mock.calls.some((c: unknown[]) => c[0] === "sucursal_id")).toBe(false)
    expect(chain.eq).toHaveBeenCalledWith("organization_id", "org-1")
  })

  it("devuelve false cuando no hay fila", async () => {
    chainCon({ data: null, error: null })
    expect(await depositoPermitido({ ...base, role: "ADMIN", userSucursalId: null })).toBe(false)
  })

  it("un error de la query LANZA (no devuelve true ni false)", async () => {
    chainCon({ data: null, error: { message: "boom" } })
    await expect(
      depositoPermitido({ ...base, role: "ADMIN", userSucursalId: null })
    ).rejects.toBeTruthy()
  })
})
