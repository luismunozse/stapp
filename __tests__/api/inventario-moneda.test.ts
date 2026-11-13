import { describe, it, expect, vi, beforeEach } from "vitest"
import { supabaseAdmin } from "@/lib/supabase"
import { emitWebhookEvent } from "@/lib/webhooks/dispatcher"
import { cargarConfigMoneda } from "@/lib/currency/tipo-cambio.server"
import { resolverConfigMoneda } from "@/lib/currency/config-moneda"
import {
  mockAuthSuccess,
  createChainMock,
  mockSupabaseFrom,
  createGetRequest,
  createPostRequest,
  parseResponse,
} from "./helpers"

// Moneda del precio en la API de inventario: alta, edición, filtro del listado y lectura.

vi.mock("@/lib/currency/tipo-cambio.server", () => ({ cargarConfigMoneda: vi.fn() }))
vi.mock("@/lib/webhooks/dispatcher", () => ({ emitWebhookEvent: vi.fn() }))
vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }))

import { GET, POST } from "@/app/api/inventario/route"
import { PUT } from "@/app/api/inventario/[id]/route"

const configUsd = (habilitada: boolean) => ({
  config: { ...resolverConfigMoneda({ multimoneda_habilitada: habilitada, moneda_extranjera: "USD" } as any, "AR"), habilitada },
  fila: null,
})
const configEurEnOrgUsd = () => ({
  config: { ...resolverConfigMoneda({ multimoneda_habilitada: true, moneda_extranjera: "EUR" } as any, "US", "USD"), habilitada: true },
  fila: null,
})

const fila = (extra: Record<string, unknown> = {}) => ({
  id: "i1",
  organization_id: "org-1",
  codigo: "C1",
  nombre: "Pantalla",
  categoria: "Repuestos",
  tipo_dispositivo: "CELULAR",
  stock: 0,
  stock_reservado: 0,
  precio_compra: 300,
  precio_venta: 900,
  moneda: null,
  deleted_at: null,
  ...extra,
})

const cuerpo = {
  codigo: "C1", nombre: "Pantalla", categoria: "Repuestos", tipoDispositivo: "CELULAR", stock: 0,
  precioCompra: 300, precioVenta: 900,
}
const postUrl = "http://localhost:3000/api/inventario"
const params = { params: Promise.resolve({ id: "i1" }) }
const putRequest = (body: unknown) =>
  new Request("http://localhost:3000/api/inventario/i1", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })

function dosLecturas(primera: unknown, segunda: unknown) {
  const cadena = createChainMock(segunda)
  vi.mocked(supabaseAdmin.from)
    .mockImplementationOnce((() => createChainMock(primera)) as any)
    .mockImplementationOnce((() => cadena) as any)
  return cadena
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(supabaseAdmin.from).mockReset()
  mockAuthSuccess({ role: "ADMIN", organizationId: "org-1", userId: "user-7" })
  vi.mocked(emitWebhookEvent).mockResolvedValue(undefined)
})

describe("POST /api/inventario con moneda", () => {
  it("sin moneda inserta moneda null explícito y no lee la configuración", async () => {
    const cadena = createChainMock(fila())
    mockSupabaseFrom({ inventario: cadena })

    const { status } = await parseResponse(await POST(createPostRequest(cuerpo, postUrl)))

    expect(status).toBe(201)
    expect(cadena.insert.mock.calls[0][0]).toHaveProperty("moneda", null)
    expect(cargarConfigMoneda).not.toHaveBeenCalled()
  })

  it("USD con la función activa inserta USD", async () => {
    vi.mocked(cargarConfigMoneda).mockResolvedValue(configUsd(true) as any)
    const cadena = createChainMock(fila({ moneda: "USD" }))
    mockSupabaseFrom({ inventario: cadena })

    const { status, body } = await parseResponse(await POST(createPostRequest({ ...cuerpo, moneda: "USD" }, postUrl)))

    expect(status).toBe(201)
    expect(cadena.insert.mock.calls[0][0].moneda).toBe("USD")
    expect(body.moneda).toBe("USD")
    expect(cargarConfigMoneda).toHaveBeenCalledWith("org-1")
  })

  it("USD con la función apagada es 400 y no inserta", async () => {
    vi.mocked(cargarConfigMoneda).mockResolvedValue(configUsd(false) as any)
    const cadena = createChainMock(fila())
    mockSupabaseFrom({ inventario: cadena })

    const { status, body } = await parseResponse(await POST(createPostRequest({ ...cuerpo, moneda: "USD" }, postUrl)))

    expect(status).toBe(400)
    expect(body.error).toBe("La moneda extranjera está deshabilitada")
    expect(cadena.insert).not.toHaveBeenCalled()
  })

  it("EUR en una org cuya extranjera es otra es 400", async () => {
    vi.mocked(cargarConfigMoneda).mockResolvedValue(configUsd(true) as any)
    mockSupabaseFrom({ inventario: createChainMock(fila()) })

    const { status, body } = await parseResponse(await POST(createPostRequest({ ...cuerpo, moneda: "EUR" }, postUrl)))

    expect(status).toBe(400)
    expect(body.error).toBe("La moneda del precio debe ser la moneda local o USD")
  })

  it("un código desconocido da el mensaje del validador, no uno genérico de zod", async () => {
    vi.mocked(cargarConfigMoneda).mockResolvedValue(configUsd(true) as any)
    mockSupabaseFrom({ inventario: createChainMock(fila()) })

    const { status, body } = await parseResponse(await POST(createPostRequest({ ...cuerpo, moneda: "ARS" }, postUrl)))

    expect(status).toBe(400)
    expect(body.error).toBe("La moneda del precio debe ser la moneda local o USD")
  })

  it("moneda null explícita inserta null sin leer la configuración", async () => {
    const cadena = createChainMock(fila())
    mockSupabaseFrom({ inventario: cadena })

    const { status } = await parseResponse(await POST(createPostRequest({ ...cuerpo, moneda: null }, postUrl)))

    expect(status).toBe(201)
    expect(cadena.insert.mock.calls[0][0].moneda).toBeNull()
    expect(cargarConfigMoneda).not.toHaveBeenCalled()
  })
})

describe("PUT /api/inventario/[id] con moneda", () => {
  it("sin moneda no incluye la clave en el update", async () => {
    const cadena = dosLecturas(fila({ moneda: "USD" }), fila({ moneda: "USD", precio_venta: 1000 }))

    const { status } = await parseResponse(await PUT(putRequest({ precioVenta: 1000 }), params))

    expect(status).toBe(200)
    expect(cadena.update.mock.calls[0][0]).not.toHaveProperty("moneda")
    expect(cargarConfigMoneda).not.toHaveBeenCalled()
  })

  it("USD sobre un ítem que ya es USD con la función apagada es 200", async () => {
    vi.mocked(cargarConfigMoneda).mockResolvedValue(configUsd(false) as any)
    const cadena = dosLecturas(fila({ moneda: "USD" }), fila({ moneda: "USD" }))

    const { status, body } = await parseResponse(await PUT(putRequest({ moneda: "USD" }), params))

    expect(status).toBe(200)
    expect(cadena.update.mock.calls[0][0].moneda).toBe("USD")
    expect(body.moneda).toBe("USD")
  })

  it("pasar un ítem local a USD con la función apagada es 400 y no actualiza", async () => {
    vi.mocked(cargarConfigMoneda).mockResolvedValue(configUsd(false) as any)
    const cadena = dosLecturas(fila(), fila())

    const { status, body } = await parseResponse(await PUT(putRequest({ moneda: "USD" }), params))

    expect(status).toBe(400)
    expect(body.error).toBe("La moneda extranjera está deshabilitada")
    expect(cadena.update).not.toHaveBeenCalled()
  })

  it("moneda null vuelve el ítem a la moneda local", async () => {
    const cadena = dosLecturas(fila({ moneda: "USD" }), fila({ moneda: null }))

    const { status, body } = await parseResponse(await PUT(putRequest({ moneda: null }), params))

    expect(status).toBe(200)
    expect(cadena.update.mock.calls[0][0]).toHaveProperty("moneda", null)
    expect(body.moneda).toBeNull()
  })

  it("EUR en una org cuya extranjera es otra es 400", async () => {
    vi.mocked(cargarConfigMoneda).mockResolvedValue(configUsd(true) as any)
    dosLecturas(fila(), fila())

    const { status } = await parseResponse(await PUT(putRequest({ moneda: "EUR" }), params))

    expect(status).toBe(400)
  })

  // Migration 409 copies a variant's currency to its siblings without converting their prices:
  // a single variant must not change it, the group endpoint does.
  it("cambiar la moneda de una variante es 400 y no actualiza", async () => {
    vi.mocked(cargarConfigMoneda).mockResolvedValue(configUsd(true) as any)
    const cadena = dosLecturas(fila({ grupo_id: "g1" }), fila({ grupo_id: "g1" }))

    const { status, body } = await parseResponse(await PUT(putRequest({ moneda: "USD" }), params))

    expect(status).toBe(400)
    expect(body.error).toBe("Cambiá la moneda desde el grupo de variantes")
    expect(cadena.update).not.toHaveBeenCalled()
  })

  it("volver a local una variante en USD también es 400", async () => {
    const cadena = dosLecturas(fila({ grupo_id: "g1", moneda: "USD" }), fila({ grupo_id: "g1" }))

    const { status, body } = await parseResponse(await PUT(putRequest({ moneda: null }), params))

    expect(status).toBe(400)
    expect(body.error).toBe("Cambiá la moneda desde el grupo de variantes")
    expect(cadena.update).not.toHaveBeenCalled()
  })

  it("una variante que reenvía su misma moneda se guarda", async () => {
    vi.mocked(cargarConfigMoneda).mockResolvedValue(configUsd(true) as any)
    const cadena = dosLecturas(fila({ grupo_id: "g1", moneda: "USD" }), fila({ grupo_id: "g1", moneda: "USD", precio_venta: 50 }))

    const { status } = await parseResponse(await PUT(putRequest({ moneda: "USD", precioVenta: 50 }), params))

    expect(status).toBe(200)
    expect(cadena.update).toHaveBeenCalled()
  })
})

describe("GET /api/inventario con moneda", () => {
  it("?moneda=divisa filtra los ítems con moneda", async () => {
    const cadena = createChainMock([fila({ moneda: "USD" })], null, 1)
    mockSupabaseFrom({ inventario: cadena })

    const { status, body } = await parseResponse(await GET(createGetRequest(`${postUrl}?moneda=divisa`)))

    expect(status).toBe(200)
    expect(cadena.not).toHaveBeenCalledWith("moneda", "is", null)
    expect(body.data[0].moneda).toBe("USD")
  })

  it("?moneda=local filtra los ítems sin moneda", async () => {
    const cadena = createChainMock([fila()], null, 1)
    mockSupabaseFrom({ inventario: cadena })

    const { body } = await parseResponse(await GET(createGetRequest(`${postUrl}?moneda=local`)))

    expect(cadena.is).toHaveBeenCalledWith("moneda", null)
    expect(cadena.not).not.toHaveBeenCalled()
    expect(body.data[0].moneda).toBeNull()
  })

  it.each(["", "?moneda=todas", "?moneda=USD"])("%s no filtra por moneda", async (qs) => {
    const cadena = createChainMock([fila()], null, 1)
    mockSupabaseFrom({ inventario: cadena })

    await GET(createGetRequest(`${postUrl}${qs}`))

    expect(cadena.not).not.toHaveBeenCalled()
    expect(cadena.is).not.toHaveBeenCalledWith("moneda", null)
  })

  it("el select del listado pide la columna moneda", async () => {
    const cadena = createChainMock([fila()], null, 1)
    mockSupabaseFrom({ inventario: cadena })

    await GET(createGetRequest(postUrl))

    expect(cadena.select.mock.calls[0][0]).toContain("moneda")
  })
})
