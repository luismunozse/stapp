import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, createChainMock, mockSupabaseFrom, parseResponse } from "./helpers"

vi.mock("@/lib/depositos", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/depositos")>()),
  depositoPermitido: vi.fn().mockResolvedValue(true),
  depositoPorDefecto: vi.fn().mockResolvedValue(null),
}))

import { supabaseAdmin } from "@/lib/supabase"
import { SIN_DEPOSITO_PRINCIPAL } from "@/lib/depositos"
import { POST as finalizar } from "@/app/api/conteos/[id]/finalizar/route"
import { POST as ensamblar } from "@/app/api/inventario/[id]/kit/ensamblar/route"
import { POST as desensamblar } from "@/app/api/inventario/[id]/kit/desensamblar/route"
import { POST as lotes } from "@/app/api/inventario/[id]/lotes/route"
import { POST as series } from "@/app/api/inventario/[id]/series/route"

// Una org sin deposito principal hace que los helpers de stock levanten P0011.
// Es un problema de configuracion de la org (como en ajustes / stock / ventas):
// 400 con mensaje claro, no un 500 generico.
const casos = [
  { nombre: "finalizar conteo", post: finalizar, body: {} },
  { nombre: "ensamblar kit", post: ensamblar, body: { cantidad: 1 } },
  { nombre: "desensamblar kit", post: desensamblar, body: { cantidad: 1 } },
  { nombre: "lotes", post: lotes, body: { numeroLote: "L1", cantidad: 5 } },
  { nombre: "series", post: series, body: { numerosSerie: ["SN-1"] } },
]

function req(body: unknown) {
  return new Request("http://localhost:3000/api/x", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}
const ctx = { params: Promise.resolve({ id: "id-1" }) }

describe.each(casos)("$nombre — org sin deposito principal (P0011)", (caso) => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess({ role: "ADMIN" })
    mockSupabaseFrom({
      organizations: createChainMock({ vendedores_administran_inventario: true }),
      conteos_inventario: createChainMock({ id: "id-1" }),
    })
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: null,
      error: { code: "P0011", message: "ORG_SIN_DEPOSITO_PRINCIPAL" },
    } as any)
  })

  it("responde 400 con el mensaje claro", async () => {
    const { status, body } = await parseResponse(await caso.post(req(caso.body), ctx))
    expect(status).toBe(400)
    expect(body.error).toBe(SIN_DEPOSITO_PRINCIPAL)
  })
})
