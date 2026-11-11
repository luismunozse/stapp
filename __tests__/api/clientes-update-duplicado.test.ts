import { describe, it, expect, vi, beforeEach } from "vitest"
import { supabaseAdmin } from "@/lib/supabase"
import { mockAuthSuccess, createChainMock, parseResponse } from "./helpers"
import { PUT } from "@/app/api/clientes/[id]/route"

// Editar un cliente con el teléfono de otro de la misma organización violaba
// clientes_organization_id_telefono_key y terminaba en 500 genérico.

/** La primera consulta (leer el cliente) responde bien; el update falla con `error`. */
function clientesConUpdateFallido(error: Record<string, unknown>) {
  vi.mocked(supabaseAdmin.from)
    .mockReturnValueOnce(createChainMock({ id: "c1", organization_id: "org-1", nombre: "Juan", telefono: "1199" }) as any)
    .mockReturnValueOnce(createChainMock(null, error) as any)
}

function put(body: unknown) {
  return PUT(
    new Request("http://localhost:3000/api/clientes/c1", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: "c1" }) },
  )
}

describe("PUT /api/clientes/[id] con un dato único repetido", () => {
  beforeEach(() => vi.clearAllMocks())

  it("un teléfono que ya usa otro cliente responde 409 con un mensaje claro", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    clientesConUpdateFallido({
      code: "23505",
      message: 'duplicate key value violates unique constraint "clientes_organization_id_telefono_key"',
      details: "Key (organization_id, telefono)=(org-1, 1155) already exists.",
    })

    const { status, body } = await parseResponse(await put({ telefono: "1155" }))

    expect(status).toBe(409)
    expect(body.error).toBe("Ya existe un cliente con ese teléfono")
  })

  it("otro dato único repetido también es 409, con un mensaje general", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    clientesConUpdateFallido({
      code: "23505",
      message: 'duplicate key value violates unique constraint "clientes_otra_key"',
    })

    const { status, body } = await parseResponse(await put({ nombre: "Juan" }))

    expect(status).toBe(409)
    expect(body.error).toBe("Ya existe otro cliente con esos datos")
  })
})
