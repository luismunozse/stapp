import { describe, it, expect, beforeEach } from "vitest"
import { GET } from "@/app/api/ordenes/compromisos/route"
import {
  mockAuthSuccess,
  createChainMock,
  mockSupabaseFrom,
  createGetRequest,
  parseResponse,
} from "./helpers"

const S1 = "11111111-1111-4111-8111-111111111111"
const U1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"

describe("GET /api/ordenes/compromisos branch scope", () => {
  let chain: ReturnType<typeof createChainMock>

  beforeEach(() => {
    chain = createChainMock([])
    mockSupabaseFrom({ ordenes_servicio: chain })
  })

  it("ADMIN is not narrowed to a branch", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    const { status } = await parseResponse(await GET(createGetRequest()))
    expect(status).toBe(200)
    expect(chain.eq).not.toHaveBeenCalledWith("sucursal_id", expect.anything())
    expect(chain.or).not.toHaveBeenCalled()
  })

  it("VENDEDOR only sees the current branch", async () => {
    mockAuthSuccess({ role: "VENDEDOR", userId: U1, sucursalId: S1 })
    await GET(createGetRequest())
    expect(chain.eq).toHaveBeenCalledWith("sucursal_id", S1)
  })

  it("TECNICO keeps their assigned filter and is scoped to branch or assigned", async () => {
    mockAuthSuccess({ role: "TECNICO", userId: U1, sucursalId: S1 })
    await GET(createGetRequest())
    expect(chain.eq).toHaveBeenCalledWith("tecnico_id", U1)
    expect(chain.or).toHaveBeenCalledWith(`sucursal_id.eq.${S1},tecnico_id.eq.${U1}`, undefined)
  })
})
