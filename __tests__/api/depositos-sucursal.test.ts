import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  mockAuthSuccess,
  mockAuthError,
  createChainMock,
  parseResponse,
  createPostRequest,
} from "./helpers"

vi.mock("@/lib/sucursal", () => ({
  sucursalParaEscritura: vi.fn(),
}))

import { sucursalParaEscritura } from "@/lib/sucursal"
import { supabaseAdmin } from "@/lib/supabase"
import { POST } from "@/app/api/depositos/route"

const validBody = { nombre: "Depósito Norte" }

describe("POST /api/depositos — sucursal_id stamping", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns 401 when not authenticated", async () => {
    mockAuthError()
    const response = await POST(createPostRequest(validBody))
    const { status } = await parseResponse(response)
    expect(status).toBe(401)
  })

  it("returns 500 when sucursalParaEscritura returns null", async () => {
    mockAuthSuccess()
    vi.mocked(sucursalParaEscritura).mockResolvedValue(null)

    const response = await POST(createPostRequest(validBody))
    const { status } = await parseResponse(response)
    expect(status).toBe(500)
  })

  it("inserts deposito with sucursal_id from sucursalParaEscritura", async () => {
    mockAuthSuccess()
    vi.mocked(sucursalParaEscritura).mockResolvedValue("suc-A")

    const mockRow = {
      id: "dep-1",
      nombre: "Depósito Norte",
      codigo: null,
      direccion: null,
      notas: null,
      principal: false,
      activo: true,
      sucursal_id: "suc-A",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }

    let insertedPayload: any = null

    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "depositos") {
        const chain: any = {
          insert: vi.fn().mockImplementation((payload: any) => {
            insertedPayload = payload
            return {
              select: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({ data: mockRow, error: null }),
            }
          }),
          update: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          is: vi.fn().mockReturnThis(),
          then: (resolve: any) => resolve({ data: null, error: null }),
        }
        return chain as any
      }
      return createChainMock(null) as any
    })

    const response = await POST(createPostRequest(validBody))
    const { status } = await parseResponse(response)

    expect(status).toBe(201)
    expect(insertedPayload).not.toBeNull()
    expect(insertedPayload.sucursal_id).toBe("suc-A")
  })
})
